// Exact nearest distances from points to a reference cloud or mesh (CloudCompare's C2C / C2M); see docs/mesh-splat.md.

import { finiteValues, percentile } from './geometry.mjs';

const STACK = 128;

// Positions placed by a column-major 4x4 `matrix` (three.js elements, float64), in float32.
export function placedPositions(positions, matrix, out = new Float32Array(positions.length)) {
    const [a, b, c, , d, e, f, , g, h, i, , x, y, z] = matrix;
    for (let p = 0; p < positions.length; p += 3) {
        const px = positions[p], py = positions[p + 1], pz = positions[p + 2];
        out[p] = a * px + d * py + g * pz + x;
        out[p + 1] = b * px + e * py + h * pz + y;
        out[p + 2] = c * px + f * py + i * pz + z;
    }
    return out;
}

// Reorders slots left..right so that the k-th smallest centroid along `axis` sits at k, smaller ones before it.
// The centroids and bounds move with their slot, so every pass reads memory in order and a point cloud needs no
// reordered copy afterwards: 10M points build in 6.1 s against 7.7 s selecting through an index (Node 22, Apple M2).
function select(order, centers, bounds, axis, left, right, k) {
    const swap = (i, j) => {
        const o = order[i]; order[i] = order[j]; order[j] = o;
        for (let c = 0; c < 3; c++) {
            const value = centers[i * 3 + c]; centers[i * 3 + c] = centers[j * 3 + c]; centers[j * 3 + c] = value;
        }
        if (bounds) for (let c = 0; c < 6; c++) {
            const value = bounds[i * 6 + c]; bounds[i * 6 + c] = bounds[j * 6 + c]; bounds[j * 6 + c] = value;
        }
    };
    while (right > left) {
        const pivot = centers[((left + right) >> 1) * 3 + axis];
        let i = left;
        let j = right;
        while (i <= j) {
            while (centers[i * 3 + axis] < pivot) i++;
            while (centers[j * 3 + axis] > pivot) j--;
            if (i <= j) {
                swap(i, j);
                i++;
                j--;
            }
        }
        if (k <= j) right = j;
        else if (k >= i) left = i;
        else return;
    }
}

// The tree over `count` primitives with centroids `centers` (xyz) and bounds `bounds` (min xyz, max xyz each, or
// null for points, whose bounds are their centers), both reordered in place into leaf order; `order` gives each
// slot's original primitive. Splits look only at centroids, and boxes are filled in afterwards from the leaves
// up, instead of widening every node's box by each of its primitives (1M triangles: 0.6-0.7 s against 1.4 s, Node 22, Apple M2).
function buildTree(count, centers, bounds, leafSize) {
    const order = new Uint32Array(count);
    for (let i = 0; i < count; i++) order[i] = i;
    const capacity = Math.max(1, 2 * Math.ceil(count / Math.max(1, leafSize >> 1)) + 1);
    const boxes = new Float32Array(capacity * 6);
    const starts = new Uint32Array(capacity);
    // A leaf's primitive count, or 0 for a node whose children are `firsts[node]` and the one after it.
    const counts = new Uint32Array(capacity);
    const firsts = new Uint32Array(capacity);
    let nodes = 1;
    const pending = [0, 0, count];
    while (pending.length) {
        const end = pending.pop(), start = pending.pop(), node = pending.pop();
        starts[node] = start;
        let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
        for (let i = start; i < end; i++) {
            const c = i * 3;
            const x = centers[c], y = centers[c + 1], z = centers[c + 2];
            if (x < cx0) cx0 = x;
            if (x > cx1) cx1 = x;
            if (y < cy0) cy0 = y;
            if (y > cy1) cy1 = y;
            if (z < cz0) cz0 = z;
            if (z > cz1) cz1 = z;
        }
        const ex = cx1 - cx0, ey = cy1 - cy0, ez = cz1 - cz0;
        // Primitives that all share one centroid (repeated points) cannot be split and stay one leaf.
        if (end - start <= leafSize || !(Math.max(ex, ey, ez) > 0)) {
            counts[node] = end - start;
            const o = node * 6;
            let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
            const lo = bounds ?? centers;
            for (let i = start; i < end; i++) {
                const l = bounds ? i * 6 : i * 3, h = bounds ? l + 3 : l;
                if (lo[l] < x0) x0 = lo[l];
                if (lo[l + 1] < y0) y0 = lo[l + 1];
                if (lo[l + 2] < z0) z0 = lo[l + 2];
                if (lo[h] > x1) x1 = lo[h];
                if (lo[h + 1] > y1) y1 = lo[h + 1];
                if (lo[h + 2] > z1) z1 = lo[h + 2];
            }
            boxes[o] = x0; boxes[o + 1] = y0; boxes[o + 2] = z0;
            boxes[o + 3] = x1; boxes[o + 4] = y1; boxes[o + 5] = z1;
            continue;
        }
        const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
        const middle = (start + end) >> 1;
        select(order, centers, bounds, axis, start, end - 1, middle);
        firsts[node] = nodes;
        pending.push(nodes, start, middle, nodes + 1, middle, end);
        nodes += 2;
    }
    // Children are numbered after their parent, so walking back fills every child before its parent.
    for (let node = nodes - 1; node >= 0; node--) {
        if (counts[node] || node >= nodes) continue;
        const o = node * 6, a = firsts[node] * 6, b = a + 6;
        for (let k = 0; k < 3; k++) {
            boxes[o + k] = Math.min(boxes[a + k], boxes[b + k]);
            boxes[o + k + 3] = Math.max(boxes[a + k + 3], boxes[b + k + 3]);
        }
    }
    // An empty leaf (no primitives at all) keeps an inverted box, which every query passes by.
    // float32 boxes rounded outward would need nextafter; widening by a relative hair keeps every primitive inside.
    for (let o = 0; o < nodes * 6; o += 6) {
        for (let k = 0; k < 3; k++) {
            const pad = Math.max(Math.abs(boxes[o + k]), Math.abs(boxes[o + k + 3])) * 1e-6 + 1e-30;
            boxes[o + k] -= pad;
            boxes[o + k + 3] += pad;
        }
    }
    return { order, boxes, starts, counts, firsts, nodes };
}

