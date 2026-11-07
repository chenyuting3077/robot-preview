import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';

globalThis.DOMParser ??= DOMParser;
const { checkModel } = await import('../../src/utils/ModelChecks.js');

const INERTIAL = '<inertial><mass value="1"/><inertia ixx="0.1" iyy="0.1" izz="0.1" ixy="0" ixz="0" iyz="0"/></inertial>';
const BOX = '<visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual>';
const link = (name, body = `${BOX}${INERTIAL}`) => `<link name="${name}">${body}</link>`;
const joint = (name, parent, child, { type = 'fixed', extra = '' } = {}) =>
    `<joint name="${name}" type="${type}"><parent link="${parent}"/><child link="${child}"/>${extra}</joint>`;
const robot = (...parts) => `<robot name="r">${parts.join('')}</robot>`;
const LIMIT = '<axis xyz="0 0 1"/><limit lower="-1" upper="1" effort="10" velocity="1"/>';
const issues = (xml, options) => checkModel(xml, options).map(({ rule, kind, name, severity }) => ({ rule, kind, name, severity }));
const rules = (xml, options) => checkModel(xml, options).map(issue => issue.rule);

test('a well-formed robot has no issues', () => {
    assert.deepEqual(issues(robot(link('base'), link('arm'), joint('j', 'base', 'arm', { type: 'revolute', extra: LIMIT }))), []);
});

test('a joint naming a link that does not exist is an error', () => {
    assert.deepEqual(issues(robot(link('base'), joint('j', 'base', 'ghost'))), [
        { rule: 'unknown-link', kind: 'joint', name: 'j', severity: 'error' }
    ]);
});

test('a link with two parents is an error', () => {
    assert.deepEqual(issues(robot(link('a'), link('b'), link('c'), joint('j1', 'a', 'c'), joint('j2', 'b', 'c'), joint('j3', 'a', 'b'))), [
        { rule: 'multiple-parents', kind: 'link', name: 'c', severity: 'error' }
    ]);
});

test('joints forming a loop are an error', () => {
    // Reported on the joint that closes the loop, reading in document order.
    assert.deepEqual(issues(robot(link('a'), link('b'), joint('j1', 'a', 'b'), joint('j2', 'b', 'a'))), [
        { rule: 'kinematic-loop', kind: 'joint', name: 'j2', severity: 'error' }
    ]);
});

test('duplicate link or joint names are errors', () => {
    assert.deepEqual(issues(robot(link('a'), link('a'), link('b'), joint('j', 'a', 'b'))), [
        { rule: 'duplicate-name', kind: 'link', name: 'a', severity: 'error' }
    ]);
    assert.deepEqual(issues(robot(link('a'), link('b'), link('c'), joint('j', 'a', 'b'), joint('j', 'a', 'c'))), [
        { rule: 'duplicate-name', kind: 'joint', name: 'j', severity: 'error' }
    ]);
});

test('more than one root link is an error', () => {
    assert.deepEqual(issues(robot(link('a'), link('b'))), [
        { rule: 'multiple-roots', kind: 'link', name: 'b', severity: 'error' }
    ]);
});

test('revolute and prismatic joints need a limit; continuous and fixed do not', () => {
    assert.deepEqual(issues(robot(link('a'), link('b'), joint('j', 'a', 'b', { type: 'revolute', extra: '<axis xyz="0 0 1"/>' }))), [
        { rule: 'missing-limit', kind: 'joint', name: 'j', severity: 'error' }
    ]);
    assert.ok(rules(robot(link('a'), link('b'), joint('j', 'a', 'b', { type: 'prismatic', extra: '<axis xyz="1 0 0"/>' }))).includes('missing-limit'));
    assert.deepEqual(rules(robot(link('a'), link('b'), joint('j', 'a', 'b', { type: 'continuous', extra: '<axis xyz="0 0 1"/>' }))), []);
});

const arm = (body, extra = LIMIT, type = 'revolute') => robot(link('base'), link('arm', body), joint('j', 'base', 'arm', { type, extra }));

test('a link with geometry but no inertial is a warning, except the root', () => {
    assert.deepEqual(issues(arm(BOX)), [{ rule: 'missing-inertial', kind: 'link', name: 'arm', severity: 'warning' }]);
    assert.deepEqual(rules(robot(link('base', BOX), link('arm'), joint('j', 'base', 'arm'))), []);
    assert.deepEqual(rules(arm('')), [], 'a frame-only link needs no inertia');
});

test('a mass of zero or less is a warning', () => {
    assert.deepEqual(issues(arm(`${BOX}<inertial><mass value="0"/><inertia ixx="0.1" iyy="0.1" izz="0.1"/></inertial>`)), [
        { rule: 'nonpositive-mass', kind: 'link', name: 'arm', severity: 'warning' }
    ]);
});

