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
