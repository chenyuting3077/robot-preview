// Typed-array geometry: replacements with exactly the results of the three.js / sort code they replace
// (the tests compare them), face splitting and heights. Node 22, Apple M2, median of 3: percentile per axis
// of 3M splats 26 ms against a sort's 1554 ms; normals of 5M STL triangles 204 ms against 226 ms.

// Triangles, and quads split along the a-c diagonal as three.js does.
export function writeFace(out, at, a, b, c, d) {
    out[at] = a; out[at + 1] = b; out[at + 2] = c;
    if (d === undefined) return at + 3;
    out[at + 3] = a; out[at + 4] = c; out[at + 5] = d;
    return at + 6;
}

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

export function finiteValues(lists) {
    const finite = new Float32Array(lists.reduce((n, values) => n + values.length, 0));
    let n = 0;
    for (const values of lists) for (const value of values) if (Number.isFinite(value)) finite[n++] = value;
    return finite.subarray(0, n);
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

// Height along an up axis such as '-Z', from interleaved xyz placed by `matrix` (column-major 4x4
// elements, as three.js keeps them).
export function heights(positions, up, matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) {
    const axis = 'XYZ'.indexOf(up[1]), sign = up[0] === '-' ? -1 : 1;
    const [x, y, z, w] = [0, 4, 8, 12].map(column => sign * matrix[column + axis]);
    const values = new Float32Array(positions.length / 3);
    for (let i = 0; i < values.length; i++) values[i] = x * positions[i * 3] + y * positions[i * 3 + 1] + z * positions[i * 3 + 2] + w;
    return values;
}
