import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../packages/mesh-splat/node_modules/three/build/three.module.js';
import { UP, relativeUp } from '../../packages/mesh-splat/webview/up.mjs';

const AXES = { '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1] };
const close = (v, [x, y, z]) => Math.abs(v.x - x) + Math.abs(v.y - y) + Math.abs(v.z - z) < 1e-9;

test('the view\'s up turns its axis to the screen\'s up', () => {
    for (const [name, axis] of Object.entries(AXES)) {
        const v = new THREE.Vector3(...axis).applyEuler(new THREE.Euler(...UP[name]));
        assert.ok(close(v, [0, 1, 0]), name);
    }
});

test('a file\'s declared up, turned into the view\'s frame, ends up on screen like the view\'s own up', () => {
    // The view turns by the up of the file it opened with; an added file by its own up relative to that.
    for (const view of Object.keys(AXES)) {
        for (const file of Object.keys(AXES)) {
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...UP[view])).multiply(relativeUp(view, file));
            assert.ok(close(new THREE.Vector3(...AXES[file]).applyQuaternion(q), [0, 1, 0]), `${file} in a ${view} view`);
        }
    }
});

test('a glTF (+Y) in a point cloud\'s +Z view stands up, and a map (+Z) in a glTF view lies flat', () => {
    // In the view's frame: the glTF's up becomes the view's +Z, the map's up the view's +Y.
    assert.ok(close(new THREE.Vector3(0, 1, 0).applyQuaternion(relativeUp('+Z', '+Y')), [0, 0, 1]));
    assert.ok(close(new THREE.Vector3(0, 0, 1).applyQuaternion(relativeUp('+Y', '+Z')), [0, 1, 0]));
    assert.ok(relativeUp('+Z', '+Z').equals(new THREE.Quaternion()));
});
