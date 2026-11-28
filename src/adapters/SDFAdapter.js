// SDF models and worlds (Gazebo), converted to URDF so meshes, missing-file
// reports, joint controls and source navigation work as they do for URDF.
//
// Poses follow the SDFormat frame semantics (sdformat.org/tutorials?tut=pose_frame_semantics):
// 1.7+ `relative_to` and `expressed_in`; before 1.7 a link is relative to its
// model and a joint to its child link; before 1.5 a joint axis is in the model
// frame, in 1.5-1.6 too when `use_parent_model_frame` is set.
// URDF puts a child link's frame on its joint, so each link's visuals,
// collisions and inertial are re-expressed in its parent joint's frame.
//
// Not converted: kinematic loops (URDF is a tree; the extra joint is dropped),
// the second axis of universal / revolute2 joints, ball and gearbox joints
// (fixed), submeshes, PBR and texture materials, heightmaps and polylines.
import * as THREE from 'three';
import { ModelLoaderFactory } from '../loaders/ModelLoaderFactory.js';
import { cleanFilePath, resolveFileMatch } from '../utils/FileUtils.js';

// gazebo-classic media/materials/scripts/gazebo.material, diffuse colors.
const GAZEBO_MATERIALS = {
    'Gazebo/Grey': [0.7, 0.7, 0.7], 'Gazebo/Gray': [0.7, 0.7, 0.7],
    'Gazebo/DarkGrey': [0.175, 0.175, 0.175], 'Gazebo/DarkGray': [0.175, 0.175, 0.175],
    'Gazebo/White': [1, 1, 1], 'Gazebo/FlatBlack': [0.1, 0.1, 0.1], 'Gazebo/Black': [0, 0, 0],
    'Gazebo/Red': [1, 0, 0], 'Gazebo/RedBright': [0.87, 0.26, 0.07], 'Gazebo/Green': [0, 1, 0],
    'Gazebo/Blue': [0, 0, 1], 'Gazebo/SkyBlue': [0, 0, 1], 'Gazebo/Yellow': [1, 1, 0],
    'Gazebo/ZincYellow': [0.9725, 0.9529, 0.2078], 'Gazebo/DarkYellow': [0.7, 0.7, 0],
    'Gazebo/Purple': [1, 0, 1], 'Gazebo/Turquoise': [0, 1, 1], 'Gazebo/Orange': [1, 0.5088, 0.0468],
    'Gazebo/Indigo': [0.33, 0, 0.5], 'Gazebo/Gold': [0.8, 0.64869, 0.120759]
};

const children = (element, tag) => Array.from(element?.children || []).filter(child => child.tagName === tag);
const child = (element, tag) => children(element, tag)[0] ?? null;
const text = (element, tag) => child(element, tag)?.textContent.trim() ?? null;
const numbers = value => (value ? value.trim().split(/\s+/).map(Number) : []);

const versionBefore = (version, target) => {
    const [a = 0, b = 0] = String(version).split('.').map(Number);
    const [c, d] = target.split('.').map(Number);
    return a < c || (a === c && b < d);
};

function poseOf(element) {
    const pose = child(element, 'pose');
    const matrix = new THREE.Matrix4();
    if (!pose) return { matrix, relativeTo: null };
    const values = numbers(pose.textContent);
    const position = new THREE.Vector3(values[0] || 0, values[1] || 0, values[2] || 0);
    const quaternion = new THREE.Quaternion();
    if (pose.getAttribute('rotation_format') === 'quat_xyzw' || values.length === 7) {
        quaternion.set(values[3] || 0, values[4] || 0, values[5] || 0, values[6] ?? 1).normalize();
    } else {
        const scale = pose.getAttribute('degrees') === 'true' ? Math.PI / 180 : 1;
        // SDF and URDF rpy: fixed-axis X, then Y, then Z.
        quaternion.setFromEuler(new THREE.Euler((values[3] || 0) * scale, (values[4] || 0) * scale, (values[5] || 0) * scale, 'ZYX'));
    }
    matrix.compose(position, quaternion, new THREE.Vector3(1, 1, 1));
    return { matrix, relativeTo: pose.getAttribute('relative_to') || null };
}

