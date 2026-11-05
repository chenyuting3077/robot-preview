import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { flyStep } from '../../src/utils/camera-keys.js';

const setup = () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 2, 10);
    return { camera, target: new THREE.Vector3(0, 0, 0) };
};
const close = (a, b) => assert.ok(a.distanceTo(b) < 1e-6, `${a.toArray()} != ${b.toArray()}`);

test('W moves camera and target toward where the camera looks', () => {
    const { camera, target } = setup();
    const distance = camera.position.distanceTo(target);
    const look = target.clone().sub(camera.position).normalize();
    const start = camera.position.clone();
    flyStep(camera, target, new Set(['w']), 0.5);
    close(camera.position.clone().sub(start).normalize(), look);
    assert.ok(camera.position.y < 2, 'follows the downward view');
    assert.ok(Math.abs(camera.position.distanceTo(target) - distance) < 1e-9);
});

test('A and D stay level', () => {
    const { camera, target } = setup();
    flyStep(camera, target, new Set(['d']), 0.5);
    assert.equal(camera.position.y, 2);
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

test('Q and E turn in place around the camera\'s own up axis', () => {
    const { camera, target } = setup();
    const look = target.clone().sub(camera.position).normalize();
    const cameraUp = look.clone().cross(camera.up).cross(look).normalize();
    flyStep(camera, target, new Set(['q']), 1);
    close(camera.position, new THREE.Vector3(0, 2, 10));
    assert.ok(target.x < 0, 'Q turns left');
    assert.ok(Math.abs(target.clone().sub(camera.position).dot(cameraUp)) < 1e-9, 'view stays perpendicular to the camera up axis');
    const mirrored = setup();
    flyStep(mirrored.camera, mirrored.target, new Set(['e']), 1);
    close(mirrored.target, new THREE.Vector3(-target.x, target.y, target.z));
});

test('looking straight down still strafes and turns without scaling the view', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 10, 0);
    const target = new THREE.Vector3(0, 0, 0);
    camera.lookAt(target);
    flyStep(camera, target, new Set(['d']), 0.5);
    assert.ok(Math.abs(camera.position.x) + Math.abs(camera.position.z) > 1, 'D strafes');
    assert.equal(camera.position.y, 10);
    const before = camera.position.distanceTo(target);
    flyStep(camera, target, new Set(['q']), 0.5);
    assert.ok(Math.abs(camera.position.distanceTo(target) - before) < 1e-9, 'Q keeps the distance');
    assert.ok(target.toArray().every(Number.isFinite));
});
