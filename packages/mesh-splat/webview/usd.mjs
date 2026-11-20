import { USDAParser } from 'three/examples/jsm/loaders/usd/USDAParser.js';
import { USDCParser } from 'three/examples/jsm/loaders/usd/USDCParser.js';
import { USDComposer } from 'three/examples/jsm/loaders/usd/USDComposer.js';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { Euler, LinearSRGBColorSpace, LoaderUtils, Matrix4, Quaternion, SRGBColorSpace } from 'three';
import { writeFace } from './geometry.mjs';
import { nurecPly, readNurec } from './nurec.mjs';

const SH_C0 = 0.28209479177387814;
const MAX_DEPTH = 16;
const SPECIFIER = { def: 0, over: 1, class: 2 };
const SPECIFIER_TYPE = { over: '__usdOver', class: '__usdClass' };
const USD_FILE = /\.usd[ac]?$/i;
const arrayBufferOf = bytes => (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer);
const isCrate = bytes => new TextDecoder().decode(bytes.subarray(0, 8)) === 'PXR-USDC';

// three leaves USDA bools as the authored text ("0", "false"); crate files give real booleans.
const isOn = value => value === true || /^\s*(1|true)\s*$/i.test(String(value));
const VARIANT_SET = /^variantSet\s+"([^"]+)"$/;
const PRIM = /^def\s+(?:(\w+)\s+)?"([^"]+)"$/;

class ListOpUSDAParser extends USDAParser {
    _extractPrimData(data, path, primFields, specsByPath, SpecType) {
        for (let key of Object.keys(data ?? {})) {
            // three reads `custom bool x` as an attribute named "bool x" of type "custom".
            if (key.startsWith('custom ')) {
                const plain = key.slice('custom '.length);
                data[plain] ??= data[key];
                delete data[key];
                key = plain;
            }
            const field = key.match(/^(?:(?:add|prepend|append|reorder)\s+)?(references|payload)$/)?.[1];
            const known = field === 'references' ? 'prepend references' : field;
            if (field && key !== known) {
                data[known] ??= data[key];
                delete data[key];
            }
            const set = key.match(VARIANT_SET)?.[1];
            if (set) {
                // Written as /Prim/{set=name} specs, the form three's crate reader gives and applyVariants composes; a
                // reference copies them with the rest of the prim's subtree, so the referencing stage can still select.
                for (const [name, body] of Object.entries(data[key])) this._extractVariant(body, `${path}/{${set}=${name.replace(/"/g, '')}}`, '', specsByPath, SpecType);
                delete data[key];
            }
        }
        if (data?.active !== undefined) primFields.active = isOn(data.active);
        return super._extractPrimData(data, path, primFields, specsByPath, SpecType);
    }

    _extractVariant(data, path, typeName, specsByPath, SpecType) {
        const fields = typeName ? { typeName } : {};
        this._extractPrimData(data, path, fields, specsByPath, SpecType);
        specsByPath[path] = { specType: SpecType.Prim, fields };
        for (const [key, child] of Object.entries(data ?? {})) {
            const [, type = '', name] = key.match(PRIM) ?? [];
            if (name) this._extractVariant(child, `${path}/${name}`, type, specsByPath, SpecType);
        }
    }
}