const isScoped = name => name.includes('::');
const GENERATED = '/__sdf_shapes__/';

/** One model's frames: links, joints, frames and nested models, resolved lazily. */
class Scope {
    constructor({ name, prefix, version, fileKey, parent = null, frame = null }) {
        Object.assign(this, { name, prefix, version, fileKey, parent });
        this.fixedFrame = frame;
        this.entries = new Map();
        this.cache = new Map();
    }

    modelFrame() {
        return this.fixedFrame ?? this.parent.resolve(this.localName);
    }

    add(name, entry) {
        this.entries.set(name, { owner: this, ...entry });
    }

    resolve(name, visiting = new Set()) {
        if (!name || name === '__model__') return this.modelFrame();
        if (name === 'world') return new THREE.Matrix4();
        if (isScoped(name) && !this.entries.has(name)) {
            const [head, ...rest] = name.split('::');
            const nested = this.entries.get(head);
            if (nested?.kind !== 'model') throw new Error(`SDF: frame "${name}" not found in model "${this.name}"`);
            return nested.scope.resolve(rest.join('::'), visiting);
        }
        const entry = this.entries.get(name);
        if (!entry) throw new Error(`SDF: frame "${name}" not found in model "${this.name}"`);
        if (entry.owner !== this) return entry.owner.resolve(name, visiting);
        if (this.cache.has(name)) return this.cache.get(name);
        if (visiting.has(name)) throw new Error(`SDF: poses of "${name}" in model "${this.name}" are relative to each other`);
        visiting.add(name);
        const base = this.resolve(entry.relativeTo ?? entry.defaultBase, visiting);
        const frame = base.clone().multiply(entry.matrix);
        this.cache.set(name, frame);
        return frame;
    }

    /** The link a joint's parent / child names: a link, or a frame or model attached to one. */
    linkOf(name, depth = 0) {
        if (name === 'world') return name;
        if (depth > 20) return null;
        // A model's own frame is attached to its canonical link.
        if (!name || name === '__model__') return this.canonical ? this.linkOf(this.canonical, depth + 1) : null;
        if (isScoped(name) && !this.entries.has(name)) {
            const [head, ...rest] = name.split('::');
            const nested = this.entries.get(head)?.scope;
            return nested ? nested.linkOf(rest.join('::'), depth + 1) : null;
        }
        const entry = this.entries.get(name);
        if (!entry) return null;
        if (entry.owner !== this) return entry.owner.linkOf(name, depth);
        if (entry.kind === 'link') return this.prefix + name;
        if (entry.kind === 'frame') return this.linkOf(entry.attachedTo, depth + 1);
        if (entry.kind === 'model') return entry.scope.linkOf(entry.scope.canonical, depth + 1);
        return null;
    }
}

const urdfNumber = value => String(Math.abs(value) < 1e-12 ? 0 : +value.toPrecision(10));
const escapeXml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function originXml(matrix) {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    matrix.decompose(position, quaternion, new THREE.Vector3());
    const rpy = new THREE.Euler().setFromQuaternion(quaternion, 'ZYX');
    return `<origin xyz="${position.toArray().map(urdfNumber).join(' ')}" rpy="${[rpy.x, rpy.y, rpy.z].map(urdfNumber).join(' ')}"/>`;
}

function objText(geometry) {
    const { position, normal } = geometry.attributes;
    const lines = [];
    for (let i = 0; i < position.count; i++) lines.push(`v ${position.getX(i)} ${position.getY(i)} ${position.getZ(i)}`);
    for (let i = 0; i < normal.count; i++) lines.push(`vn ${normal.getX(i)} ${normal.getY(i)} ${normal.getZ(i)}`);
    const index = geometry.index;
    const corner = i => `${index.getX(i) + 1}//${index.getX(i) + 1}`;
    for (let i = 0; i < index.count; i += 3) lines.push(`f ${corner(i)} ${corner(i + 1)} ${corner(i + 2)}`);
    return lines.join('\n') + '\n';
}