const boxDistance2 = (boxes, node, x, y, z) => {
    const o = node * 6;
    const dx = Math.max(boxes[o] - x, 0, x - boxes[o + 3]);
    const dy = Math.max(boxes[o + 1] - y, 0, y - boxes[o + 4]);
    const dz = Math.max(boxes[o + 2] - z, 0, z - boxes[o + 5]);
    return dx * dx + dy * dy + dz * dz;
};

// Squared distance from p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5), by closest feature.
export function triangleDistance2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    let qx, qy, qz;
    if (d1 <= 0 && d2 <= 0) {
        qx = ax; qy = ay; qz = az;
    } else {
        const bpx = px - bx, bpy = py - by, bpz = pz - bz;
        const d3 = abx * bpx + aby * bpy + abz * bpz;
        const d4 = acx * bpx + acy * bpy + acz * bpz;
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        const vc = d1 * d4 - d3 * d2;
        const vb = d5 * d2 - d1 * d6;
        const va = d3 * d6 - d5 * d4;
        if (d3 >= 0 && d4 <= d3) {
            qx = bx; qy = by; qz = bz;
        } else if (d6 >= 0 && d5 <= d6) {
            qx = cx; qy = cy; qz = cz;
        } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
            const v = d1 / (d1 - d3);
            qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz;
        } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz;
        } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
            const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
            qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz);
        } else {
            const denom = 1 / (va + vb + vc);
            const v = vb * denom;
            const w = vc * denom;
            // A degenerate (zero-area) triangle that reaches here gives NaN; its edges were tested above.
            if (!Number.isFinite(v) || !Number.isFinite(w)) return segmentsDistance2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz);
            qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
        }
    }
    const dx = px - qx, dy = py - qy, dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
}

function segmentDistance2(px, py, pz, ax, ay, az, bx, by, bz) {
    const ex = bx - ax, ey = by - ay, ez = bz - az;
    const length2 = ex * ex + ey * ey + ez * ez;
    const t = length2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey + (pz - az) * ez) / length2)) : 0;
    const dx = px - ax - t * ex, dy = py - ay - t * ey, dz = pz - az - t * ez;
    return dx * dx + dy * dy + dz * dz;
}

const segmentsDistance2 = (px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) => Math.min(
    segmentDistance2(px, py, pz, ax, ay, az, bx, by, bz),
    segmentDistance2(px, py, pz, bx, by, bz, cx, cy, cz),
    segmentDistance2(px, py, pz, cx, cy, cz, ax, ay, az)
);

