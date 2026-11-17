import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../packages/mesh-splat/node_modules/three/build/three.module.js';
import { flatNormals, percentile, colorize, colorRange, heights, finitePoints } from '../../packages/mesh-splat/webview/geometry.mjs';

test('flatNormals equals computeVertexNormals on non-indexed triangles', () => {
    const positions = new Float32Array(Array.from({ length: 9 * 500 }, () => Math.random() * 10 - 5));
    positions.set([0, 0, 0, 1, 0, 0, 2, 0, 0], 0); // a degenerate triangle
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    assert.deepEqual(Array.from(flatNormals(positions)), Array.from(geometry.attributes.normal.array));
});

test('percentile gives the same value as sorting', () => {
    const values = Float32Array.from({ length: 10007 }, () => Math.random() * 100 - 50);
    const sorted = Array.from(values).sort((a, b) => a - b);
    for (const q of [0, 0.02, 0.5, 0.98, 1]) {
        assert.equal(percentile(values.slice(), q), sorted[Math.floor((values.length - 1) * q)]);
    }
});

test('colorize spans turbo over the 2-98th percentile and clamps outliers', () => {
    const values = Float32Array.from({ length: 101 }, (_, i) => i);
    values[100] = 1e9;
    const colors = colorize(values);
    // The outlier gets the top color, the same as the 98th-percentile value.
    assert.deepEqual([...colors.subarray(300, 303)], [...colors.subarray(98 * 3, 99 * 3)]);
    assert.deepEqual([...colors.subarray(0, 3)], [...colors.subarray(6, 9)]);
    assert.notDeepEqual([...colors.subarray(0, 3)], [...colors.subarray(150, 153)]);
});

test('heights reads the signed up axis', () => {
    assert.deepEqual([...heights(new Float32Array([1, 2, 3, 4, 5, 6]), '-Y')], [-2, -5]);
});

test('colorize leaves NaN out of the range', () => {
    const values = Float32Array.from({ length: 50 }, (_, i) => (i % 2 ? NaN : i));
    const colors = colorize(values);
    assert.deepEqual([...colors.subarray(3, 6)], [...colors.subarray(0, 3)]);
    assert.notDeepEqual([...colors.subarray(0, 3)], [...colors.subarray(48 * 3, 49 * 3)]);
});

test('heights follow the placing matrix; colorRange spans every list', () => {
    // Translated by 10 up y and rotated so local z points along y.
    const matrix = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 10, 0, 1];
    assert.deepEqual([...heights(new Float32Array([0, 0, 2]), '+Y', matrix)], [12]);
    const [low, high] = colorRange([Float32Array.from({ length: 50 }, (_, i) => i), Float32Array.from({ length: 50 }, (_, i) => 100 + i)]);
    assert.ok(low < 5 && high > 140);
});

test('finitePoints lists the points with finite xyz', () => {
    assert.equal(finitePoints(new Float32Array([1, 2, 3])), null);
    assert.deepEqual(finitePoints(new Float32Array([1, 2, 3, NaN, NaN, NaN, 4, 5, 6])), [0, 2]);
});