export class SDFAdapter {
    static async parse(content, fileName, fileMap) {
        const { urdf, files, missingIncludes } = await this.toURDF(content, fileName, fileMap);
        const map = new Map(fileMap || []);
        for (const [key, file] of files) map.set(key, file);
        const model = await ModelLoaderFactory.loadURDF(urdf, fileName, map);
        // The URDF checks follow ROS's parser, which never reads SDF.
        model.expandedUrdf = null;
        model.userData = { ...model.userData, format: 'sdf' };
        model.missingIncludes = missingIncludes;
        model.threeObject?.traverse(object => {
            if (object.urdfNode?.getAttribute?.('sdf_plane')) Object.assign(object.userData, { excludeFromBounds: true, isGroundPlane: true });
        });
        model.meshesReady = Promise.resolve(model.meshesReady).then(() => {
            this.colorGenerated(model.threeObject);
            return this.meshOpacity(model.threeObject, map);
        });
        return model;
    }

    /** urdf-loader colors a mesh only when the file holds one Mesh; an OBJ is a Group. */
    static colorGenerated(root) {
        root?.traverse(object => {
            const node = object.urdfNode;
            if (!object.isURDFVisual || !node?.querySelector('mesh')?.getAttribute('filename')?.startsWith(GENERATED)) return;
            const rgba = node.querySelector('color')?.getAttribute('rgba')?.split(/\s+/).map(Number);
            if (!rgba) return;
            object.traverse(mesh => {
                if (!mesh.isMesh) return;
                mesh.material = mesh.material.clone();
                mesh.material.color.setRGB(rgba[0], rgba[1], rgba[2], THREE.SRGBColorSpace);
                mesh.material.transparent = rgba[3] < 1;
                mesh.material.opacity = rgba[3];
            });
        });
    }

    /**
     * A mesh file's own opacity, then the visual's `<transparency>` on top, as
     * Gazebo draws it. Gazebo draws a Collada `<transparent>` without an
     * `opaque` mode as opaque (gazebo-classic ColladaLoader::LoadTransparent);
     * the Collada default, A_ONE, makes the `<transparency>0.0</transparency>`
     * that Blender 2.49 wrote (osrf/gazebo_models' pioneer2dx) fully transparent.
     */
    static async meshOpacity(root, fileMap) {
        const visuals = [];
        root?.traverse(object => {
            const filename = object.isURDFVisual && object.urdfNode?.querySelector('mesh')?.getAttribute('filename');
            if (filename && !filename.startsWith(GENERATED)) visuals.push({ object, filename });
        });
        const verdicts = new Map();
        for (const { object, filename } of visuals) {
            if (/\.dae$/i.test(filename) && !verdicts.has(filename)) {
                const file = resolveFileMatch(filename, fileMap)?.file;
                verdicts.set(filename, file?.text().then(text => /<transparent\b/.test(text) && !/<transparent\b[^>]*\bopaque\s*=/.test(text)));
            }
            const opaque = await verdicts.get(filename);
            const transparency = Number(object.urdfNode.getAttribute('sdf_transparency') || 0);
            if (!opaque && !transparency) continue;
            object.traverse(mesh => {
                if (!mesh.isMesh) return;
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (const material of materials) {
                    if (!material) continue;
                    if (opaque) material.opacity = 1;
                    material.opacity *= 1 - transparency;
                    material.transparent = material.opacity < 1;
                }
            });
        }
    }

    /** The URDF text, plus generated OBJ files for capsules and ellipsoids. */
    static async toURDF(content, fileName, fileMap) {
        const converter = new Converter(fileMap);
        await converter.load(content, cleanFilePath(fileName || ''));
        return converter.write();
    }
}

class Converter {
    constructor(fileMap) {
        this.fileMap = fileMap || new Map();
        this.links = [];
        this.joints = [];
        this.files = new Map();
        this.missingIncludes = [];
    }