// Points as interleaved xyz. Kept in leaf order so a leaf's points sit together in memory.
export function pointTree(points, leafSize = 8) {
    const count = points.length / 3;
    // Reordered in place, a copy: the caller's array is the cloud's own.
    const sorted = points.slice();
    const tree = buildTree(count, sorted, null, leafSize);
    tree.order = null;
    let last = 0;
    const stack = new Uint32Array(STACK);
    const near = new Float64Array(STACK);
    return {
        ...tree,
        // Starts from the point nearest the previous query: clouds come in scan or file order, so that guess is near.
        nearest2(x, y, z) {
            if (!count) return Infinity;
            let dx = sorted[last * 3] - x, dy = sorted[last * 3 + 1] - y, dz = sorted[last * 3 + 2] - z;
            let best = dx * dx + dy * dy + dz * dz;
            const { boxes, starts, counts, firsts } = tree;
            let top = 0;
            stack[top] = 0;
            near[top++] = boxDistance2(boxes, 0, x, y, z);
            while (top) {
                const node = stack[--top];
                if (near[top] >= best) continue;
                if (counts[node]) {
                    for (let i = starts[node], end = i + counts[node]; i < end; i++) {
                        dx = sorted[i * 3] - x; dy = sorted[i * 3 + 1] - y; dz = sorted[i * 3 + 2] - z;
                        const d = dx * dx + dy * dy + dz * dz;
                        if (d < best) { best = d; last = i; }
                    }
                    continue;
                }
                const left = firsts[node];
                const dl = boxDistance2(boxes, left, x, y, z), dr = boxDistance2(boxes, left + 1, x, y, z);
                // The nearer child is popped first.
                const [far, farD, close, closeD] = dl <= dr ? [left + 1, dr, left, dl] : [left, dl, left + 1, dr];
                if (farD < best) { stack[top] = far; near[top++] = farD; }
                if (closeD < best) { stack[top] = close; near[top++] = closeD; }
            }
            return best;
        }
    };
}

// Triangles as `vertices` (interleaved xyz) and `indices` (three per triangle).
export function triangleTree(vertices, indices, leafSize = 4) {
    const count = indices.length / 3;
    const centers = new Float32Array(count * 3);
    const bounds = new Float32Array(count * 6);
    for (let t = 0; t < count; t++) {
        const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
        for (let k = 0; k < 3; k++) {
            const va = vertices[a + k], vb = vertices[b + k], vc = vertices[c + k];
            centers[t * 3 + k] = (va + vb + vc) / 3;
            bounds[t * 6 + k] = Math.min(va, vb, vc);
            bounds[t * 6 + k + 3] = Math.max(va, vb, vc);
        }
    }
    const tree = buildTree(count, centers, bounds, leafSize);
    // Each leaf's triangles as nine floats in a row: the leaf test then reads memory in order.
    const corners = new Float32Array(count * 9);
    for (let i = 0; i < count; i++) {
        const t = tree.order[i];
        for (let corner = 0; corner < 3; corner++) {
            const from = indices[t * 3 + corner] * 3;
            corners[i * 9 + corner * 3] = vertices[from];
            corners[i * 9 + corner * 3 + 1] = vertices[from + 1];
            corners[i * 9 + corner * 3 + 2] = vertices[from + 2];
        }
    }
    tree.order = null;
    const at = (i, x, y, z) => triangleDistance2(x, y, z, corners[i * 9], corners[i * 9 + 1], corners[i * 9 + 2], corners[i * 9 + 3], corners[i * 9 + 4], corners[i * 9 + 5], corners[i * 9 + 6], corners[i * 9 + 7], corners[i * 9 + 8]);
    let last = 0;
    const stack = new Uint32Array(STACK);
    const near = new Float64Array(STACK);
    return {
        ...tree,
        nearest2(x, y, z) {
            if (!count) return Infinity;
            let best = at(last, x, y, z);
            const { boxes, starts, counts, firsts } = tree;
            let top = 0;
            stack[top] = 0;
            near[top++] = boxDistance2(boxes, 0, x, y, z);
            while (top) {
                const node = stack[--top];
                if (near[top] >= best) continue;
                if (counts[node]) {
                    for (let i = starts[node], end = i + counts[node]; i < end; i++) {
                        const d = at(i, x, y, z);
                        if (d < best) { best = d; last = i; }
                    }
                    continue;
                }
                const left = firsts[node];
                const dl = boxDistance2(boxes, left, x, y, z), dr = boxDistance2(boxes, left + 1, x, y, z);
                const [far, farD, close, closeD] = dl <= dr ? [left + 1, dr, left, dl] : [left, dl, left + 1, dr];
                if (farD < best) { stack[top] = far; near[top++] = farD; }
                if (closeD < best) { stack[top] = close; near[top++] = closeD; }
            }
            return best;
        }
    };
}

