import * as THREE from 'three';
import { colorize, colorRange } from './color.mjs';
import { heights } from './geometry.mjs';
import { hasColor, MESH_GREY, POINT_GREY, surfaceMaterial } from './materials.mjs';

// One color per file for the Solid mode, Tableau 10 reordered so the first files (a map and a scan) take
// orange and blue, which stay apart from each other, from turbo's middle and from both backgrounds.
// Solid color indexes for `ids`: a file in `kept` keeps its own, the others take the lowest index no file has,
// so files apart in the view stay apart however many have come and gone.
export function assignHues(ids, kept = {}) {
    const hues = {};
    for (const id of ids) if (Number.isInteger(kept?.[id])) hues[id] = kept[id];
    for (const id of ids) {
        if (id in hues) continue;
        let hue = 0;
        while (Object.values(hues).includes(hue)) hue++;
        hues[id] = hue;
    }
    return hues;
}

export const SOLID_COLORS = ['#f28e2b', '#4e79a7', '#59a14f', '#e15759', '#b07aa1', '#76b7b2', '#edc948', '#ff9da7', '#9c755f', '#bab0ac'];

// Positions as float32 xyz whatever the attribute's layout: glTF keeps them interleaved or quantized.
export function positionsOf(geometry) {
    const attribute = geometry.attributes.position;
    const { array, count } = attribute;
    if (!attribute.isInterleavedBufferAttribute && array instanceof Float32Array && attribute.itemSize === 3 && !attribute.normalized) return array.subarray(0, count * 3);
    if (geometry.userData.positions32?.length === count * 3) return geometry.userData.positions32;
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        out[i * 3] = attribute.getX(i);
        out[i * 3 + 1] = attribute.getY(i);
        out[i * 3 + 2] = attribute.getZ(i);
    }
    return (geometry.userData.positions32 = out);
}

export const ownGeometry = object => object.userData.own?.geometry ?? object.geometry;

// A distance mode is 'distance:<file id>': each point's distance to that file.
export const distanceMode = id => `distance:${id}`;
export const distanceRef = mode => (mode?.startsWith('distance:') ? mode.slice(9) : null);

// Points within the tolerance are dropped in the shader, so moving the tolerance or hiding them recolors nothing.
// The distance is its own attribute; an object without it reads 0, which only matters while its clip is on.
const clipLimit = { value: 0 };
function clipOf(material) {
    if (material.userData.clip) return material.userData.clip;
    const on = (material.userData.clip = { value: 0 });
    material.onBeforeCompile = shader => {
        shader.uniforms.clipLimit = clipLimit;
        shader.uniforms.clipOn = on;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float compareDistance;\nvarying float vCompareDistance;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCompareDistance = compareDistance;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float clipLimit;\nuniform float clipOn;\nvarying float vCompareDistance;')
            .replace('void main() {', 'void main() {\nif (clipOn > 0.5 && vCompareDistance <= clipLimit) discard;');
    };
    material.customProgramCacheKey = () => 'compare-clip';
    material.needsUpdate = true;
    return on;
}

// A mesh shows every mode but Original through a copy of its geometry that shares every attribute but color, with
// a plain vertex-colored material, so Original brings back its own colors, textures and materials untouched.
function paintedOf(mesh) {
    if (mesh.userData.painted) return mesh.userData.painted;
    mesh.userData.own = { geometry: mesh.geometry, material: mesh.material };
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) if (name !== 'color') geometry.setAttribute(name, attribute);
    geometry.setIndex(mesh.geometry.index);
    geometry.boundingBox = mesh.geometry.boundingBox;
    geometry.boundingSphere = mesh.geometry.boundingSphere;
    return (mesh.userData.painted = { geometry, material: surfaceMaterial([1, 1, 1], { vertexColors: true }) });
}
function showPainted(mesh, on) {
    if (!on && !mesh.userData.own) return;
    const target = on ? paintedOf(mesh) : mesh.userData.own;
    if (mesh.geometry === target.geometry) return;
    // Wireframe and the Points display mode set these on whatever material the mesh shows.
    const current = [].concat(mesh.material)[0];
    for (const material of [].concat(target.material)) Object.assign(material, { wireframe: current.wireframe, visible: current.visible });
    mesh.geometry = target.geometry;
    mesh.material = target.material;
    const points = mesh.userData.points;
    if (points) {
        points.geometry = mesh.geometry;
        points.material.vertexColors = hasColor(mesh.geometry);
        points.material.color.set(hasColor(mesh.geometry) ? 0xffffff : POINT_GREY);
        points.material.needsUpdate = true;
    }
}

