import { Color, SRGBColorSpace } from 'three';

// Binary property types by PLY name (`float`, `uchar`, ...) and by size (`float32`, `uint8`, ...).
export const TYPES = {};
for (const [names, ArrayType, getter] of [
    [['char', 'int8'], Int8Array, 'getInt8'], [['uchar', 'uint8'], Uint8Array, 'getUint8'],
    [['short', 'int16'], Int16Array, 'getInt16'], [['ushort', 'uint16'], Uint16Array, 'getUint16'],
    [['int', 'int32'], Int32Array, 'getInt32'], [['uint', 'uint32'], Uint32Array, 'getUint32'],
    [['float', 'float32'], Float32Array, 'getFloat32'], [['double', 'float64'], Float64Array, 'getFloat64']
]) for (const name of names) TYPES[name] = { ArrayType, getter, size: ArrayType.BYTES_PER_ELEMENT, float: getter.startsWith('getFloat') };

// 8-bit sRGB to the linear bytes three.js keeps for vertex colors.
let srgbToLinearByte = null;
const color = new Color();
export const linearByte = value => Math.round(color.setRGB(value * (1 / 255), 0, 0, SRGBColorSpace).r * 255);

export function linearByteTable() {
    srgbToLinearByte ??= Uint8Array.from({ length: 256 }, (_, i) => linearByte(i));
    return srgbToLinearByte;
}

// Triangles, and quads split along the a-c diagonal as three.js does.
export function writeFace(out, at, a, b, c, d) {
    out[at] = a; out[at + 1] = b; out[at + 2] = c;
    if (d === undefined) return at + 3;
    out[at + 3] = a; out[at + 4] = c; out[at + 5] = d;
    return at + 6;
}
// Typed-array replacements with exactly the results of the three.js / sort code
// they replace (the tests compare them). 3M splats, percentile per axis: sort
// 1554 -> 26 ms; 5M STL triangles, normals 226 -> 204 ms (Node 22, Apple M2,
// median of 3).

// computeVertexNormals for non-indexed triangles, in the same operation order
// and float32 storage, so every value matches.
export function flatNormals(positions) {
    const normals = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 9) {
        const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
        const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
        const cbx = positions[i + 6] - bx, cby = positions[i + 7] - by, cbz = positions[i + 8] - bz;
        const abx = ax - bx, aby = ay - by, abz = az - bz;
        normals[i] = cby * abz - cbz * aby;
        normals[i + 1] = cbz * abx - cbx * abz;
        normals[i + 2] = cbx * aby - cby * abx;
        const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
        const scale = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
        normals[i] = nx * scale;
        normals[i + 1] = ny * scale;
        normals[i + 2] = nz * scale;
        normals.copyWithin(i + 3, i, i + 3);
        normals.copyWithin(i + 6, i, i + 3);
    }
    return normals;
}

// The value a sort would put at floor((n - 1) * q), by quickselect: O(n)
// instead of sorting millions of splat centres. Reorders `values`.
export function percentile(values, q) {
    const k = Math.floor((values.length - 1) * q);
    let left = 0;
    let right = values.length - 1;
    while (left < right) {
        const pivot = values[(left + right) >> 1];
        let i = left;
        let j = right;
        while (i <= j) {
            while (values[i] < pivot) i++;
            while (values[j] > pivot) j--;
            if (i <= j) {
                const swap = values[i];
                values[i] = values[j];
                values[j] = swap;
                i++;
                j--;
            }
        }
        if (k <= j) right = j;
        else if (k >= i) left = i;
        else break;
    }
    return values[k];
}

export function grown(array, minLength = 0) {
    const bigger = new array.constructor(Math.max(array.length * 2, minLength));
    bigger.set(array);
    return bigger;
}

// Turbo (Google's polynomial fit) as linear bytes for a normalized color attribute.
let turboTable;
function turbo() {
    if (turboTable) return turboTable;
    const srgb = linearByteTable();
    const poly = (t, c) => c.reduceRight((sum, k) => sum * t + k, 0);
    const channels = [
        [0.13572138, 4.6153926, -42.66032258, 132.13108234, -152.94239396, 59.28637943],
        [0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604],
        [0.1066733, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973]
    ];
    turboTable = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) channels.forEach((c, j) => {
        turboTable[i * 3 + j] = srgb[Math.round(Math.min(1, Math.max(0, poly(i / 255, c))) * 255)];
    });
    return turboTable;
}

// The 2nd-98th percentile of the finite values of all `lists`, so a few outliers don't squash the rest into
// one color, and clouds shown together share one scale.
export function colorRange(lists) {
    const finite = new Float32Array(lists.reduce((n, values) => n + values.length, 0));
    let n = 0;
    for (const values of lists) for (const value of values) if (Number.isFinite(value)) finite[n++] = value;
    const sorted = finite.subarray(0, n);
    return [percentile(sorted, 0.02), percentile(sorted, 0.98)];
}

// Per-point turbo colors over `range`; non-finite values get the lowest color.
export function colorize(values, colors = new Uint8Array(values.length * 3), [low, high] = colorRange([values])) {
    const scale = 255 / (high - low || 1);
    const table = turbo();
    for (let i = 0; i < values.length; i++) {
        const k = Math.min(255, Math.max(0, Math.round((values[i] - low) * scale))) * 3 || 0;
        colors[i * 3] = table[k];
        colors[i * 3 + 1] = table[k + 1];
        colors[i * 3 + 2] = table[k + 2];
    }
    return colors;
}

// Height along an up axis such as '-Z', from interleaved xyz placed by `matrix` (column-major 4x4
// elements, as three.js keeps them).
export function heights(positions, up, matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) {
    const axis = 'XYZ'.indexOf(up[1]), sign = up[0] === '-' ? -1 : 1;
    const [x, y, z, w] = [0, 4, 8, 12].map(column => sign * matrix[column + axis]);
    const values = new Float32Array(positions.length / 3);
    for (let i = 0; i < values.length; i++) values[i] = x * positions[i * 3] + y * positions[i * 3 + 1] + z * positions[i * 3 + 2] + w;
    return values;
}

// Indices of the points with finite xyz, or null when all are.
export function finitePoints(positions) {
    const keep = [];
    for (let i = 0; i < positions.length / 3; i++) if (Number.isFinite(positions[i * 3] + positions[i * 3 + 1] + positions[i * 3 + 2])) keep.push(i);
    return keep.length * 3 === positions.length ? null : keep;
}
