import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposeModel } from '../../src/renderer/disposeModel.js';

const disposed = resource => {
    let done = false;
    resource.addEventListener('dispose', () => { done = true; });
    return () => done;
};

test('disposing a model frees its geometries, materials and the textures the next model does not use', () => {
    const shared = new THREE.Texture();
    const own = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: shared, normalMap: own });
    const geometry = new THREE.BoxGeometry();
    const old = new THREE.Group().add(new THREE.Mesh(geometry, material));
    const next = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: shared })));
    const checks = { geometry: disposed(geometry), material: disposed(material), shared: disposed(shared), own: disposed(own) };
    disposeModel(old, next);
    assert.deepEqual(Object.fromEntries(Object.entries(checks).map(([name, done]) => [name, done()])), { geometry: true, material: true, shared: false, own: true });
});
