import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { flyStep } from '../../src/utils/fly-keys.js';

const setup = () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 2, 10);
    return { camera, target: new THREE.Vector3(0, 0, 0) };
};
const close = (a, b) => assert.ok(a.distanceTo(b) < 1e-6, `${a.toArray()} != ${b.toArray()}`);

test('W moves camera and target forward on the horizontal plane', () => {
    const { camera, target } = setup();
    const distance = camera.position.distanceTo(target);
    flyStep(camera, target, new Set(['w']), 0.5);
    assert.equal(camera.position.y, 2);
    assert.equal(target.y, 0);
    assert.ok(camera.position.z < 10);
    assert.ok(Math.abs(camera.position.distanceTo(target) - distance) < 1e-9);
});

test('A and D strafe, S reverses W', () => {
    const { camera, target } = setup();
    flyStep(camera, target, new Set(['d']), 0.5);
    assert.ok(camera.position.x > 0);
    flyStep(camera, target, new Set(['a']), 0.5);
    close(camera.position, new THREE.Vector3(0, 2, 10));
    flyStep(camera, target, new Set(['w', 's']), 0.5);
    close(camera.position, new THREE.Vector3(0, 2, 10));
});

test('Q and E turn the view in place around the up axis', () => {
    const { camera, target } = setup();
    flyStep(camera, target, new Set(['q']), 1);
    close(camera.position, new THREE.Vector3(0, 2, 10));
    assert.ok(target.x < 0, 'Q turns left');
    flyStep(camera, target, new Set(['e']), 1);
    close(target, new THREE.Vector3(0, 0, 0));
});