    async load(content, fileKey) {
        const doc = this.parseXml(content, fileKey);
        const root = doc.documentElement;
        if (root.tagName !== 'sdf') throw new Error(`SDF: root element is <${root.tagName}>, not <sdf>`);
        const version = root.getAttribute('version') || '1.0';
        const world = child(root, 'world');
        const models = children(root, 'model');
        if (world || models.length > 1) {
            // Model names scope their links, as Gazebo does in a world.
            const scope = new Scope({ name: world?.getAttribute('name') || 'world', prefix: '', version, fileKey, frame: new THREE.Matrix4() });
            await this.readModelChildren(world || root, scope, true);
        } else if (models.length === 1) {
            const model = models[0];
            const scope = new Scope({ name: model.getAttribute('name') || '', prefix: '', version, fileKey, frame: poseOf(model).matrix });
            await this.readModel(model, scope);
        } else {
            throw new Error('SDF: no <model> or <world> to show');
        }
    }

    parseXml(content, fileKey) {
        const doc = new DOMParser().parseFromString(content, 'text/xml');
        const error = doc.querySelector('parsererror');
        if (error) throw new Error(`SDF: ${fileKey || 'file'} is not valid XML: ${error.textContent}`);
        return doc;
    }

    async readModel(element, scope) {
        scope.canonical = element.getAttribute('canonical_link') || children(element, 'link')[0]?.getAttribute('name') || null;
        await this.readModelChildren(element, scope, false);
    }

    async readModelChildren(element, scope, isWorld) {
        for (const item of element.children) {
            const name = item.getAttribute('name');
            if (!name && item.tagName !== 'include') continue;
            const { matrix, relativeTo } = poseOf(item);
            if (item.tagName === 'link' && !isWorld) {
                scope.add(name, { kind: 'link', matrix, relativeTo, defaultBase: '__model__' });
                this.links.push({ scope, name, element: item });
            } else if (item.tagName === 'frame') {
                const attachedTo = item.getAttribute('attached_to') || '';
                scope.add(name, { kind: 'frame', matrix, relativeTo, defaultBase: attachedTo || '__model__', attachedTo });
            } else if (item.tagName === 'joint' && !isWorld) {
                scope.add(name, { kind: 'joint', matrix, relativeTo, defaultBase: text(item, 'child') });
                this.joints.push({ scope, name, element: item });
            } else if (item.tagName === 'model') {
                await this.addNested(scope, item, { name, matrix, relativeTo, version: scope.version, fileKey: scope.fileKey });
            } else if (item.tagName === 'include') {
                await this.addInclude(scope, item);
            }
        }
    }

    async addNested(scope, element, { name, matrix, relativeTo, version, fileKey, merge = false }) {
        const nested = new Scope({ name, prefix: merge ? scope.prefix : `${scope.prefix}${name}::`, version, fileKey, parent: scope });
        nested.localName = name;
        scope.add(name, { kind: 'model', matrix, relativeTo, defaultBase: '__model__', scope: nested });
        await this.readModel(element, nested);
        if (merge) {
            // Merged content keeps its own frames but is named without the model prefix.
            for (const [key, entry] of nested.entries) if (!scope.entries.has(key)) scope.entries.set(key, entry);
        }
    }

    async addInclude(scope, include) {
        const uri = text(include, 'uri');
        const found = uri && await this.findIncluded(uri, scope.fileKey);
        if (!found) {
            // The rest of the model still shows; Problems names the include.
            // Fuel URLs are never fetched: the webview has no network access.
            console.warn(`SDF: cannot find included model ${uri}`);
            this.missingIncludes.push(uri || '');
            return;
        }
        const doc = this.parseXml(found.content, found.key);
        const root = doc.documentElement;
        const model = child(root, 'model');
        if (!model) return; // a light such as model://sun
        const { matrix, relativeTo } = child(include, 'pose') ? poseOf(include) : poseOf(model);
        await this.addNested(scope, model, {
            name: text(include, 'name') || model.getAttribute('name'),
            matrix, relativeTo,
            version: root.getAttribute('version') || '1.0',
            fileKey: found.key,
            merge: text(include, 'merge') === 'true'
        });
    }