// A reference from parts as the page sends them: { positions, matrix, indices? }, a part with indices (or a
// mesh's non-indexed positions, `mesh: true`) being triangles, the others points. Every part is placed by its
// matrix into one frame.
export function referenceOf(parts) {
    const points = parts.filter(part => !part.mesh);
    const meshes = parts.filter(part => part.mesh);
    const trees = [];
    if (points.length) {
        const all = new Float32Array(points.reduce((n, part) => n + part.positions.length, 0));
        let at = 0;
        for (const part of points) {
            placedPositions(part.positions, part.matrix, all.subarray(at, at + part.positions.length));
            at += part.positions.length;
        }
        trees.push(pointTree(all));
    }
    if (meshes.length) {
        const vertexCount = meshes.reduce((n, part) => n + part.positions.length, 0);
        const indexCount = meshes.reduce((n, part) => n + (part.indices?.length ?? part.positions.length / 3), 0);
        const vertices = new Float32Array(vertexCount);
        const indices = new Uint32Array(indexCount);
        let v = 0;
        let i = 0;
        for (const part of meshes) {
            placedPositions(part.positions, part.matrix, vertices.subarray(v, v + part.positions.length));
            const base = v / 3;
            if (part.indices) for (let k = 0; k < part.indices.length; k++) indices[i++] = part.indices[k] + base;
            else for (let k = 0; k < part.positions.length / 3; k++) indices[i++] = base + k;
            v += part.positions.length;
        }
        trees.push(triangleTree(vertices, indices));
    }
    return {
        // Distances for one part's positions, placed by its matrix into the reference's frame.
        distances(positions, matrix, out = new Float32Array(positions.length / 3)) {
            const [a, b, c, , d, e, f, , g, h, k, , x, y, z] = matrix;
            for (let p = 0, n = 0; p < positions.length; p += 3, n++) {
                const px = positions[p], py = positions[p + 1], pz = positions[p + 2];
                const qx = a * px + d * py + g * pz + x, qy = b * px + e * py + h * pz + y, qz = c * px + f * py + k * pz + z;
                let best = Infinity;
                for (const tree of trees) best = Math.min(best, tree.nearest2(qx, qy, qz));
                out[n] = Math.sqrt(best);
            }
            return out;
        }
    };
}

// Mean, RMS, 95th percentile and max of finite distances, and the share within `tolerance`.
export function distanceStats(lists, tolerance) {
    let count = 0, sum = 0, squares = 0, max = 0, within = 0;
    for (const values of lists) for (const value of values) {
        if (!Number.isFinite(value)) continue;
        count++;
        sum += value;
        squares += value * value;
        if (value > max) max = value;
        if (value <= tolerance) within++;
    }
    if (!count) return null;
    return { count, mean: sum / count, rms: Math.sqrt(squares / count), p95: percentile(finiteValues(lists), 0.95), max, within: within / count };
}

// A first tolerance from the distances themselves: three times the median, where two registered files' noise
// usually lies (a guess, not measured on real pairs), rounded to 1, 2 or 5 of a power of ten so it reads as a
// number someone would type. Files that coincide (median 0) take a tenth of the 98th percentile instead.
export function defaultTolerance(lists) {
    const all = finiteValues(lists);
    if (!all.length) return 0;
    const median = percentile(all, 0.5);
    const raw = median > 0 ? median * 3 : percentile(all, 0.98) / 10;
    if (!(raw > 0)) return 0;
    const power = 10 ** Math.floor(Math.log10(raw));
    // The nearest step on a log scale: 0.03 gives 0.02, 0.15 gives 0.2.
    const steps = [1, 2, 5, 10].map(step => step * power);
    return steps.reduce((best, value) => (Math.abs(Math.log(value / raw)) < Math.abs(Math.log(best / raw)) ? value : best));
}