test('an inertia that is not positive definite or breaks the triangle inequality is a warning', () => {
    const inertia = attrs => arm(`${BOX}<inertial><mass value="1"/><inertia ${attrs}/></inertial>`);
    assert.deepEqual(rules(inertia('ixx="0.1" iyy="0.1" izz="0.5" ixy="0" ixz="0" iyz="0"')), ['invalid-inertia'], 'izz > ixx + iyy');
    assert.deepEqual(rules(inertia('ixx="0" iyy="0.1" izz="0.1" ixy="0" ixz="0" iyz="0"')), ['invalid-inertia'], 'zero principal moment');
    assert.deepEqual(rules(inertia('ixx="0.1" iyy="0.1" izz="0.1" ixy="0.2" ixz="0" iyz="0"')), ['invalid-inertia'], 'not positive definite');
    assert.deepEqual(rules(inertia('ixx="0.1" iyy="0.2" izz="0.25" ixy="0.01" ixz="0" iyz="0"')), []);
});

test('a zero joint axis is a warning', () => {
    assert.deepEqual(issues(arm(undefined, '<axis xyz="0 0 0"/><limit lower="-1" upper="1" effort="1" velocity="1"/>')), [
        { rule: 'zero-axis', kind: 'joint', name: 'j', severity: 'warning' }
    ]);
});

test('limits: lower above upper, zero effort or velocity, and bounds on a continuous joint are warnings', () => {
    assert.deepEqual(rules(arm(undefined, '<axis xyz="0 0 1"/><limit lower="1" upper="-1" effort="1" velocity="1"/>')), ['inverted-limit']);
    assert.deepEqual(rules(arm(undefined, '<axis xyz="0 0 1"/><limit lower="-1" upper="1" effort="0" velocity="1"/>')), ['zero-effort-velocity']);
    assert.deepEqual(rules(arm(undefined, '<axis xyz="0 0 1"/><limit lower="-1" upper="1" effort="1" velocity="0"/>')), ['zero-effort-velocity']);
    assert.deepEqual(rules(arm(undefined, '<axis xyz="0 0 1"/><limit lower="-1" upper="1" effort="1" velocity="1"/>', 'continuous')), ['continuous-with-limits']);
    assert.deepEqual(rules(arm(undefined, '<axis xyz="0 0 1"/><limit effort="1" velocity="1"/>', 'continuous')), []);
});

test('visual and collision sizes a hundredfold apart are a warning, as from a unit mistake', () => {
    const xml = arm();
    assert.deepEqual(issues(xml, { sizes: { arm: { visual: 0.5, collision: 500 } } }), [
        { rule: 'collision-scale-mismatch', kind: 'link', name: 'arm', severity: 'warning' }
    ]);
    assert.deepEqual(rules(xml, { sizes: { arm: { visual: 0.5, collision: 0.9 } } }), [], 'a simplified collision shape');
    assert.deepEqual(rules(xml, { sizes: { arm: { visual: 0.5 } } }), [], 'no collision');
});

test('a real robot (UR5e from ur_description 4.4.1) passes every check', async () => {
    const fs = await import('node:fs');
    const urdf = fs.readFileSync(new URL('../fixtures/xacro/ur5e.urdf', import.meta.url), 'utf8');
    assert.deepEqual(issues(urdf), []);
});

test('a loop is reported even when a root exists, besides the link with two parents', () => {
    const xml = robot(link('root'), link('a'), link('b'), joint('j0', 'root', 'a'), joint('j1', 'a', 'b'), joint('j2', 'b', 'a'));
    assert.deepEqual(rules(xml).sort(), ['kinematic-loop', 'multiple-parents']);
});

test('a joint with an unknown parent does not also make its child a second root', () => {
    assert.deepEqual(rules(robot(link('base'), link('arm'), joint('j0', 'base', 'arm'), link('hand'), joint('j1', 'ghost', 'hand'))), ['unknown-link']);
});

test('only the first root is exempt from the inertia rule', () => {
    assert.deepEqual(issues(robot(link('base', BOX), link('stray', BOX))).map(issue => issue.rule).sort(), ['missing-inertial', 'multiple-roots']);
});

test('a limit without effort or velocity, and an inertial without mass, are errors ROS rejects', () => {
    assert.deepEqual(issues(arm(undefined, '<axis xyz="0 0 1"/><limit lower="-1" upper="1"/>')), [
        { rule: 'missing-limit', kind: 'joint', name: 'j', severity: 'error' }
    ]);
    assert.deepEqual(issues(arm(`${BOX}<inertial><inertia ixx="0.1" iyy="0.1" izz="0.1"/></inertial>`)), [
        { rule: 'missing-mass', kind: 'link', name: 'arm', severity: 'error' }
    ]);
});

test('a singular inertia with off-diagonal terms is caught despite rounding', () => {
    // 1 kg at (0.03, 0.04, 0): rank 2, yet the determinant rounds to +5e-25.
    const inertia = arm(`${BOX}<inertial><mass value="1"/><inertia ixx="0.0016" iyy="0.0009" izz="0.0025" ixy="-0.0012" ixz="0" iyz="0"/></inertial>`);
    assert.deepEqual(rules(inertia), ['invalid-inertia']);
});

test('the rules offered in robotPreviewUrdf.checks.disabled are exactly the implemented ones', async () => {
    const { RULES } = await import('../../src/utils/ModelChecks.js');
    const fs = await import('node:fs');
    const pkg = JSON.parse(fs.readFileSync(new URL('../../packages/urdf-mjcf/package.json', import.meta.url), 'utf8'));
    assert.deepEqual(pkg.contributes.configuration.properties['robotPreviewUrdf.checks.disabled'].items.enum, Object.keys(RULES));
});
