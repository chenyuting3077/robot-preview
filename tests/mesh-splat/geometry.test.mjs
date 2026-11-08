import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../packages/mesh-splat/node_modules/three/build/three.module.js';
import { flatNormals, percentile } from '../../packages/mesh-splat/webview/geometry.mjs';

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
