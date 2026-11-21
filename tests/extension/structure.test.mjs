// URDF vocabulary: structure checks, element completion and hover.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadExtension, sleep } from './vscode-mock.mjs';
import { robotWorkspace, write } from './path-fixture.mjs';

const require = createRequire(import.meta.url);
const schema = require('../../packages/urdf-mjcf/urdf-schema.js');

const found = text => schema.checkStructure(text).map(issue => [issue.rule, text.slice(issue.start, issue.end)]);

test('typos, misplaced elements, missing attributes and bad values are found where they are written', () => {
    const text = `<robot name="r">
  <link name="a">
    <origin xyz="0 0 0"/>
    <visual><orgin xyz="1 2 3"></orgin><geometry><box/></geometry></visual>
    <inertial><mass value="1"/><inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0"/></inertial>
  </link>
  <joint name="j" type="revolut"><parent link="a"/><child lnk="b"/><axis xyz="0 1"/></joint>
  <transmision/>
</robot>`;
    assert.deepEqual(found(text), [
        ['ignored-element', 'origin'],
        ['ignored-element', 'orgin'],
        ['missing-attribute', 'box'],
        ['missing-attribute', 'inertia'],
        ['invalid-value', 'revolut'],
        ['ignored-attribute', 'lnk'],
        ['missing-attribute', 'child'],
        ['invalid-value', '0 1'],
        ['ignored-element', 'transmision']
    ]);
    const byText = Object.fromEntries(schema.checkStructure(text).map(issue => [text.slice(issue.start, issue.end), issue]));
    assert.match(byText.origin.message, /not read inside <link>; ROS reads it in <inertial>, <visual>, <collision>, <joint>/);
    assert.match(byText.orgin.message, /Did you mean <origin>\?/);
    assert.equal(byText.orgin.replacement.closeStart, text.indexOf('</orgin>') + 2, 'the closing tag is renamed too');
    assert.equal(byText.revolut.replacement.text, 'revolute');
    assert.equal(byText.transmision.replacement.text, 'transmission');
});

test('the lower triangle of an inertia is explained, not taken for a typo', () => {
    const [issue] = schema.checkStructure('<robot><link name="a"><inertial><inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" iyx="0"/></inertial></link></robot>');
    assert.equal(issue.message, '<inertia> has no attribute "iyx"; the tensor is symmetric, so ROS reads ixy only');
    assert.equal(issue.replacement, undefined);
});

test('xacro, foreign elements and other roots are not reported', () => {
    const text = `<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro">
  <xacro:property name="pose"><origin xyz="0 0 0"/></xacro:property>
  <xacro:macro name="m" params="p *origin">
    <xacro:if value="\${p}"><link name="\${p}_link"/></xacro:if>
    <joint name="\${p}_ctrl"><command_interface name="position"/></joint>
    <anything/>
  </xacro:macro>
  <link name="a"><visual><origin xyz="\${x} 0 0" rpy="\${pi/2} 0 0"/><geometry><box size="1 1 1"/></geometry></visual></link>
  <joint type="fixed"><xacro:attribute name="name" value="j"/><parent link="a"/><child link="b"/></joint>
  <xacro:unless value="0"><joint name="k" type="fixed"><parent link="a"/><child link="b"/></joint></xacro:unless>
  <gazebo reference="a"><material>Gazebo/Red</material></gazebo>
  <ros2_control name="s" type="system"><joint name="k"><state_interface name="position"/></joint></ros2_control>
</robot>`;
    assert.deepEqual(found(text), []);
    assert.deepEqual(found('<mujoco><worldbody><body name="b"/></worldbody></mujoco>'), []);
    assert.deepEqual(found('<robot name="r"><group name="arm"><chain base_link="a" tip_link="b"/></group><disable_collisions link1="a" link2="b" reason="Adjacent"/></robot>'), []);
});