class LayerUSDAParser extends ListOpUSDAParser {
    parseData(text) {
        const data = super.parseData(text
            .replace(/^(\s*)(over|class)(\s+)(?:\w+\s+)?"/gm, (_, indent, specifier, space) => `${indent}def${space}${SPECIFIER_TYPE[specifier]} "`)
            // usdcat writes a variant's metadata as `"name" (` ... `) {`; three only reads `)` and `{` on lines of their own.
            .replace(/^(\s*)\)\s*\{\s*$/gm, '$1)\n$1{'));
        for (const [path, spec] of Object.entries(data.specsByPath)) {
            // A variant's own spec only adds opinions; it must not turn an over into a def.
            if (path === '/' || path.includes('.') || path.endsWith('}')) continue;
            const specifier = Object.keys(SPECIFIER_TYPE).find(name => SPECIFIER_TYPE[name] === spec.fields.typeName);
            Object.assign(spec.fields, specifier ? { typeName: '', specifier: SPECIFIER[specifier] } : { specifier: SPECIFIER.def });
        }
        const header = text.match(/^#usda[^\n]*\s*\(([\s\S]*?)\n\)/)?.[1] ?? '';
        const subLayers = header.match(/subLayers\s*=\s*\[([\s\S]*?)\]/)?.[1].match(/@[^@]+@/g);
        if (subLayers) data.specsByPath['/'].fields.subLayers = subLayers.map(path => path.slice(1, -1));
        return data;
    }
}

const CRATE_TYPE = { ReferenceListOp: 35, Payload: 47, LayerOffsetVector: 49, StringVector: 50, PayloadListOp: 55 };
const INLINED_INT8_VECTORS = { 19: 2, 23: 3, 25: 3, 27: 4, 29: 4 };
// Float, Quatf, Vec2f, Vec3f, Vec4f: components per element.
const FLOAT_ARRAY_COMPONENTS = { 8: 1, 17: 4, 20: 2, 24: 3, 28: 4 };

export class ArcUSDCParser extends USDCParser {
    _readArrayValue(valueRep) {
        const components = FLOAT_ARRAY_COMPONENTS[valueRep.typeEnum];
        if (!components || valueRep.isCompressed) return super._readArrayValue(valueRep);
        const reader = this.reader;
        const start = reader.offset;
        const size = this.version.major === 0 && this.version.minor < 7 ? reader.readUint32() : reader.readUint64();
        const end = reader.offset + size * components * 4;
        if (!(Number.isSafeInteger(size) && size > 0 && size <= 0x7fffffff && end <= this.buffer.byteLength)) {
            reader.offset = start;
            return super._readArrayValue(valueRep);
        }
        const values = new Float32Array(this.buffer.slice(reader.offset, end));
        reader.offset = end;
        return values;
    }

    _readPaths() {
        const section = this.sections.PATHS;
        if (!section || (this.version.major === 0 && this.version.minor < 4)) return super._readPaths();
        const reader = this.reader;
        reader.seek(section.start + 8);
        const encoded = reader.readUint64();
        reader.readUint64 = function () {
            delete this.readUint64;
            this.offset += 8;
            return encoded;
        };
        super._readPaths();
    }

    _readInlinedValue(valueRep) {
        const size = INLINED_INT8_VECTORS[valueRep.typeEnum];
        if (!size) return super._readInlinedValue(valueRep);
        const bytes = new Int8Array(new Uint32Array([valueRep.getInlinedValue()]).buffer);
        return Array.from(bytes.subarray(0, size));
    }

    _readScalarValue(type) {
        const reader = this.reader;
        const string = () => this.tokens[this.strings[reader.readUint32()]] ?? '';
        const path = () => this.paths[reader.readUint32()] ?? '';
        const skipDictionary = () => {
            const count = reader.readUint64();
            for (let i = 0; i < count; i++) {
                reader.readUint32();
                const start = reader.offset;
                reader.offset = start + reader.readInt64() + 8;
            }
        };
        const arc = isReference => {
            const asset = string();
            const prim = path();
            if (isReference || this.version.major > 0 || this.version.minor >= 8) reader.offset += 16;
            if (isReference) skipDictionary();
            return asset || prim ? { assetPath: asset, primPath: prim } : null;
        };
        const listOp = read => {
            const flags = reader.readUint8();
            const items = [];
            for (const bit of [0x02, 0x04, 0x20, 0x40]) {
                if (!(flags & bit)) continue;
                const count = reader.readUint64();
                for (let i = 0; i < count; i++) items.push(read());
            }
            return items.filter(Boolean);
        };
        switch (type) {
            case CRATE_TYPE.StringVector: return Array.from({ length: reader.readUint64() }, string);
            case CRATE_TYPE.LayerOffsetVector: return [];
            case CRATE_TYPE.ReferenceListOp: return listOp(() => arc(true));
            case CRATE_TYPE.PayloadListOp: return listOp(() => arc(false));
            case CRATE_TYPE.Payload: return arc(false);
            default: return super._readScalarValue(type);
        }
    }
}

export const parseLayer = bytes => (isCrate(bytes) ? new ArcUSDCParser().parseData(arrayBufferOf(bytes)) : new LayerUSDAParser().parseData(new TextDecoder().decode(bytes)));
const assetPath = ref => (typeof ref === 'string' ? ref : ref?.assetPath ?? '');
const directory = url => url.slice(0, url.lastIndexOf('/') + 1);
// a.usdz[b/c.usd] names a file inside a package; it is read as a.usdz/b/c.usd so its own relative paths resolve inside the package.
const packaged = path => path.replace(/\.usdz\[([^\]]+)\]/i, '.usdz/$1');
const resolve = (path, base) => LoaderUtils.resolveURL(packaged(path).replace(/^\.\//, ''), base.endsWith('/') ? base : `${base}/`);
const ARCS = ['references', 'payload'];
const RELATIONSHIPS = ['targetPaths', 'connectionPaths'];
const within = (path, root) => path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}.`);

function mergeSpec(weak, strong) {
    if (!strong) return { ...weak, fields: { ...weak.fields } };
    const fields = { ...weak.fields, ...strong.fields, typeName: strong.fields.typeName || weak.fields.typeName };
    if (weak.fields.specifier === SPECIFIER.def || strong.fields.specifier === SPECIFIER.def) fields.specifier = SPECIFIER.def;
    for (const arc of ARCS) if (weak.fields[arc] && strong.fields[arc]) fields[arc] = [strong.fields[arc], weak.fields[arc]].flat();
    if (weak.fields.variantSelection && strong.fields.variantSelection) fields.variantSelection = { ...weak.fields.variantSelection, ...strong.fields.variantSelection };
    return { ...weak, ...strong, fields };
}

// What a copied arc carries, since arcs are expanded at the stage root: for each layer it came through, where the
// prim that authored it now sits in that layer's namespace; as in pxr, an arc to one of those prims, an ancestor or
// a descendant is a cycle and is dropped. And how paths outside its target map onto the stage: an arc within one
// layer keeps that layer's other paths for the arcs above it to map (`maps`, ending on the stage's own paths when
// `staged`); an arc into another layer drops them.
const ARC_ORIGIN = Symbol('arcOrigin');

// A prim's arcs as authored, in strength order: references before payloads.
const authoredArcs = fields => ARCS.flatMap(arc => [fields[arc] ?? []].flat());

const arcsOf = fields => authoredArcs(fields).flat(Infinity).flatMap(ref => (typeof ref === 'string'
    ? [...ref.matchAll(/@([^@]*)@(?:<([^>]+)>)?|<([^>]+)>/g)].map(match => ({ asset: match[1] ?? '', prim: match[2] ?? match[3] }))
    : ref?.assetPath !== undefined ? [{ asset: ref.assetPath, prim: ref.primPath, ...ref[ARC_ORIGIN] }] : []));

function absolutize(specs, base) {
    const fix = ref => (typeof ref === 'string' ? ref.replace(/@([^@]+)@/g, (_, path) => `@${resolve(path, base)}@`) : ref?.assetPath ? { ...ref, assetPath: resolve(ref.assetPath, base) } : ref);
    for (const spec of Object.values(specs)) {
        const { fields } = spec;
        for (const arc of ARCS) if (fields[arc]) fields[arc] = Array.isArray(fields[arc]) ? fields[arc].map(fix) : fix(fields[arc]);
        if (fields.typeName === 'asset' && typeof fields.default === 'string' && fields.default) fields.default = resolve(fields.default.replace(/^@|@$/g, ''), base);
    }
}

async function flattenSubLayers(data, base, read, missing, depth = 0) {
    absolutize(data.specsByPath, base);
    const subLayers = data.specsByPath['/']?.fields.subLayers ?? [];
    if (!subLayers.length || depth > MAX_DEPTH) return data;
    const layers = [];
    for (const path of subLayers.map(assetPath)) {
        const url = resolve(path, base);
        try {
            layers.push((await flattenSubLayers(parseLayer(await read(new URL(url).href)), directory(url), read, missing, depth + 1)).specsByPath);
        } catch {
            missing.push(url);
        }
    }
    const merged = {};
    for (const specs of [...layers.reverse(), data.specsByPath]) {
        for (const [path, spec] of Object.entries(specs)) merged[path] = merged[path] ? mergeSpec(merged[path], spec) : spec;
    }
    return { ...data, specsByPath: merged };
}

export function applyVariants(specs) {
    const strip = path => path.replace(/\/?\{[^}]*\}/g, '') || '/';
    const entries = Object.entries(specs);
    const merged = Object.fromEntries(entries.filter(([path]) => !path.includes('{')));
    for (const [path, spec] of entries.filter(([path]) => path.includes('{'))) {
        const selected = [...path.matchAll(/\/?\{([^=}]+)=([^}]*)\}/g)].every(match =>
            merged[strip(path.slice(0, match.index))]?.fields.variantSelection?.[match[1]] === match[2]);
        if (!selected) continue;
        const target = strip(path);
        const local = merged[target];
        merged[target] = local ? mergeSpec(spec, local) : spec;
        // A variant's arcs, references and payloads alike, sit under the variant, so they are stronger than the
        // arcs authored on its prim even though its other opinions are weaker (LIVRPS).
        if (local && ARCS.some(arc => spec.fields[arc]) && ARCS.some(arc => local.fields[arc])) {
            const fields = { ...merged[target].fields, references: [...authoredArcs(spec.fields), ...authoredArcs(local.fields)] };
            delete fields.payload;
            merged[target].fields = fields;
        }
    }
    return merged;
}

export function dropUndefined(specs) {
    const prims = Object.keys(specs).filter(path => !path.includes('.') && path !== '/');
    const typed = new Set();
    for (const path of prims.filter(path => specs[path].fields.typeName)) {
        for (let prim = path; prim && !typed.has(prim); prim = prim.slice(0, prim.lastIndexOf('/'))) typed.add(prim);
    }
    // Overs and classes nothing defines, and deactivated prims, are not on the stage.
    const undefinedPrims = new Set(prims.filter(path => {
        const { specifier, active } = specs[path].fields;
        if (active === false) return true;
        return specifier === undefined ? !typed.has(path) : specifier !== SPECIFIER.def;
    }));
    if (!undefinedPrims.size) return specs;
    for (const path of Object.keys(specs)) {
        for (let prim = path.split('.')[0]; prim; prim = prim.slice(0, prim.lastIndexOf('/'))) {
            if (undefinedPrims.has(prim)) {
                delete specs[path];
                break;
            }
        }
    }
    return specs;
}

export function hideGuides(specs) {
    for (const [path, spec] of Object.entries(specs)) {
        if (path.endsWith('.purpose') && spec.fields.default === 'guide') specs[path.replace(/\.purpose$/, '.visibility')] = { ...spec, fields: { typeName: 'token', default: 'invisible' } };
    }
    return specs;
}

function subtree(specs, root, sorted) {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (sorted[middle] < root) low = middle + 1;
        else high = middle;
    }
    const paths = [];
    for (let i = low; i < sorted.length && sorted[i].startsWith(root); i++) if (within(sorted[i], root)) paths.push(sorted[i]);
    return paths.map(path => [path, specs[path]]);
}

