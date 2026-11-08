import { Color, SRGBColorSpace } from 'three';

const TYPES = {};
for (const [names, ArrayType, getter] of [
    [['char', 'int8'], Int8Array, 'getInt8'], [['uchar', 'uint8'], Uint8Array, 'getUint8'],
    [['short', 'int16'], Int16Array, 'getInt16'], [['ushort', 'uint16'], Uint16Array, 'getUint16'],
    [['int', 'int32'], Int32Array, 'getInt32'], [['uint', 'uint32'], Uint32Array, 'getUint32'],
    [['float', 'float32'], Float32Array, 'getFloat32'], [['double', 'float64'], Float64Array, 'getFloat64']
]) for (const name of names) TYPES[name] = { ArrayType, getter, size: ArrayType.BYTES_PER_ELEMENT, float: getter.startsWith('getFloat') };
const FLAT_SCALE = Math.log(1e-6);
const END_HEADER = [...'end_header'].map(c => c.charCodeAt(0));
const isNewline = byte => byte === 10 || byte === 13;

// Measured in bytes because a Latin-1 comment re-encodes to a different length.
// PLYLoader adds the second byte of a CRLF only when the file starts "ply\r\n";
// a file mixing newlines would be read one byte off, so that is kept apart.
function headerEnd(bytes) {
    const limit = Math.min(bytes.length, 65536);
    for (let i = 0; i + END_HEADER.length < limit; i++) {
        if (i > 0 && !isNewline(bytes[i - 1])) continue;
        const after = i + END_HEADER.length;
        if (!END_HEADER.every((code, k) => bytes[i + k] === code) || !isNewline(bytes[after])) continue;
        const startsCrlf = bytes[3] === 13 && bytes[4] === 10;
        const endsCrlf = bytes[after] === 13 && bytes[after + 1] === 10;
        return { offset: i, length: after + (endsCrlf ? 2 : 1), loaderLength: after + (startsCrlf ? 2 : 1) };
    }
    return null;
}

export function readPlyHeader(bytes) {
    const end = headerEnd(bytes);
    const head = end && new TextDecoder().decode(bytes.subarray(0, end.offset));
    if (!head?.startsWith('ply')) return null;
    const header = { format: '', elements: [], headerLength: end.length, loaderHeaderLength: end.loaderLength };
    for (const line of head.split(/\r\n|\r|\n/)) {
        const [keyword, ...rest] = line.trim().split(/\s+/);
        if (keyword === 'format') header.format = rest[0];
        // parseInt like PLYLoader: "5e1" is 5 vertices, not 50.
        if (keyword === 'element') header.elements.push({ name: rest[0], count: parseInt(rest[1]), properties: [] });
        if (keyword === 'property') {
            header.elements.at(-1)?.properties.push(rest[0] === 'list'
                ? { name: rest[3], type: rest[2], list: true }
                : { name: rest[1], type: rest[0] });
        }
    }
    return header;
}

export function plyKind(header) {
    const vertex = header.elements.find(element => element.name === 'vertex');
    const names = new Set(vertex?.properties.map(property => property.name));
    if (names.has('f_dc_0') || (names.has('scale_0') && names.has('opacity'))) return 'splat';
    return header.elements.some(element => element.name === 'face' && element.count > 0) ? 'mesh' : 'points';
}

export function addMissingScale(bytes, header) {
    const vertex = header.elements.find(element => element.name === 'vertex');
    const names = vertex?.properties.map(property => property.name) ?? [];
    if (!names.includes('scale_1') || names.includes('scale_2')) return bytes;
    if (header.elements[0] !== vertex || header.format !== 'binary_little_endian') return null;
    if (vertex.properties.some(property => property.list || !TYPES[property.type])) return null;
    const sizes = vertex.properties.map(property => TYPES[property.type].size);
    const at = names.indexOf('scale_1');
    const before = sizes.slice(0, at + 1).reduce((sum, size) => sum + size, 0);
    const stride = sizes.reduce((sum, size) => sum + size, 0);
    const oldHeader = new TextDecoder().decode(bytes.subarray(0, header.headerLength));
    const newHeader = new TextEncoder().encode(oldHeader.replace(/(property \S+ scale_1\r?\n)/, '$1property float scale_2\n'));
    const body = vertex.count * stride;
    const out = new Uint8Array(newHeader.length + vertex.count * (stride + 4) + bytes.length - header.headerLength - body);
    out.set(newHeader);
    const view = new DataView(out.buffer);
    let src = header.headerLength;
    let dst = newHeader.length;
    for (let i = 0; i < vertex.count; i++, src += stride, dst += stride + 4) {
        out.set(bytes.subarray(src, src + before), dst);
        view.setFloat32(dst + before, FLAT_SCALE, true);
        out.set(bytes.subarray(src + before, src + stride), dst + before + 4);
    }
    out.set(bytes.subarray(src), dst);
    return out;
}