test('what a mistake costs follows urdfdom: a joint rejects the model, a link loses the rest, a colour goes unused', () => {
    const text = '<robot name="r"><link name="a"><visual><geometry><box/></geometry><material name="m"><color/></material></visual></link>'
        + '<joint name="j" type="continuous"><parent link="a"/><child link="b"/><dynamics/><axis xyz="0x1 0 0"/></joint></robot>';
    const issues = Object.fromEntries(schema.checkStructure(text).map(issue => [text.slice(issue.start, issue.end), issue]));
    assert.deepEqual([issues.box.severity, issues.box.message], ['error', '<box> needs "size"; ROS drops the rest of this link without it']);
    assert.deepEqual([issues.color.severity, issues.color.message], ['warning', '<color> needs "rgba"; ROS does not use this colour without it']);
    assert.deepEqual([issues.dynamics.severity, issues.dynamics.message], ['error', '<dynamics> needs "damping" or "friction"; ROS rejects the model']);
    assert.equal(issues['0x1 0 0'].message, 'xyz="0x1 0 0" must be 3 numbers separated by spaces; ROS rejects the model');
});

test('urdfdom reads the first element in <geometry> as the shape, and needs one', () => {
    const text = '<robot name="r"><link name="a">'
        + '<visual><geometry><boxx size="1 1 1"></boxx></geometry></visual>'
        + '<visual><geometry><box size="1 1 1"/><sphere radius="1"/></geometry></visual>'
        + '<collision><origin/></collision>'
        + '<collision><geometry/></collision>'
        + '<visual><geometry><xacro:if value="1"><box size="1 1 1"/></xacro:if><sphere radius="1"/></geometry></visual>'
        + '</link></robot>';
    assert.deepEqual(found(text), [
        ['invalid-geometry', 'boxx'],
        ['ignored-element', 'sphere'],
        ['missing-element', 'collision'],
        ['missing-element', 'geometry']
    ]);
    const [typo] = schema.checkStructure(text);
    assert.match(typo.message, /<boxx> is not a shape; ROS drops the rest of this link\. Did you mean <box>\?/);
    assert.equal(typo.replacement.closeStart, text.indexOf('</boxx>') + 2);
});

test('attributes and shapes from later URDF versions are read only when the robot declares that version', () => {
    const body = '<link name="a"><visual><origin quat_xyzw="0 0 0 1"/><geometry><capsule radius="1" length="1"/></geometry></visual></link>'
        + '<joint name="j" type="revolute"><parent link="a"/><child link="b"/><limit lower="0" upper="1" effort="1" velocity="1" jerk="1"/></joint>';
    assert.deepEqual(found(`<robot name="r">${body}</robot>`), [['ignored-attribute', 'quat_xyzw'], ['invalid-geometry', 'capsule'], ['ignored-attribute', 'jerk']]);
    assert.deepEqual(found(`<robot name="r" version="1.1">${body}</robot>`), [['ignored-attribute', 'jerk']]);
    assert.deepEqual(found(`<robot name="r" version="1.2">${body}</robot>`), []);
    assert.deepEqual(schema.checkStructure(`<robot>${body}</robot>`, { xacro: true }), [], 'an included xacro file has no name and an unknown version');
    assert.ok(found(`<robot>${body}</robot>`).some(([rule, at]) => rule === 'missing-attribute' && at === 'robot'), 'a URDF file needs a robot name');
    assert.deepEqual(found('<robot name="r" version="2.0"/>'), [['invalid-value', '2.0']]);
    assert.deepEqual(found('<robot name="r" version="1.1"><link name="a"><visual><origin rpy="0 0 0" quat_xyzw="0 0 0 1"/><geometry><box size="1 1 1"/></geometry></visual></link></robot>'),
        [['invalid-value', 'quat_xyzw']]);
});