    /** An include names an SDF file, or a model directory whose model.config lists one. */
    async findIncluded(uri, fromKey) {
        const base = /^[a-z]+:\/\//i.test(uri) || uri.startsWith('/') ? uri : this.relative(fromKey, uri);
        const read = async path => {
            const match = resolveFileMatch(path, this.fileMap);
            // Not the case or file-name guesses: Gazebo would not find those either.
            return match && ['exact', 'tail'].includes(match.match) ? { key: match.key, content: await match.file.text() } : null;
        };
        if (/\.(sdf|world)$/i.test(base)) return read(base);
        const dir = base.replace(/\/+$/, '');
        const config = await read(`${dir}/model.config`);
        if (config) {
            const entries = children(this.parseXml(config.content, config.key).documentElement, 'sdf')
                .map(entry => ({ version: entry.getAttribute('version') || '0', file: entry.textContent.trim() }))
                .sort((a, b) => (versionBefore(a.version, b.version) ? 1 : -1));
            for (const entry of entries) {
                const found = await read(this.relative(config.key, entry.file));
                if (found) return found;
            }
        }
        return read(`${dir}/model.sdf`);
    }

    relative(fromKey, path) {
        const dir = fromKey.includes('/') ? fromKey.slice(0, fromKey.lastIndexOf('/')) : '';
        return cleanFilePath(dir ? `${dir}/${path}` : path);
    }

    write() {
        const linkFrames = new Map();
        for (const link of this.links) linkFrames.set(link.scope.prefix + link.name, link);

        const joints = [];
        const parentOf = new Map();
        for (const joint of this.joints) {
            const { scope, element } = joint;
            const parent = scope.linkOf(text(element, 'parent') || '');
            const childLink = scope.linkOf(text(element, 'child') || '');
            const name = scope.prefix + joint.name;
            if (!parent || !childLink || (parent !== 'world' && !linkFrames.has(parent)) || !linkFrames.has(childLink)) {
                console.warn(`SDF: joint ${name} connects unknown links`);
                continue;
            }
            if (parentOf.has(childLink)) {
                console.warn(`SDF: joint ${name} closes a loop, which URDF cannot show`);
                continue;
            }
            const entry = { name, scope, element, parent, child: childLink, frame: scope.resolve(joint.name) };
            parentOf.set(childLink, entry);
            joints.push(entry);
        }

        const roots = Array.from(linkFrames.keys()).filter(name => !parentOf.has(name));
        const world = joints.some(joint => joint.parent === 'world') || roots.length !== 1;
        const out = ['<?xml version="1.0"?>', '<robot name="sdf">'];
        if (world) out.push('  <link name="world"/>');
        const frameOf = name => {
            if (parentOf.has(name)) return parentOf.get(name).frame;
            const link = linkFrames.get(name);
            return world ? link.scope.resolve(link.name) : new THREE.Matrix4();
        };

        let materials = 0;
        for (const [fullName, link] of linkFrames) {
            const inverse = frameOf(fullName).clone().invert();
            const local = element => {
                const { matrix, relativeTo } = poseOf(element);
                return inverse.clone().multiply(link.scope.resolve(relativeTo || link.name).clone().multiply(matrix));
            };
            out.push(`  <link name="${escapeXml(fullName)}">`);
            const inertial = child(link.element, 'inertial');
            if (inertial) {
                const inertia = child(inertial, 'inertia');
                const value = tag => urdfNumber(Number(text(inertia, tag) ?? (['ixx', 'iyy', 'izz'].includes(tag) ? 1 : 0)));
                out.push('    <inertial>', `      ${originXml(local(inertial))}`,
                    `      <mass value="${urdfNumber(Number(text(inertial, 'mass') ?? 1))}"/>`,
                    `      <inertia ixx="${value('ixx')}" ixy="${value('ixy')}" ixz="${value('ixz')}" iyy="${value('iyy')}" iyz="${value('iyz')}" izz="${value('izz')}"/>`,
                    '    </inertial>');
            }
            for (const tag of ['visual', 'collision']) {
                for (const element of children(link.element, tag)) {
                    const shape = this.geometry(child(element, 'geometry'), link.scope.fileKey);
                    if (!shape) continue;
                    const name = element.getAttribute('name');
                    // sdf_plane: a ground must not set the camera's framing.
                    // sdf_transparency: a mesh file keeps its colors, so its transparency is applied after loading.
                    const isMesh = shape.mesh && tag === 'visual';
                    const transparency = isMesh ? Number(text(element, 'transparency') ?? 0) : 0;
                    out.push(`    <${tag}${name ? ` name="${escapeXml(name)}"` : ''}${shape.plane ? ' sdf_plane="true"' : ''}${transparency ? ` sdf_transparency="${urdfNumber(transparency)}"` : ''}>`,
                        `      ${originXml(local(element).multiply(shape.offset))}`,
                        `      <geometry>${shape.xml}</geometry>`);
                    const color = tag === 'visual' && this.color(element, !isMesh);
                    if (color) out.push(`      <material name="sdf_material_${materials++}"><color rgba="${color.map(urdfNumber).join(' ')}"/></material>`);
                    out.push(`    </${tag}>`);
                }
            }
            out.push('  </link>');
        }

        for (const joint of joints) {
            const origin = (joint.parent === 'world' ? new THREE.Matrix4() : frameOf(joint.parent).clone().invert()).multiply(joint.frame);
            const { type, axis, limit } = this.jointDetails(joint);
            out.push(`  <joint name="${escapeXml(joint.name)}" type="${type}">`,
                `    <parent link="${escapeXml(joint.parent)}"/>`, `    <child link="${escapeXml(joint.child)}"/>`,
                `    ${originXml(origin)}`);
            if (axis) out.push(`    <axis xyz="${axis.toArray().map(urdfNumber).join(' ')}"/>`);
            if (limit) out.push(`    <limit lower="${urdfNumber(limit.lower)}" upper="${urdfNumber(limit.upper)}" effort="${urdfNumber(limit.effort)}" velocity="${urdfNumber(limit.velocity)}"/>`);
            out.push('  </joint>');
        }
        if (world) {
            for (const root of roots) {
                out.push(`  <joint name="world_to_${escapeXml(root)}" type="fixed">`,
                    '    <parent link="world"/>', `    <child link="${escapeXml(root)}"/>`,
                    `    ${originXml(frameOf(root))}`, '  </joint>');
            }
        }
        out.push('</robot>');
        return { urdf: out.join('\n'), files: this.files, missingIncludes: this.missingIncludes };
    }