// A field's mode is 'field:<name>', so a field named "height" stays apart from Height. Height and each field share
// one range over the clouds in that mode, so one color means one value across files. `fileOf` gives a cloud's
// file a number that stays when another file is removed, so its solid color does not change.
export function createCloudColors({ root, upAxis, label = name => name, onChange = () => {}, fileOf = null, paintable = () => false }) {
    const clouds = [];
    const meshes = [];
    const everything = () => clouds.concat(meshes);
    const modes = new Map();
    // The legend shows the mode the Display menu last set while a cloud uses it, or a distance chosen on a row.
    let shown;
    // The top of the distance scale when typed into the legend; null takes the 98th percentile.
    let distanceTop = null;
    let hideWithin = false;
    const fieldOf = mode => (mode?.startsWith('field:') ? mode.slice(6) : null);
    const ranged = mode => mode === 'height' || !!fieldOf(mode) || !!distanceRef(mode);
    // A field's mode is for the clouds that carry it, a distance's for what has been measured; every object takes the others.
    const takes = (object, mode) => {
        if (fieldOf(mode)) return object.isPoints && !!object.geometry.userData.scalars?.[fieldOf(mode)];
        if (distanceRef(mode)) return !!object.userData.distances?.[distanceRef(mode)];
        return true;
    };
    const solidOf = cloud => {
        const parent = clouds.find(other => other !== cloud && other.children.includes(cloud));
        if (parent) return solidOf(parent);
        const index = fileOf ? fileOf(cloud) : everything().indexOf(cloud);
        return new THREE.Color(SOLID_COLORS[index % SOLID_COLORS.length]);
    };

    function applyClip() {
        for (const object of everything()) {
            const values = object.userData.distances?.[distanceRef(modes.get(object))];
            const on = Boolean(hideWithin && values);
            const materials = [object.material, object.isMesh ? object.userData.points?.material : null].filter(Boolean);
            for (const material of materials) if (on || material.userData.clip) clipOf(material).value = on ? 1 : 0;
        }
    }

    function recolor() {
        // Heights in the root's frame, where the up axis applies.
        root.updateMatrixWorld(true);
        const toRoot = root.matrixWorld.clone().invert();
        const all = everything();
        const values = all.map(object => {
            const mode = modes.get(object);
            const field = fieldOf(mode);
            if (field) return object.geometry.userData.scalars?.[field];
            if (distanceRef(mode)) return object.userData.distances?.[distanceRef(mode)];
            return mode === 'height' && heights(positionsOf(ownGeometry(object)), upAxis(), toRoot.clone().multiply(object.matrixWorld).elements);
        });
        // One range per mode over the clouds in it, as loaded, so adding detail does not recolor the rest. A
        // distance starts at 0, where the files agree.
        const ranges = new Map();
        for (const mode of new Set(modes.values())) {
            const lists = values.filter((value, c) => value && modes.get(all[c]) === mode && !all[c].userData.detail);
            // No finite value (no points, or all NaN) gives no range.
            let range = ranged(mode) && lists.length && colorRange(lists);
            if (range && distanceRef(mode)) range = [0, distanceTop ?? range[1]];
            if (range && Number.isFinite(range[0])) ranges.set(mode, range);
        }
        all.forEach((object, c) => {
            const mode = modes.get(object);
            if (object.isMesh) showPainted(object, mode !== 'rgb');
            const { geometry, material } = object;
            // One mapped attribute per object, refilled in place: a replaced attribute keeps its GPU buffer until the geometry is disposed.
            const mapped = () => (object.userData.mapped ??= new THREE.BufferAttribute(new Uint8Array(geometry.attributes.position.count * 3), 3, true));
            if (values[c]) {
                colorize(values[c], mapped().array, ranges.get(mode) ?? colorRange([values[c]]));
                mapped().needsUpdate = true;
                geometry.setAttribute('color', mapped());
            } else if (mode === 'solid' || (mode === 'grey' && object.isMesh)) {
                // THREE.Color keeps linear components already (color management is on). Grey is the plain grey a
                // file without colors shows: a reference behind a distance, so its colors do not read as distances.
                const color = mode === 'solid' ? solidOf(object) : new THREE.Color().setRGB(...MESH_GREY, THREE.SRGBColorSpace);
                const [r, g, b] = color.toArray().map(value => Math.round(value * 255));
                const { array } = mapped();
                for (let i = 0; i < array.length; i += 3) {
                    array[i] = r;
                    array[i + 1] = g;
                    array[i + 2] = b;
                }
                mapped().needsUpdate = true;
                geometry.setAttribute('color', mapped());
            } else if (object.isMesh) return;
            else if (mode === 'rgb' && object.userData.rgb) geometry.setAttribute('color', object.userData.rgb);
            else geometry.deleteAttribute('color');
            const distances = object.userData.distances?.[distanceRef(mode)];
            if (distances && geometry.attributes.compareDistance?.array !== distances) geometry.setAttribute('compareDistance', new THREE.BufferAttribute(distances, 1));
            if (object.isMesh) return;
            material.vertexColors = hasColor(geometry);
            material.color.set(hasColor(geometry) ? 0xffffff : POINT_GREY);
            material.needsUpdate = true;
        });
        applyClip();
        const used = new Set(modes.values());
        // A button is lit when every cloud that can take its mode is in it.
        document.querySelectorAll('[data-color]').forEach(button => {
            const able = clouds.filter(cloud => takes(cloud, button.dataset.color));
            button.classList.toggle('active', able.length > 0 && able.every(cloud => modes.get(cloud) === button.dataset.color));
        });
        const legend = used.has(shown) && ranges.has(shown) ? shown : all.map(object => modes.get(object)).find(mode => ranges.has(mode));
        onChange(legend ?? shown, legend ? ranges.get(legend) : null);
    }

    // Every cloud, or only `some` objects (a Stage row's).
    function assign(mode, some) {
        if (some === clouds || distanceRef(mode)) shown = mode;
        for (const object of some) if (everything().includes(object) && takes(object, mode)) modes.set(object, mode);
        for (const cloud of clouds) for (const child of cloud.children) if (some.includes(cloud) && clouds.includes(child)) modes.set(child, modes.get(cloud));
    }
    function setMode(mode, some = clouds) {
        assign(mode, some);
        recolor();
    }
    // [[mode, objects], ...] with one recolor, for a view restoring every file's mode.
    function setModes(entries) {
        for (const [mode, some] of entries) assign(mode, some);
        recolor();
    }

    // Runs before the Points display mode adds points to meshes, so every Points here is a point cloud. Each
    // starts in its own colors, else its intensity, else by height; a mesh in its own.
    function setup() {
        root.traverse(child => {
            if (child.isPoints) clouds.push(child);
            else if (child.isMesh && child.geometry?.attributes.position && paintable(child)) meshes.push(child);
        });
        for (const cloud of clouds) cloud.userData.rgb = cloud.geometry.attributes.color;
        for (const mesh of meshes) modes.set(mesh, 'rgb');
        // The clouds of one file start in one mode, as a file's clouds did before views held several files: a USD
        // stage's plain Points prim shows grey beside a colored one rather than by height.
        const fileKey = cloud => (fileOf ? fileOf(cloud) : cloud);
        for (const key of new Set(clouds.map(fileKey))) {
            const own = clouds.filter(cloud => fileKey(cloud) === key);
            const mode = own.some(cloud => cloud.userData.rgb) ? 'rgb' : own.some(cloud => cloud.geometry.userData.scalars?.intensity) ? 'field:intensity' : 'height';
            for (const cloud of own) modes.set(cloud, mode);
        }
        const names = [...new Set(clouds.flatMap(cloud => Object.keys(cloud.geometry.userData.scalars ?? {})))];
        document.getElementById('color-fields').replaceChildren(...names.map(name => {
            const button = Object.assign(document.createElement('button'), { className: 'control-button', textContent: label(name), title: name });
            button.dataset.color = `field:${name}`;
            return button;
        }));
        document.querySelectorAll('[data-color], #color-separator').forEach(element => { element.hidden = !clouds.length; });
        document.querySelectorAll('[data-color]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.color)));
        shown = modes.get(clouds[0]);
        if (clouds.length || meshes.length) recolor();
    }

    // A cloud added after setup (the detail of a sampled one) takes its parent's mode and the loaded clouds' range.
    function add(cloud) {
        cloud.userData.detail = true;
        const parent = clouds.find(other => other.children.includes(cloud));
        clouds.push(cloud);
        cloud.userData.rgb = cloud.geometry.attributes.color;
        modes.set(cloud, parent ? modes.get(parent) : shown);
        recolor();
    }
    function remove(cloud) {
        if (!clouds.includes(cloud)) return;
        clouds.splice(clouds.indexOf(cloud), 1);
        modes.delete(cloud);
        recolor();
    }

    return {
        setup,
        setMode,
        setModes,
        add,
        remove,
        modeOf: object => modes.get(object),
        solidOf,
        refresh: recolor,
        // The files some object is colored by its distance to.
        usedReferences: () => new Set([...modes.values()].map(distanceRef).filter(Boolean)),
        setDistanceTop(top) {
            distanceTop = top;
            recolor();
        },
        setClip(tolerance, hide) {
            clipLimit.value = tolerance;
            hideWithin = hide;
            applyClip();
        }
    };
}