test('only the first of an element is read, fixed joints have no axis, and required children are found', () => {
    const text = '<robot name="r"><link name="a"><inertial><mass value="1"/></inertial><visual><origin xyz="0 0 0"/><origin xyz="bad"/><geometry><box size="1 1 1"/></geometry></visual></link>'
        + '<joint name="f" type="fixed"><parent link="a"/><child link="b"/><axis xyz="1 0"/></joint><joint name="g" type="fixed"><parent link="a"/></joint></robot>';
    assert.deepEqual(found(text), [['missing-element', 'inertial'], ['ignored-element', 'origin'], ['missing-element', 'joint']]);
    assert.match(schema.checkStructure(text)[0].message, /<inertial> has no <inertia>; ROS drops the rest of this link/);
    assert.match(schema.checkStructure(text)[2].message, /<joint> has no <child>; ROS rejects the model/);
    assert.deepEqual(found('<robot name="r"><link name="a"><inertial><mass/><inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1"/></inertial></link></robot>'), [['missing-attribute', 'mass']]);
});

test('numbers are read as urdfdom reads them: single spaces, colours from 0 to 1, URDF 1.2 limits', () => {
    const link = rgba => `<robot name="r"><link name="a"><visual><geometry><box size="1\t1 1"/></geometry><material name="m"><color rgba="${rgba}"/></material></visual></link></robot>`;
    assert.deepEqual(found(link('2 0 0 1')), [['invalid-value', '1\t1 1'], ['invalid-value', '2 0 0 1']]);
    assert.deepEqual(found(link('1  0 0 1')).map(([rule]) => rule), ['invalid-value'], 'two spaces are one separator');
    const joint = version => `<robot name="r" version="${version}"><link name="a"/><link name="b"/><joint name="j" type="revolute"><parent link="a"/><child link="b"/><limit upper="1" effort="-1" velocity="1"/></joint></robot>`;
    assert.deepEqual(found(joint('1.0')), []);
    assert.deepEqual(found(joint('1.2')), [['invalid-value', '-1'], ['missing-attribute', 'limit']]);
});

test('URDF 1.2 needs sizes above zero, a material name is defined once, and a short rgba shows black', () => {
    const body = '<material name="m"><color rgba="1 0 0 1"/></material><material name="m"><color rgba="0 1 0 1"/></material>'
        + '<link name="a"><visual><geometry><box size="0 1 1"/></geometry><material name="x"><color rgba="1 0 0"/></material></visual></link>';
    const issues = version => schema.checkStructure(`<robot name="r" version="${version}">${body}</robot>`).map(issue => [issue.severity, issue.message]);
    assert.deepEqual(issues('1.2'), [
        ['error', 'material "m" is defined twice under <robot>; ROS rejects the model'],
        ['error', 'size="0 1 1" must be above zero from URDF 1.2; ROS drops the rest of this link'],
        ['warning', 'rgba="1 0 0" must be 4 numbers separated by spaces; ROS shows it black']
    ]);
    assert.equal(issues('1.0').length, 2, 'a zero size is read before 1.2');
});

test('a material in a macro body may land under <robot>, so its problems are warnings, and a name repeated across xacro branches is fine', () => {
    const [issue] = schema.checkStructure('<robot name="r" xmlns:xacro="x"><xacro:macro name="m"><material><color rgba="1 0 0 1"/></material></xacro:macro></robot>');
    assert.equal(issue.severity, 'warning');
    const [inVisual] = schema.checkStructure('<robot name="r" xmlns:xacro="x"><xacro:macro name="m"><visual><geometry><box size="1 1 1"/></geometry><material/></visual></xacro:macro></robot>');
    assert.deepEqual([inVisual.severity, inVisual.message], ['error', '<material> needs "name"; ROS drops the rest of this link without it']);
    const red = '<material name="c"><color rgba="1 0 0 1"/></material>';
    assert.deepEqual(found(`<robot name="r" xmlns:xacro="x"><xacro:if value="\${a}">${red}</xacro:if><xacro:unless value="\${a}">${red}</xacro:unless>`
        + `${red}<xacro:macro name="m">${red}</xacro:macro></robot>`), []);
});

