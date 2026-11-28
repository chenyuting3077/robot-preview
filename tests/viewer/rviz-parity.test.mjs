// The URDF viewer draws what RViz draws for the cases tests/fixtures/rviz-parity/robot.urdf lists (#28).
import './xml-dom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { ModelLoaderFactory } from '../../src/loaders/ModelLoaderFactory.js';
import { clampToLimits } from '../../src/models/UnifiedRobotModel.js';

const dir = new URL('../fixtures/rviz-parity/', import.meta.url);
const read = name => new File([fs.readFileSync(new URL(name, dir))], name.split('/').pop());
const urdf = fs.readFileSync(new URL('robot.urdf', dir), 'utf8');
const fileMap = new Map(['robot.urdf', 'meshes/Wedge.STL', 'meshes/wedge.gltf'].map(name => [`/ws/${name}`, read(name)]));
const model = await ModelLoaderFactory.loadURDF(urdf, '/ws/robot.urdf', fileMap);
await model.meshesReady;
model.threeObject.updateMatrixWorld(true);

const meshesOf = linkName => {
    const meshes = [];
    model.threeObject.links[linkName].traverse(o => {
        let link = o;
        while (!link.isURDFLink) link = link.parent;
        if (o.isMesh && link.name === linkName) meshes.push(o);
    });
    return meshes;
};
const colorOf = linkName => meshesOf(linkName).map(m => m.material.color.getHexString());
const boxOf = linkName => new THREE.Box3().setFromObject(meshesOf(linkName)[0]);

test('every mesh loads, upper-case .STL included', () => {
    assert.deepEqual(model.missingMeshes, []);
    assert.deepEqual(model.guessedMeshes, []);
    assert.equal(meshesOf('stl_right').length, 1);
});

test('all visuals of a link are drawn', () => {
    assert.equal(meshesOf('multi_visual').length, 3);
});

test('a named material defined in one link colors a later link that names it', () => {
    const orange = 'ff8000';
    assert.deepEqual(colorOf('local_definition'), [orange]);
    assert.deepEqual(colorOf('local_reference'), [orange]);
});

test('a robot-level material wins over the color a visual gives for the same name', () => {
    assert.deepEqual(colorOf('robot_material_wins'), ['33b34d']);
});

test('a URDF material replaces a mesh\'s own; without one the mesh keeps it', () => {
    assert.deepEqual(colorOf('gltf_urdf_material'), ['33b34d']);
    // glTF baseColorFactor is linear by spec, unlike URDF rgba.
    assert.deepEqual(colorOf('gltf_own_material'), [new THREE.Color(0.8, 0.1, 0.1).getHexString()]);
});

test('URDF rgba is a display color: 0.2 0.7 0.3 shows as #33b34d, as in RViz (#58)', () => {
    assert.deepEqual(colorOf('multi_visual'), ['33b34d', '33b34d', '33b34d']);
});

test('negative scale mirrors the mesh', () => {
    assert.ok(meshesOf('stl_right')[0].matrixWorld.determinant() > 0);
    assert.ok(meshesOf('stl_mirrored')[0].matrixWorld.determinant() < 0);
    const right = boxOf('stl_right');
    const mirrored = boxOf('stl_mirrored');
    assert.ok(Math.abs(right.min.x - 0) < 1e-6 && Math.abs(right.max.x - 0.2) < 1e-6);
    assert.ok(Math.abs(mirrored.min.x - -0.3) < 1e-6 && Math.abs(mirrored.max.x - -0.1) < 1e-6);
});

test('STL keeps its axes; glTF is turned from Y-up to Z-up and placed by the visual origin', () => {
    const stl = boxOf('stl_right');
    assert.ok(Math.abs(stl.max.z - stl.min.z - 0.3) < 1e-6, 'STL wedge stands 0.3 along z');
    const gltf = boxOf('gltf_own_material');
    assert.ok(Math.abs(gltf.max.z - gltf.min.z - 0.3) < 1e-6, 'glTF wedge stands 0.3 along z');
    assert.ok(Math.abs(gltf.min.z - (-0.15 + 0.05)) < 1e-6, 'origin z offset applied');
    assert.ok(Math.abs(gltf.min.x - 0.4) < 1e-6 && Math.abs(gltf.max.x - 0.6) < 1e-6, 'slope faces -x like the STL');
});

test('continuous joints turn past their parsed 0..0 limits', () => {
    for (const name of ['wheel', 'wheel_with_effort']) {
        const joint = model.joints.get(name);
        assert.equal(joint.type, 'continuous');
        assert.equal(clampToLimits(joint, 5), 5);
        assert.equal(clampToLimits(joint, -5), -5);
    }
});

test('a revolute joint is still clamped to its limits', () => {
    assert.equal(clampToLimits({ type: 'revolute', limits: { lower: -1, upper: 1 } }, 5), 1);
    assert.equal(clampToLimits({ type: 'prismatic', limits: { lower: 0, upper: NaN } }, 5), 5);
});
