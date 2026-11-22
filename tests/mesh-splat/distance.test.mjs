import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointTree, triangleTree, triangleDistance2, referenceOf, placedPositions, distanceStats, defaultTolerance } from '../../packages/mesh-splat/webview/distance.mjs';

// A seeded generator, so a failure repeats.
function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 2 ** 32;
    };
}
const cloud = (count, rand, scale = 10) => Float32Array.from({ length: count * 3 }, () => (rand() - 0.5) * scale);
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test('nearest points match brute force, in any query order', () => {
    const rand = random(1);
    const reference = cloud(5000, rand);
    const queries = cloud(800, rand, 14);
    const tree = pointTree(reference);
    // Queries in random order, then repeated: the start from the previous answer must not change any result.
    for (let pass = 0; pass < 2; pass++) {
        for (let q = 0; q < queries.length; q += 3) {
            let best = Infinity;
            for (let r = 0; r < reference.length; r += 3) {
                const dx = reference[r] - queries[q], dy = reference[r + 1] - queries[q + 1], dz = reference[r + 2] - queries[q + 2];
                best = Math.min(best, dx * dx + dy * dy + dz * dz);
            }
            assert.ok(Math.abs(tree.nearest2(queries[q], queries[q + 1], queries[q + 2]) - best) < 1e-9, `query ${q / 3}`);
        }
    }
});

test('repeated and coincident points still build and answer', () => {
    const reference = new Float32Array(3 * 100).fill(1);
    const tree = pointTree(reference);
    assert.equal(tree.nearest2(1, 1, 3), 4);
    assert.equal(pointTree(new Float32Array()).nearest2(0, 0, 0), Infinity);
});

test('a triangle gives the distance to its nearest vertex, edge or face', () => {
    const t = [0, 0, 0, 2, 0, 0, 0, 2, 0];
    const cases = [
        [[0.5, 0.5, 3], 9], // face
        [[-1, -1, 0], 2], // vertex a
        [[3, -1, 0], 2], // vertex b
        [[-1, 3, 0], 2], // vertex c
        [[1, -2, 0], 4], // edge ab
        [[-2, 1, 0], 4], // edge ac
        [[2, 2, 0], 2] // edge bc
    ];
    for (const [p, expected] of cases) assert.ok(Math.abs(triangleDistance2(...p, ...t) - expected) < 1e-12, p.join());
    // Degenerate: a segment and a point.
    assert.ok(Math.abs(triangleDistance2(1, 1, 0, 0, 0, 0, 2, 0, 0, 1, 0, 0) - 1) < 1e-12);
    assert.ok(Math.abs(triangleDistance2(0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0) - 4) < 1e-12);
});

test('nearest triangles match brute force', () => {
    const rand = random(2);
    const vertices = cloud(600, rand);
    const indices = Uint32Array.from({ length: 900 }, () => Math.floor(rand() * 600));
    const tree = triangleTree(vertices, indices);
    const queries = cloud(300, rand, 14);
    for (let q = 0; q < queries.length; q += 3) {
        let best = Infinity;
        for (let t = 0; t < indices.length; t += 3) {
            const corner = k => [...vertices.subarray(indices[t + k] * 3, indices[t + k] * 3 + 3)];
            best = Math.min(best, triangleDistance2(queries[q], queries[q + 1], queries[q + 2], ...corner(0), ...corner(1), ...corner(2)));
        }
        assert.ok(Math.abs(tree.nearest2(queries[q], queries[q + 1], queries[q + 2]) - best) < 1e-9, `query ${q / 3}`);
    }
});

test('a reference of a cloud and a mesh in different frames gives the nearer of both', () => {
    // A unit square in z = 0 (two triangles) moved up by 10, and one point at x = 5 moved by the same.
    const square = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]), mesh: true, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1] };
    const point = { positions: new Float32Array([5, 0, 0]), matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1] };
    const reference = referenceOf([square, point]);
    const out = reference.distances(new Float32Array([0.5, 0.5, 12, 5, 0, 13, 3, 0.5, 10]), IDENTITY);
    assert.deepEqual([...out].map(value => +value.toFixed(6)), [2, 3, 2]);
    // The queries' own matrix places them too: moved down by 10 they sit on the square's plane.
    const placed = reference.distances(new Float32Array([0.5, 0.5, 0]), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1]);
    assert.equal(placed[0], 0);
    // Non-indexed triangles (STL) read three vertices per triangle.
    const flat = referenceOf([{ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), mesh: true, matrix: IDENTITY }]);
    assert.equal(flat.distances(new Float32Array([0.2, 0.2, 4]), IDENTITY)[0], 4);
});

test('placing positions applies rotation and translation', () => {
    // 90 degrees about z, then +1 in x.
    const matrix = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1];
    assert.deepEqual([...placedPositions(new Float32Array([1, 0, 0, 0, 1, 2]), matrix)], [1, 1, 0, 0, 0, 2]);
});

test('stats give mean, RMS, 95th percentile, max and the share within tolerance, skipping non-finite', () => {
    const values = Float32Array.from({ length: 100 }, (_, i) => i / 100);
    const stats = distanceStats([values, new Float32Array([NaN])], 0.5);
    assert.equal(stats.count, 100);
    assert.ok(Math.abs(stats.mean - 0.495) < 1e-6);
    assert.ok(Math.abs(stats.rms - Math.sqrt(values.reduce((s, v) => s + v * v, 0) / 100)) < 1e-6);
    assert.ok(Math.abs(stats.p95 - 0.94) < 1e-6);
    assert.ok(Math.abs(stats.max - 0.99) < 1e-6);
    assert.equal(stats.within, 0.51);
    assert.equal(distanceStats([new Float32Array([NaN])], 1), null);
});

test('the first tolerance is three medians, rounded to 1, 2 or 5 of a power of ten', () => {
    assert.equal(defaultTolerance([Float32Array.from({ length: 101 }, (_, i) => i / 1000)]), 0.2);
    assert.equal(defaultTolerance([new Float32Array([0.01, 0.01, 0.01, 4])]), 0.02);
    // Coinciding files: a tenth of the 98th percentile.
    assert.equal(defaultTolerance([new Float32Array([0, 0, 0, 0, 3])]), 0);
    assert.equal(+defaultTolerance([Float32Array.from({ length: 100 }, (_, i) => (i > 50 ? 1 : 0))]).toFixed(6), 0.1);
    assert.equal(defaultTolerance([new Float32Array([NaN])]), 0);
});