test('completion knows the root, stays out of comments, and offers no second shape or origin', () => {
    const at = text => schema.tagAt(text, text.length);
    assert.deepEqual(at('<robot ').element, 'robot');
    assert.equal(at('<robot name="r"'), null, 'right after a closing quote an attribute would need a space first');
    assert.deepEqual(schema.elementsAt(at('<').parent, at('<').siblings).map(element => element.name), ['robot']);
    assert.equal(at('<robot name="r"><link name="a"><!-- <vis'), null);
    const names = text => schema.elementsAt(at(text).parent, at(text).siblings).map(element => element.name);
    assert.deepEqual(names('<robot name="r"><link name="a"><visual><geometry><box size="1 1 1"/><'), []);
    assert.deepEqual(names('<robot name="r"><link name="a"><visual><origin/><'), ['geometry', 'material']);
    assert.deepEqual(names('<robot name="r"><link name="a"><visual/><'), ['inertial', 'visual', 'collision']);
});

test('names inherited by every object, such as toString, are not URDF', () => {
    assert.deepEqual(found('<robot name="r"><joint name="j" type="toString"><parent link="a"/><child link="b"/></joint><link name="a"><visual><geometry><box size="1 1 1" constructor="x"/></geometry></visual></link></robot>'),
        [['invalid-value', 'toString'], ['ignored-attribute', 'constructor']]);
    assert.deepEqual(found('<robot name="r" xmlns:xacro="x"><xacro:macro name="m"><constructor a="1"/></xacro:macro></robot>'), []);
    assert.equal(schema.valueDoc('joint', 'type', 'toString'), null);
    assert.deepEqual(schema.valuesOf('joint', 'constructor'), []);
});

test('hover tells what each attribute takes', () => {
    assert.match(schema.elementDoc('origin', 'joint'), /\| `xyz` \| 3 numbers \| default `0 0 0` \|/);
    assert.match(schema.attributeDoc('limit', 'jerk'), /\(number, optional, from URDF 1\.2\)/);
});

test('a new element starts with its required attributes as tab stops', () => {
    assert.equal(schema.elementSnippet('box'), 'box size="$1"/>');
    assert.equal(schema.elementSnippet('origin'), 'origin xyz="${1:0 0 0}" rpy="${2:0 0 0}"/>');
    assert.match(schema.elementSnippet('joint'), /^joint name="\$1" type="\$\{2\|revolute,continuous,prismatic,fixed,floating,planar\|\}">\n\t<parent link="\$3"\/>/);
});

function setup(urdf) {
    const { ws, primary } = robotWorkspace(urdf);
    const env = loadExtension({ workspace: ws, config: { autoOpen: false } });
    return { env, ws, primary };
}

const structureDiagnostics = env => env.state.collections['robot-preview-structure'];

test('open documents are checked without the preview, and the typo fix renames both tags', async () => {
    const { env, primary } = setup('<robot name="r"><link name="a"><visual><orgin xyz="0 0 0"></orgin></visual></link></robot>\n');
    const doc = env.open(primary);
    env.activate();
    assert.equal(env.state.panels.length, 0);
    const [diagnostic] = structureDiagnostics(env).get(primary);
    assert.equal(diagnostic.code, 'ignored-element');
    const [action] = env.state.codeActions.provideCodeActions(doc, diagnostic.range, { diagnostics: [diagnostic] });
    assert.equal(action.title, 'Change to "origin"');
    await env.vscode.workspace.applyEdit(action.edit);
    assert.equal(doc.getText(), '<robot name="r"><link name="a"><visual><origin xyz="0 0 0"></origin></visual></link></robot>\n');
});

test('edits are rechecked after typing stops, and checks.disabled turns a rule off', async () => {
    const { env, primary } = setup('<robot name="r"><link name="a"/></robot>\n');
    const doc = env.open(primary);
    env.activate();
    assert.deepEqual(structureDiagnostics(env).get(primary), []);
    doc.edit('<robot name="r"><link/></robot>\n');
    env.fire('change', { document: doc, contentChanges: [{}] });
    await sleep(400);
    assert.deepEqual(structureDiagnostics(env).get(primary).map(d => d.code), ['missing-attribute']);
    env.state.config['checks.disabled'] = ['missing-attribute'];
    env.fire('config', { affectsConfiguration: key => key === 'robotPreviewUrdf.checks.disabled' });
    assert.deepEqual(structureDiagnostics(env).get(primary), []);
});

