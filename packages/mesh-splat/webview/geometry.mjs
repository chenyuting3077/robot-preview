import { linearByteTable } from './ply.mjs';
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

// Per-point turbo colors over the 2nd-98th percentile, so a few outliers don't
// squash the rest into one color.
// Non-finite values (NaN points of an organized cloud) get the lowest color and stay out of the range.
export function colorize(values, colors = new Uint8Array(values.length * 3)) {
    const sorted = values.filter(Number.isFinite);
    const low = percentile(sorted, 0.02), high = percentile(sorted, 0.98);
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

// Height along an up axis such as '-Z', from interleaved xyz.
export function heights(positions, up) {
    const axis = 'XYZ'.indexOf(up[1]), sign = up[0] === '-' ? -1 : 1;
    const values = new Float32Array(positions.length / 3);
    for (let i = 0; i < values.length; i++) values[i] = sign * positions[i * 3 + axis];
    return values;
}
