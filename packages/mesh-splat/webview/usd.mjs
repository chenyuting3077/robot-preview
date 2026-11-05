import { USDAParser } from 'three/examples/jsm/loaders/usd/USDAParser.js';
import { USDCParser } from 'three/examples/jsm/loaders/usd/USDCParser.js';
import { USDComposer } from 'three/examples/jsm/loaders/usd/USDComposer.js';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { LoaderUtils } from 'three';

const SH_C0 = 0.28209479177387814;
const ownBuffer = bytes => (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer);
const isCrate = bytes => new TextDecoder().decode(bytes.subarray(0, 8)) === 'PXR-USDC';

class ListOpUSDAParser extends USDAParser {
    _extractPrimData(data, ...rest) {
        for (const key of Object.keys(data ?? {})) {
            const field = key.match(/^(?:(?:add|prepend|append|reorder)\s+)?(references|payload)$/)?.[1];
            const known = field === 'references' ? 'prepend references' : field;
            if (field && key !== known) {
                data[known] ??= data[key];
                delete data[key];
            }
        }
        return super._extractPrimData(data, ...rest);
    }
}

class LayerUSDAParser extends ListOpUSDAParser {
    parseData(text) {
        const data = super.parseData(text.replace(/^(\s*)over(\s+")/gm, '$1def$2'));
        const header = text.match(/^#usda[^\n]*\s*\(([\s\S]*?)\n\)/)?.[1] ?? '';
        const subLayers = header.match(/subLayers\s*=\s*\[([\s\S]*?)\]/)?.[1].match(/@[^@]+@/g);
        if (subLayers) data.specsByPath['/'].fields.subLayers = subLayers.map(path => path.slice(1, -1));
        return data;
    }
}

const TYPE = { ReferenceListOp: 35, Payload: 47, LayerOffsetVector: 49, StringVector: 50, PayloadListOp: 55 };
const INLINED_INT8_VECTORS = { 19: 2, 23: 3, 25: 3, 27: 4, 29: 4 };

class ArcUSDCParser extends USDCParser {
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
            return asset || prim ? `@${asset}@${prim ? `<${prim}>` : ''}` : null;
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
            case TYPE.StringVector: return Array.from({ length: reader.readUint64() }, string);
            case TYPE.LayerOffsetVector: return [];
            case TYPE.ReferenceListOp: {
                const references = listOp(() => arc(true));
                return references.length ? [references.join(', ')] : null;
            }
            case TYPE.PayloadListOp: return listOp(() => arc(false))[0] ?? null;
            case TYPE.Payload: return arc(false);
            default: return super._readScalarValue(type);
        }
    }
}

export const parseLayer = bytes => (isCrate(bytes) ? new ArcUSDCParser().parseData(ownBuffer(bytes)) : new LayerUSDAParser().parseData(new TextDecoder().decode(bytes)));
const assetPath = ref => (typeof ref === 'string' ? ref : ref?.assetPath ?? '');
const directory = url => url.slice(0, url.lastIndexOf('/') + 1);
const resolve = (path, base) => LoaderUtils.resolveURL(path.replace(/^\.\//, ''), base.endsWith('/') ? base : `${base}/`);
const ARCS = ['references', 'payload'];
const mergeSpec = (weak, strong) => ({ ...weak, ...strong, fields: { ...weak.fields, ...strong?.fields, typeName: strong?.fields.typeName || weak.fields.typeName } });
const within = (path, root) => path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}.`);

const arcsOf = fields => ARCS.flatMap(arc => [fields[arc]].flat(Infinity)).flatMap(ref => (typeof ref === 'string'
    ? [...ref.matchAll(/@([^@]*)@(?:<([^>]+)>)?/g)].map(match => ({ asset: match[1], prim: match[2] }))
    : ref?.assetPath !== undefined ? [{ asset: ref.assetPath, prim: ref.primPath }] : []));

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
    if (!subLayers.length || depth > 16) return data;
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
        merged[target] = merged[target] ? mergeSpec(spec, merged[target]) : spec;
    }
    return merged;
}

export function dropGuides(specs) {
    const guides = new Set(Object.keys(specs).filter(path => path.endsWith('.purpose') && specs[path].fields.default === 'guide').map(path => path.slice(0, -'.purpose'.length)));
    if (!guides.size) return specs;
    for (const path of Object.keys(specs)) {
        for (let prim = path.split('.')[0]; prim; prim = prim.slice(0, prim.lastIndexOf('/'))) {
            if (guides.has(prim)) {
                delete specs[path];
                break;
            }
        }
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

export async function expandArcs(specs, layerOf) {
    for (let pass = 0; pass < 16; pass++) {
        const work = Object.entries(specs).filter(([, { fields }]) => fields.references || fields.payload).map(([path, spec]) => [path, arcsOf(spec.fields)]);
        if (!work.length) break;
        const before = work.some(([, arcs]) => arcs.some(arc => !arc.asset)) ? { ...specs } : specs;
        const sortedKeys = new Map();
        const sorted = layer => sortedKeys.get(layer) ?? sortedKeys.set(layer, Object.keys(layer).sort()).get(layer);
        for (const [path, arcs] of work) {
            const { references, payload, ...fields } = specs[path].fields;
            specs[path] = { ...specs[path], fields };
            for (const { asset, prim } of arcs) {
                const from = asset ? await layerOf(asset) : before;
                const source = prim || (from?.['/']?.fields.defaultPrim && `/${from['/'].fields.defaultPrim}`);
                if (!from || !source) continue;
                for (const [sourcePath, spec] of subtree(from, source, sorted(from))) {
                    const target = path + sourcePath.slice(source.length);
                    specs[target] = mergeSpec(spec, specs[target]);
                }
            }
        }
    }
    return specs;
}

async function loadLayer(bytes, url, context, chain = []) {
    const data = await flattenSubLayers(parseLayer(bytes), directory(url), context.read, context.missing);
    const layerOf = asset => {
        const key = resolve(asset, directory(url));
        if (chain.includes(key)) return null;
        if (!context.layers.has(key)) {
            context.layers.set(key, context.read(new URL(key).href)
                .then(bytes => loadLayer(bytes, key, context, [...chain, key]))
                .then(layer => layer.specsByPath, () => {
                    context.missing.push(key);
                    return null;
                }));
        }
        return context.layers.get(key);
    };
    data.specsByPath = dropGuides(await expandArcs(applyVariants(data.specsByPath), layerOf));
    return data;
}

export function gaussianPly(specs, path) {
    const value = name => specs[`${path}.${name}`]?.fields.default ?? specs[`${path}.${name}h`]?.fields.default;
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

export async function composeUsd(bytes, basePath = '', read = null) {
    let specs;
    const missing = [];
    let group;
    const composer = new USDComposer();
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        const zip = unzipSync(bytes);
        const assets = {};
        for (const [file, data] of Object.entries(zip)) assets[file] = /\.usd[ac]?$/i.test(file) ? parseLayer(data) : data;
        const first = Object.keys(zip)[0];
        if (!/\.usd[ac]?$/i.test(first ?? '')) throw new Error('USDZ: the first entry must be a USD layer');
        specs = assets[first].specsByPath;
        group = composer.compose(assets[first], assets, {}, first.slice(0, first.lastIndexOf('/') + 1));
    } else {
        const data = read ? await loadLayer(bytes, basePath, { read, missing, layers: new Map() }) : parseLayer(bytes);
        specs = data.specsByPath;
        group = composer.compose(data, {}, {}, basePath);
    }
    await Promise.all(composer.texturePromises);
    const gaussians = [];
    const walk = (object, path) => {
        for (const child of [...object.children]) {
            const childPath = `${path}/${child.name}`;
            child.userData.usdType = specs[childPath]?.fields.typeName ?? '';
            if (specs[`${childPath}.visibility`]?.fields.default === 'invisible') child.visible = false;
            if (specs[childPath]?.fields.typeName === 'ParticleField3DGaussianSplat') gaussians.push({ object: child, path: childPath });
            walk(child, childPath);
        }
    };
    walk(group, '');
    const shown = url => {
        const href = new URL(url).href;
        return decodeURIComponent(href.startsWith(basePath) ? href.slice(basePath.length) : href.split('/').slice(-2).join('/'));
    };
    return { group, missing: missing.map(shown), gaussians: gaussians.map(({ object, path }) => ({ object, ply: gaussianPly(specs, path) })).filter(({ ply }) => ply) };
}