    jointDetails({ scope, element, frame, name }) {
        const sdfType = element.getAttribute('type');
        const axisElement = child(element, 'axis');
        const limitElement = child(axisElement, 'limit');
        const lower = Number(text(limitElement, 'lower') ?? -1e16);
        const upper = Number(text(limitElement, 'upper') ?? 1e16);
        const unbounded = !limitElement || lower <= -1e16 || upper >= 1e16 || lower > upper;
        let type = { revolute: 'revolute', continuous: 'continuous', prismatic: 'prismatic',
            universal: 'revolute', revolute2: 'revolute', screw: 'continuous' }[sdfType] || 'fixed';
        if (type === 'revolute' && unbounded) type = 'continuous';
        if (!['revolute', 'continuous', 'prismatic'].includes(type)) {
            if (sdfType !== 'fixed') console.warn(`SDF: ${sdfType} joint ${name} is shown fixed`);
            return { type: 'fixed' };
        }

        const xyzElement = child(axisElement, 'xyz');
        const axis = new THREE.Vector3(...(xyzElement ? numbers(xyzElement.textContent) : [0, 0, 1]));
        const expressedIn = xyzElement?.getAttribute('expressed_in');
        let axisFrame = frame;
        if (expressedIn) axisFrame = scope.resolve(expressedIn);
        else if (versionBefore(scope.version, '1.5')) axisFrame = scope.modelFrame();
        else if (versionBefore(scope.version, '1.7') && text(axisElement, 'use_parent_model_frame') === 'true') axisFrame = scope.modelFrame();
        const rotation = new THREE.Quaternion().setFromRotationMatrix(frame.clone().invert().multiply(axisFrame));
        axis.applyQuaternion(rotation).normalize();

        // URDF needs prismatic limits; an unbounded slider gets ±1 m to drag over.
        const prismaticUnbounded = type === 'prismatic' && unbounded;
        const limit = type === 'continuous' ? null : {
            lower: prismaticUnbounded ? -1 : lower, upper: prismaticUnbounded ? 1 : upper,
            effort: Number(text(limitElement, 'effort') ?? 0), velocity: Number(text(limitElement, 'velocity') ?? 0)
        };
        return { type, axis, limit };
    }

