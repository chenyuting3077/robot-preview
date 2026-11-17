import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshoptEncoder } from '../../packages/mesh-splat/node_modules/meshoptimizer/meshopt_encoder.js';
import { MeshoptDecoder } from '../../packages/mesh-splat/node_modules/meshoptimizer/meshopt_decoder.mjs';
import { encodeStepCache, decodeStepCache } from '../../packages/mesh-splat/webview/step-cache.mjs';

test('STEP cache round-trips meshes within the codec precision', async () => {
    await MeshoptEncoder.ready;
    await MeshoptDecoder.ready;
    const positions = new Float32Array([0, 0, 0, 1.5, 0, 0, 0, 2.25, 0, 0, 0, -3]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const groups = [{ start: 0, count: 3, color: [1, 0, 0] }, { start: 3, count: 3, color: [0.5, 0.5, 0.5] }];
    const [mesh] = decodeStepCache(MeshoptDecoder, encodeStepCache(MeshoptEncoder, [{ name: 'part', positions, normals, indices, groups }]));
    assert.equal(mesh.name, 'part');
    assert.deepEqual(mesh.groups, groups);
    mesh.positions.forEach((value, i) => assert.ok(Math.abs(value - positions[i]) < 1e-3));
    for (let v = 0; v < 4; v++) assert.deepEqual([...mesh.normals.subarray(v * 4, v * 4 + 3)], [...normals.subarray(v * 3, v * 3 + 3)].map(n => n * 127));
    // Each triangle keeps its corners and winding, possibly rotated.
    const rotations = t => [0, 1, 2].map(r => [0, 1, 2].map(k => t[(k + r) % 3]).join());
    for (let t = 0; t < 2; t++) assert.ok(rotations([...indices.subarray(t * 3, t * 3 + 3)]).includes([...mesh.indices.subarray(t * 3, t * 3 + 3)].join()));
});