// ---- Point clouds without PLYLoader. PLYLoader builds an object per vertex
// and grows plain arrays. For 10M coloured points (150 MB) it took 3.6 s
// (median of 3) and peaked at 1387 MB RSS against 344 MB for this reader and
// 328 MB with only the file loaded (3 runs, within 1 MB); past ~44M points it
// fails with "Invalid array length". Node 22, Apple M2. This
// reader writes typed arrays directly and reproduces its output exactly (same
// attributes and types, same sRGB→linear rounding); anything it does not
// handle returns null and goes to PLYLoader, which also reads what it can of a
// truncated file.
let srgbToLinearByte = null;
const color = new Color();
const linearByte = value => Math.round(color.setRGB(value * (1 / 255), 0, 0, SRGBColorSpace).r * 255);

function linearByteTable() {
    srgbToLinearByte ??= Uint8Array.from({ length: 256 }, (_, i) => linearByte(i));
    return srgbToLinearByte;
}

// JavaScript's \s, which PLYLoader splits ASCII on; control characters below
// space are not in it. Matching it exactly costs ~4% over `<= 32` (2M points,
// Node 22, Apple M2, median of 5, two runs: 1009 -> 1049 ms).
function isSpace(code) {
    if (code <= 32) return code === 32 || (code >= 9 && code <= 13);
    if (code < 160) return false;
    return code === 160 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029
        || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

// PLYLoader's property lookup: the first name in the list that exists wins.
const ATTRIBUTES = {
    positions: [['x', 'px', 'posx'], ['y', 'py', 'posy'], ['z', 'pz', 'posz']],
    normals: [['nx', 'normalx'], ['ny', 'normaly'], ['nz', 'normalz']],
    uvs: [['s', 'u', 'texture_u', 'tx'], ['t', 'v', 'texture_v', 'ty']],
    colors: [['red', 'diffuse_red', 'r', 'diffuse_r'], ['green', 'diffuse_green', 'g', 'diffuse_g'], ['blue', 'diffuse_blue', 'b', 'diffuse_b']]
};

function readAsciiPoints(bytes, vertex, layout, points) {
    // PLYLoader starts the body after the first "end_header" plus whitespace.
    const text = new TextDecoder().decode(bytes);
    const parsers = vertex.properties.map(property => (TYPES[property.type].float ? parseFloat : parseInt));
    const values = new Array(vertex.properties.length);
    const { positions, normals, uvs, colors } = points;
    const [x, y, z] = layout.positions;
    const table = colors && linearByteTable();
    let at = text.search(/end_header\s/);
    if (at < 0) return null;
    at += 'end_header'.length;
    for (let i = 0; i < vertex.count; i++) {
        let filled = 0;
        while (filled < values.length && at < text.length) {
            while (at < text.length && isSpace(text.charCodeAt(at))) at++;
            const start = at;
            while (at < text.length && !isSpace(text.charCodeAt(at))) at++;
            if (at > start) {
                values[filled] = parsers[filled](text.slice(start, at));
                filled++;
            }
        }
        if (filled < values.length) return null;
        positions[i * 3] = values[x];
        positions[i * 3 + 1] = values[y];
        positions[i * 3 + 2] = values[z];
        if (normals) for (let c = 0; c < 3; c++) normals[i * 3 + c] = values[layout.normals[c]];
        if (uvs) for (let c = 0; c < 2; c++) uvs[i * 2 + c] = values[layout.uvs[c]];
        if (!colors) continue;
        for (let c = 0; c < 3; c++) {
            // ASCII can hold values outside 0..255; PLYLoader converts them
            // anyway and the Uint8Array wraps the result, so do the same.
            const value = values[layout.colors[c]];
            colors[i * 3 + c] = value >= 0 && value <= 255 ? table[value] : linearByte(value);
        }
    }
    return points;
}

export function readPlyPoints(bytes, header) {
    const vertex = header.elements[0];
    if (vertex?.name !== 'vertex' || !(vertex.count >= 0) || vertex.properties.some(property => property.list || !TYPES[property.type])) return null;
    const indexOf = names => {
        for (const name of names) {
            const at = vertex.properties.findIndex(property => property.name === name);
            if (at >= 0) return at;
        }
        return -1;
    };
    const layout = {};
    for (const [key, names] of Object.entries(ATTRIBUTES)) {
        const indices = names.map(indexOf);
        if (indices.every(i => i >= 0)) layout[key] = indices;
    }
    if (!layout.positions) return null;
    if (layout.colors && !layout.colors.every(i => TYPES[vertex.properties[i].type].ArrayType === Uint8Array)) return null;
    const binary = header.format === 'binary_little_endian' || header.format === 'binary_big_endian';
    if (!binary && header.format !== 'ascii') return null;

    // Check the body can hold count vertices before allocating for them, so a
    // wrong count in the header cannot claim gigabytes.
    const body = bytes.length - header.headerLength;
    const stride = vertex.properties.reduce((sum, property) => sum + TYPES[property.type].size, 0);
    if (binary && (stride * vertex.count > body || header.loaderHeaderLength !== header.headerLength)) return null;
    if (!binary && vertex.count > 0 && 2 * vertex.count * vertex.properties.length - 1 > body) return null;

    // PLYLoader adds an attribute only when it has values, typed like its first property.
    const allocate = (key, size) => (layout[key] && vertex.count > 0
        ? new TYPES[vertex.properties[layout[key][0]].type].ArrayType(vertex.count * size) : null);
    const points = {
        positions: new TYPES[vertex.properties[layout.positions[0]].type].ArrayType(vertex.count * 3),
        normals: allocate('normals', 3),
        uvs: allocate('uvs', 2),
        colors: allocate('colors', 3)
    };
    if (!binary) return readAsciiPoints(bytes, vertex, layout, points);

    const little = header.format === 'binary_little_endian';
    const offsets = [];
    let offset = 0;
    for (const property of vertex.properties) {
        offsets.push(offset);
        offset += TYPES[property.type].size;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + header.headerLength, stride * vertex.count);
    const getterOf = i => TYPES[vertex.properties[i].type].getter;
    const { positions, colors } = points;
    const [x, y, z] = layout.positions;
    const [getX, getY, getZ] = [getterOf(x), getterOf(y), getterOf(z)];
    const colored = colors !== null;
    const rgb = layout.colors;
    const table = colored ? linearByteTable() : null;
    // Positions and colours in this one inline loop: split into a function of
    // its own, 10M uncoloured points took 77 -> 101 ms (Node 22, Apple M2, run
    // after PLYLoader in one process, median of 3).
    for (let i = 0, row = 0; i < vertex.count; i++, row += stride) {
        positions[i * 3] = view[getX](row + offsets[x], little);
        positions[i * 3 + 1] = view[getY](row + offsets[y], little);
        positions[i * 3 + 2] = view[getZ](row + offsets[z], little);
        if (colored) {
            colors[i * 3] = table[view.getUint8(row + offsets[rgb[0]])];
            colors[i * 3 + 1] = table[view.getUint8(row + offsets[rgb[1]])];
            colors[i * 3 + 2] = table[view.getUint8(row + offsets[rgb[2]])];
        }
    }
    for (const key of ['normals', 'uvs']) {
        const target = points[key];
        if (!target) continue;
        const fields = layout[key];
        const getters = fields.map(getterOf);
        for (let i = 0, row = 0, out = 0; i < vertex.count; i++, row += stride) {
            for (let c = 0; c < fields.length; c++) target[out++] = view[getters[c]](row + offsets[fields[c]], little);
        }
    }
    return points;
}