    color(visual, withTransparency = true) {
        const material = child(visual, 'material');
        const transparency = withTransparency ? Number(text(visual, 'transparency') ?? 0) : 0;
        const diffuse = numbers(text(material, 'diffuse'));
        const ambient = numbers(text(material, 'ambient'));
        const rgb = diffuse.length ? diffuse : ambient.length ? ambient : GAZEBO_MATERIALS[text(child(material, 'script'), 'name')];
        if (!rgb?.length) return transparency ? [0.7, 0.7, 0.7, 1 - transparency] : null;
        const alpha = (rgb[3] ?? 1) * (1 - transparency);
        return [rgb[0], rgb[1], rgb[2], alpha];
    }

    /** URDF geometry, with an offset for shapes URDF draws differently. */
    geometry(element, fileKey) {
        const offset = new THREE.Matrix4();
        const shape = element && Array.from(element.children)[0];
        if (!shape) return null;
        const value = tag => Number(text(shape, tag));
        switch (shape.tagName) {
            case 'box': return { xml: `<box size="${numbers(text(shape, 'size') || '1 1 1').map(urdfNumber).join(' ')}"/>`, offset };
            case 'sphere': return { xml: `<sphere radius="${urdfNumber(value('radius'))}"/>`, offset };
            case 'cylinder': return { xml: `<cylinder radius="${urdfNumber(value('radius'))}" length="${urdfNumber(value('length'))}"/>`, offset };
            case 'capsule': {
                const radius = value('radius'), length = value('length');
                const geometry = new THREE.CapsuleGeometry(radius, length, 8, 24).rotateX(Math.PI / 2);
                return { xml: `<mesh filename="${this.generated(`capsule_${radius}_${length}`, geometry)}"/>`, offset };
            }
            case 'cone': {
                const radius = value('radius'), length = value('length');
                const geometry = new THREE.ConeGeometry(radius, length, 32).rotateX(Math.PI / 2);
                return { xml: `<mesh filename="${this.generated(`cone_${radius}_${length}`, geometry)}"/>`, offset };
            }
            case 'ellipsoid': {
                const radii = numbers(text(shape, 'radii') || '1 1 1');
                const geometry = new THREE.SphereGeometry(1, 32, 16).scale(...radii);
                return { xml: `<mesh filename="${this.generated(`ellipsoid_${radii.join('_')}`, geometry)}"/>`, offset };
            }
            case 'plane': {
                // A flat quad as for an MJCF plane: a thin box shadows itself
                // into moiré over a 100 m ground.
                const normal = new THREE.Vector3(...(numbers(text(shape, 'normal')).length ? numbers(text(shape, 'normal')) : [0, 0, 1])).normalize();
                const size = numbers(text(shape, 'size') || '1 1');
                offset.makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal));
                const geometry = new THREE.PlaneGeometry(size[0], size[1]);
                return { xml: `<mesh filename="${this.generated(`plane_${size[0]}_${size[1]}`, geometry)}"/>`, offset, plane: true };
            }
            case 'mesh': {
                const uri = text(shape, 'uri');
                if (!uri) return null;
                // Relative URIs are relative to the file that names them, which
                // for an included model is not the opened file.
                const filename = /^[a-z]+:\/\//i.test(uri) || uri.startsWith('/') ? uri : this.relative(fileKey, uri);
                const scale = text(shape, 'scale');
                return { xml: `<mesh filename="${escapeXml(filename)}"${scale ? ` scale="${numbers(scale).map(urdfNumber).join(' ')}"` : ''}/>`, offset, mesh: true };
            }
            default:
                console.warn(`SDF: <${shape.tagName}> geometry is not shown`);
                return null;
        }
    }

    generated(name, geometry) {
        const key = `${GENERATED}${name}.obj`;
        if (!this.files.has(key)) this.files.set(key, new File([objText(geometry)], `${name}.obj`));
        return key;
    }
}