function relocate(spec, sourcePath, { source, target, layerUrl, arc, sites }) {
    const fields = { ...spec.fields };
    const { maps = [], staged = true } = arc;
    const internal = !arc.asset || maps.length > 0;
    const mappings = [[source, target], ...(internal ? maps : [])];
    const move = path => {
        const mapping = mappings.find(([from]) => within(path, from));
        return mapping ? mapping[1] + path.slice(mapping[0].length) : internal && staged ? path : undefined;
    };
    for (const name of RELATIONSHIPS) if (Array.isArray(fields[name])) fields[name] = fields[name].map(move).filter(path => path !== undefined);
    if (ARCS.some(name => fields[name])) {
        fields.references = arcsOf(fields).map(copied => ({
            assetPath: copied.asset || layerUrl || '',
            primPath: copied.prim,
            [ARC_ORIGIN]: {
                sites: [...sites.map(site => ({ ...site, prim: site.prim + sourcePath.slice(source.length) })), { layer: layerUrl ?? '', prim: sourcePath }],
                maps: copied.asset ? [] : mappings,
                staged: !copied.asset && internal && staged
            }
        }));
        delete fields.payload;
    }
    return { ...spec, fields };
}

// Each pass selects variants before it expands arcs, so a variant stays stronger than what its prim references,
// as LIVRPS orders them. Referenced layers are therefore copied in unexpanded: expanding one on its own would put
// its references above its variants, and the referencing prim may still change the selection. For the same reason
// an arc within the stage's layer copies its target as authored, not as an earlier pass composed it elsewhere.
export async function expandArcs(specs, layerOf) {
    const authored = specs;
    for (let pass = 0; pass < MAX_DEPTH; pass++) {
        specs = applyVariants(specs);
        const work = Object.entries(specs).filter(([path, { fields }]) => ARCS.some(arc => fields[arc]) && !path.includes('{')).map(([path, spec]) => [path, arcsOf(spec.fields)]);
        if (!work.length) break;
        const sortedKeys = new Map();
        const sorted = layer => sortedKeys.get(layer) ?? sortedKeys.set(layer, Object.keys(layer).sort()).get(layer);
        for (const [path, arcs] of work) {
            const fields = { ...specs[path].fields };
            delete fields.references;
            delete fields.payload;
            specs[path] = { ...specs[path], fields };
            for (const arc of arcs) {
                const layer = arc.asset ? await layerOf(arc.asset) : { specs: authored };
                const source = arc.prim || (layer?.specs['/']?.fields.defaultPrim && `/${layer.specs['/'].fields.defaultPrim}`);
                const sites = arc.sites ?? [{ layer: '', prim: path }];
                const cycle = site => site.layer === (layer.url ?? '') && (within(site.prim, source) || within(source, site.prim));
                if (!layer || !source || sites.some(cycle)) continue;
                const expansion = { source, target: path, layerUrl: layer.url, arc, sites };
                for (const [sourcePath, spec] of subtree(layer.specs, source, sorted(layer.specs))) {
                    const target = path + sourcePath.slice(source.length);
                    specs[target] = mergeSpec(relocate(spec, sourcePath, expansion), specs[target]);
                }
            }
        }
    }
    return specs;
}