async function completeAt(env, doc, text) {
    const at = doc.getText().indexOf('<!--here-->');
    doc.edit(doc.getText().replace('<!--here-->', text));
    const position = doc.positionAt(at + text.length);
    return (await env.state.completions.provideCompletionItems(doc, position)) || [];
}

test('completion offers the elements read here, missing attributes, joint types and link names', async () => {
    const urdf = '<robot name="r"><link name="base"/><link name="arm"/><!--here--></robot>\n';
    const labels = async text => {
        const { env, primary } = setup(urdf);
        env.activate();
        const doc = await env.vscode.workspace.openTextDocument(primary);
        return (await completeAt(env, doc, text)).map(item => item.label);
    };
    assert.deepEqual(await labels('<joint name="j" type="fixed"><'),
        ['origin', 'parent', 'child', 'axis', 'calibration', 'dynamics', 'limit', 'mimic', 'safety_controller']);
    assert.deepEqual(await labels('<joint name="j" '), ['type']);
    assert.deepEqual(await labels('<joint name="j" type="'), ['revolute', 'continuous', 'prismatic', 'fixed', 'floating', 'planar']);
    assert.deepEqual((await labels('<joint name="j" type="fixed"><parent link="')).sort(), ['arm', 'base']);
    assert.deepEqual(await labels('<link name="x"><visual><geometry><'), ['box', 'cylinder', 'sphere', 'mesh', 'capsule']);
    assert.deepEqual(await labels('<'), ['link', 'joint', 'material', 'gazebo', 'ros2_control', 'transmission']);
});

test('hover explains elements, attributes and joint types, but not ros2_control joints', async () => {
    const urdf = '<robot name="r"><joint name="j" type="prismatic"><origin xyz="0 0 1"/></joint>'
        + '<ros2_control name="s" type="system"><joint name="j"/></ros2_control></robot>\n';
    const { env, primary } = setup(urdf);
    env.activate();
    const doc = await env.vscode.workspace.openTextDocument(primary);
    const hover = async (needle, offset = 1) => (await env.state.hovers.provideHover(doc, doc.positionAt(urdf.indexOf(needle) + offset)))?.contents.value;
    assert.match(await hover('origin'), /Pose of the child link frame in the parent link frame/);
    assert.match(await hover('xyz'), /Translation in metres/);
    assert.match(await hover('prismatic'), /Slides along the axis/);
    assert.match(await hover('robot'), /Root of a URDF/);
    assert.equal(await hover('<joint name="j"/>', 2), undefined);
});

test('packageSearchPaths finds packages below the folders it names, as colcon does, even in a marked install/', async () => {
    const { ws, primary } = robotWorkspace('<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro">'
        + '<xacro:include filename="$(find deep_pkg)/urdf/a.xacro"/><xacro:include filename="$(find ignored_pkg)/urdf/b.xacro"/></robot>\n', 'robot.urdf.xacro');
    const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-other-ws-')));
    write(path.join(other, 'src/group/deep_pkg/package.xml'), '<package><name>deep_pkg</name></package>');
    write(path.join(other, 'src/group/deep_pkg/urdf/a.xacro'), '<robot/>');
    write(path.join(other, 'COLCON_IGNORE'), '');
    write(path.join(other, 'src/skip/COLCON_IGNORE'), '');
    write(path.join(other, 'src/skip/ignored_pkg/package.xml'), '<package><name>ignored_pkg</name></package>');
    write(path.join(other, 'src/skip/ignored_pkg/urdf/b.xacro'), '<robot/>');
    const env = loadExtension({ workspace: ws, config: { autoOpen: false, packageSearchPaths: [other] } });
    env.activate();
    const doc = await env.vscode.workspace.openTextDocument(primary);
    const target = async needle => (await env.state.definitions.provideDefinition(doc, doc.positionAt(doc.getText().indexOf(needle) + 8)))?.[0]?.uri.fsPath;
    assert.equal(await target('$(find deep_pkg)'), path.join(other, 'src/group/deep_pkg/urdf/a.xacro'));
    assert.equal(await target('$(find ignored_pkg)'), undefined);
});
