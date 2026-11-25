import test from 'node:test';
import assert from 'node:assert/strict';
import { modelInfoRows } from '../../src/ui/model-info.js';
import { UnifiedRobotModel, Link, Joint } from '../../src/models/UnifiedRobotModel.js';

const t = key => key;

function arm() {
    const model = new UnifiedRobotModel();
    for (const [name, mass] of [['base', 4], ['upper', 2.5], ['tool', 0]]) {
        const link = new Link(name);
        if (mass) link.inertial = { mass };
        model.addLink(link);
    }
    model.addJoint(new Joint('shoulder', 'revolute'));
    model.addJoint(new Joint('mount', 'fixed'));
    return model;
}

test('a robot lists links, joints, movable joints, mass and size', () => {
    const rows = Object.fromEntries(modelInfoRows(arm(), 'arm.urdf', { x: 0.335, y: 0.2594, z: 1.1 }, t));
    assert.deepEqual(rows, { file: 'arm.urdf', format: 'URDF', links: '3', joints: '2', movableJoints: '1', totalMass: '6.5 kg', size: '0.335 × 0.259 × 1.1', unit: 'm' });
});

test('MJCF is named by its parser, not its .xml extension', () => {
    const model = arm();
    model.userData = { type: 'mjcf' };
    assert.equal(Object.fromEntries(modelInfoRows(model, 'scene.xml', null, t)).format, 'MJCF');
});

test('a mesh shows only file, format and size, having no unit', () => {
    const model = { isMesh: true, userData: {} };
    assert.deepEqual(modelInfoRows(model, 'part.stl', { x: 1, y: 2, z: 3 }, t).map(([label]) => label), ['file', 'format', 'size']);
});