async function loadStage(bytes, url, read, missing) {
    const layerAt = (bytes, url) => flattenSubLayers(parseLayer(bytes), directory(url), read, missing);
    const data = await layerAt(bytes, url);
    const layers = new Map();
    // Arc asset paths are absolute by now (absolutize), so one resolver serves every layer.
    const layerOf = asset => {
        const key = resolve(asset, directory(url));
        if (!layers.has(key)) {
            layers.set(key, read(new URL(key).href)
                .then(bytes => layerAt(bytes, key))
                .then(layer => ({ specs: layer.specsByPath, url: key }), () => {
                    missing.push(key);
                    return null;
                }));
        }
        return layers.get(key);
    };
    data.specsByPath = await expandArcs(data.specsByPath, layerOf);
    return data;
}

export function gaussianPly(specs, path) {
    const value = name => specs[`${path}.${name}`]?.fields.default;
    const positions = value('positions');
    if (!positions?.length) return null;
    const count = positions.length / 3;
    const orientations = value('orientations');
    const scales = value('scales');
    const opacities = value('opacities');
    const sh = value('radiance:sphericalHarmonicsCoefficients');
    const color = specs[`${path}.primvars:displayColor`]?.fields.default;
    const coefficients = sh?.length ? sh.length / count / 3 : 1;
    const rest = coefficients - 1;
    const names = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', ...Array.from({ length: rest * 3 }, (_, i) => `f_rest_${i}`), 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
    const stride = names.length;
    const header = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${names.map(name => `property float ${name}\n`).join('')}end_header\n`);
    const out = new Uint8Array(header.length + count * stride * 4);
    out.set(header);
    const view = new DataView(out.buffer, header.length);
    const row = new Float32Array(stride);
    for (let i = 0; i < count; i++) {
        for (let c = 0; c < 3; c++) row[c] = positions[i * 3 + c];
        for (let c = 0; c < 3; c++) {
            row[3 + c] = sh?.length ? sh[i * coefficients * 3 + c] : ((color?.[i * 3 + c] ?? 0.5) - 0.5) / SH_C0;
            for (let k = 1; k < coefficients; k++) row[6 + c * rest + k - 1] = sh[(i * coefficients + k) * 3 + c];
        }
        const o = Math.min(Math.max(opacities?.[i] ?? 1, 1e-6), 1 - 1e-6);
        let j = 6 + rest * 3;
        row[j++] = Math.log(o / (1 - o));
        for (let c = 0; c < 3; c++) row[j++] = Math.log(Math.max(scales?.[i * 3 + c] ?? 0.01, 1e-12));
        for (const c of [3, 0, 1, 2]) row[j++] = orientations ? orientations[i * 4 + c] : +(c === 3);
        for (let k = 0; k < stride; k++) view.setFloat32((i * stride + k) * 4, row[k], true);
    }
    return out;
}

const DEGREES = Math.PI / 180;

function xformOpMatrix(kind, value) {
    const matrix = new Matrix4();
    const vector = [value].flat();
    const axisRotation = kind.match(/^rotate([XYZ])$/)?.[1];
    const eulerOrder = kind.match(/^rotate([XYZ]{3})$/)?.[1];
    if (kind === 'translate') return matrix.makeTranslation(vector[0], vector[1], vector[2]);
    if (kind === 'scale') return vector.length === 1 ? matrix.makeScale(vector[0], vector[0], vector[0]) : matrix.makeScale(vector[0], vector[1], vector[2]);
    if (kind === 'orient' && vector.length === 4) return matrix.makeRotationFromQuaternion(new Quaternion(vector[0], vector[1], vector[2], vector[3]));
    if (kind === 'transform' && vector.length === 16) return matrix.fromArray(vector);
    if (axisRotation) return matrix[`makeRotation${axisRotation}`](vector[0] * DEGREES);
    if (eulerOrder) return matrix.makeRotationFromEuler(new Euler(vector[0] * DEGREES, vector[1] * DEGREES, vector[2] * DEGREES, [...eulerOrder].reverse().join('')));
    return matrix;
}

// Null when an index is out of range: three then yields undefined, not NaN.
export function expandFloat32(data, indices, itemSize) {
    const expanded = new Float32Array(indices.length * itemSize);
    for (let i = 0, out = 0; i < indices.length; i++) {
        const start = indices[i] * itemSize;
        if (!(start >= 0 && start + itemSize <= data.length)) return null;
        for (let j = 0; j < itemSize; j++) expanded[out++] = data[start + j];
    }
    return expanded;
}

// three pushes every triangle into plain arrays. Triangle and quad meshes without holes are written
// straight into typed arrays (a 177 MB, 3.4M-triangle usdc opens in 2.2-2.3 s against 2.4-3.8 s with three's
// arrays, VS Code 1.144); null hands anything else (n-gons, holes, indices three would read as undefined)
// back to three.
export function triangulateTrisQuads(indices, counts) {
    let size = 0, corners = 0;
    for (let i = 0; i < counts.length; i++) {
        if (counts[i] !== 3 && counts[i] !== 4) return null;
        size += counts[i] === 3 ? 3 : 6;
        corners += counts[i];
    }
    if (corners > indices.length) return null;
    const pattern = new Uint32Array(size);
    for (let i = 0, offset = 0, out = 0; i < counts.length; offset += counts[i++]) {
        out = writeFace(pattern, out, offset, offset + 1, offset + 2, counts[i] === 4 ? offset + 3 : undefined);
    }
    const triangulated = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
        const index = indices[pattern[i]];
        if (!(index >= 0 && index <= 0xffffffff && index % 1 === 0)) return null;
        triangulated[i] = index;
    }
    return { indices: triangulated, pattern };
}

// Isaac Sim materials are MDL OmniPBR shaders with no UsdPreviewSurface; their constants map onto three's
// physical material well enough for a preview. Other MDL shaders keep three's default material.
function applyOmniPBR(material, attrs, loadTexture) {
    const input = name => attrs[`inputs:${name}`];
    const color = input('diffuse_color_constant');
    const texture = input('diffuse_texture') && loadTexture(input('diffuse_texture'));
    if (texture) {
        texture.colorSpace = SRGBColorSpace;
        material.map = texture;
    } else if (color?.length >= 3) material.color.setRGB(color[0], color[1], color[2], LinearSRGBColorSpace);
    const normal = input('normalmap_texture') && loadTexture(input('normalmap_texture'));
    if (normal) material.normalMap = normal;
    material.metalness = input('metallic_constant') ?? 0;
    material.roughness = input('reflection_roughness_constant') ?? 0.5;
    const emissive = input('emissive_color');
    if (isOn(input('enable_emission')) && emissive?.length >= 3) material.emissive.setRGB(emissive[0], emissive[1], emissive[2], LinearSRGBColorSpace);
    const opacity = input('opacity_constant');
    if (isOn(input('enable_opacity')) && opacity < 1) Object.assign(material, { opacity, transparent: true });
}

class XformUSDComposer extends USDComposer {
    // Bindings whose material is not on the stage keep three's default material and are reported.
    missingMaterials = new Set();

    // three colors Mesh prims from displayColor but not Cube, Sphere and the other primitives; a bound material on the stage wins.
    _buildGeomPrimitive(path, spec, typeName) {
        const mesh = super._buildGeomPrimitive(path, spec, typeName);
        const color = this._getAttributes(path)['primvars:displayColor'];
        if (color?.length >= 3 && mesh?.material?.color && !this.specsByPath[this._getMaterialBindingTarget(path)]) mesh.material.color.setRGB(color[0], color[1], color[2], LinearSRGBColorSpace);
        return mesh;
    }

    _applyMaterial(material, materialPath) {
        if (!this.specsByPath[materialPath]) this.missingMaterials.add(materialPath);
        super._applyMaterial(material, materialPath);
        const shaders = (this.shadersByMaterialPath.get(materialPath) ?? []).map(path => this._getAttributes(path));
        if (shaders.some(attrs => attrs['info:id'])) return;
        const omniPBR = shaders.find(attrs => attrs['info:mdl:sourceAsset:subIdentifier'] === 'OmniPBR' || /(^|\/)OmniPBR\.mdl$/.test(attrs['info:mdl:sourceAsset'] ?? ''));
        if (omniPBR) applyOmniPBR(material, omniPBR, path => this._loadTextureFromPath(path));
    }

    _triangulateIndicesWithPattern(indices, counts, points, holeMap) {
        return (!holeMap?.parentToHoles?.size && triangulateTrisQuads(indices, counts)) || super._triangulateIndicesWithPattern(indices, counts, points, holeMap);
    }

    _expandAttribute(data, indices, itemSize) {
        return (data instanceof Float32Array && expandFloat32(data, indices, itemSize)) || super._expandAttribute(data, indices, itemSize);
    }

    applyTransform(object, fields, attrs = {}) {
        const data = { ...fields, ...attrs };
        const order = data.xformOpOrder;
        if (!order?.length) return super.applyTransform(object, fields, attrs);
        const matrix = new Matrix4();
        for (const op of order) {
            const inverse = op.startsWith('!invert!');
            const name = inverse ? op.slice('!invert!'.length) : op;
            if (data[name] === undefined) continue;
            const step = xformOpMatrix(name.split(':')[1], data[name]);
            matrix.multiply(inverse ? step.invert() : step);
        }
        matrix.decompose(object.position, object.quaternion, object.scale);
    }
}

// Prim types three's USDComposer builds (its _buildHierarchy, three 0.187) or that only organise others; anything else on
// the stage is listed as not shown. Re-check against the composer when three is bumped.
const DRAWN = new Set(['Xform', 'Scope', 'Mesh', 'Cube', 'Sphere', 'Cylinder', 'Cone', 'Capsule', 'Material', 'Shader', 'NodeGraph', 'GeomSubset',
    'Camera', 'DistantLight', 'SphereLight', 'RectLight', 'DiskLight', 'SkelRoot', 'Skeleton', 'SkelAnimation', 'ParticleField3DGaussianSplat', 'OmniNuRecFieldAsset']);
// Render settings and the physics scene are stage configuration, not geometry anyone expects to see.
const NOT_VISUAL = /^(Render|PhysicsScene$)/;

const USDZ_ROOT = 'https://usdz.invalid/';
const noFile = async url => {
    throw new Error(`not found: ${url}`);
};

// A USDZ's files that are not USD layers become assets under `prefix`, so its textures resolve.
function unzipPackage(bytes, prefix, assets) {
    const files = unzipSync(bytes);
    for (const [name, data] of Object.entries(files)) if (!USD_FILE.test(name)) assets[prefix + name] = data;
    return files;
}

// Reads a.usdz/inner (see `packaged`) out of the package, unzipping each package once; anything else goes to `read`.
function packageReader(read, assets) {
    const packages = new Map();
    return async url => {
        const [, usdz, inner] = url.match(/^(.*?\.usdz)\/(.+)$/i) ?? [];
        if (!usdz) return read(url);
        if (!packages.has(usdz)) {
            packages.set(usdz, read(usdz).then(zip => unzipPackage(zip, `${usdz}/`, assets)));
        }
        return (await packages.get(usdz))[decodeURIComponent(inner)] ?? noFile(url);
    };
}

// Prim types on the stage that nothing draws, most frequent first.
function notShownTypes(specs, shownVolumes) {
    const types = new Map();
    for (const [path, spec] of Object.entries(specs)) {
        const type = spec.fields.typeName;
        if (path.includes('.') || path === '/' || !type || DRAWN.has(type) || NOT_VISUAL.test(type) || shownVolumes.has(path)) continue;
        types.set(type, (types.get(type) ?? 0) + 1);
    }
    return [...types].sort((a, b) => b[1] - a[1]);
}

export async function composeUsd(bytes, basePath = '', read = noFile) {
    const missing = [];
    const assets = {};
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        const files = unzipPackage(bytes, USDZ_ROOT, assets);
        const first = Object.keys(files)[0];
        if (!USD_FILE.test(first ?? '')) throw new Error('USDZ: the first entry must be a USD layer');
        read = async url => files[decodeURIComponent(url.slice(USDZ_ROOT.length))] ?? noFile(url);
        basePath = directory(USDZ_ROOT + first);
        bytes = files[first];
    }
    read = packageReader(read, assets);
    const data = await loadStage(bytes, basePath, read, missing);
    const specs = hideGuides(dropUndefined(data.specsByPath));
    const composer = new XformUSDComposer();
    const group = composer.compose(data, assets, {}, basePath);
    // three turns upAxis "Z" into Y-up by rotating the root; the viewer's up menu does that instead.
    group.rotation.set(0, 0, 0);
    await Promise.all(composer.texturePromises);
    const gaussians = [];
    const nurecVolumes = [];
    const walk = (object, path) => {
        for (const child of [...object.children]) {
            const childPath = `${path}/${child.name}`;
            const type = specs[childPath]?.fields.typeName ?? '';
            child.userData.usdType = type;
            if (specs[`${childPath}.visibility`]?.fields.default === 'invisible') child.visible = false;
            if (type === 'ParticleField3DGaussianSplat') gaussians.push({ object: child, ply: gaussianPly(specs, childPath) });
            if (type === 'Volume' && isOn(specs[`${childPath}.omni:nurec:isNuRecVolume`]?.fields.default)) nurecVolumes.push({ object: child, path: childPath });
            walk(child, childPath);
        }
    };
    walk(group, '');
    // Legacy NuRec: a Volume whose field assets all name one .nurec file holding the Gaussians.
    // A Volume whose file is unreadable (listed missing) or holds no Gaussians stays under not shown.
    const shownVolumes = new Set();
    for (const { object, path } of nurecVolumes) {
        const field = Object.keys(specs).find(key => key.startsWith(`${path}/`) && key.endsWith('.filePath') && specs[key].fields.default);
        if (!field) continue;
        // absolutize resolved the asset against its own layer.
        const file = specs[field].fields.default;
        let bytes;
        try {
            bytes = await read(new URL(file).href);
        } catch {
            missing.push(file);
            continue;
        }
        try {
            const ply = nurecPly(readNurec(bytes));
            if (!ply) continue;
            gaussians.push({ object, ply });
            shownVolumes.add(path);
        } catch (error) {
            console.warn(`NuRec ${file}: ${error.message}`);
        }
    }
    const displayPath = url => {
        try {
            const href = new URL(url).href;
            return decodeURIComponent(href.startsWith(basePath) ? href.slice(basePath.length) : href.split('/').slice(-2).join('/'));
        } catch {
            return url;
        }
    };
    return {
        group,
        upAxis: data.specsByPath['/']?.fields.upAxis,
        metersPerUnit: data.specsByPath['/']?.fields.metersPerUnit,
        missing: missing.map(displayPath),
        missingMaterials: [...composer.missingMaterials],
        notShown: notShownTypes(specs, shownVolumes),
        gaussians: gaussians.filter(({ ply }) => ply)
    };
}
