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
    doc.edit(doc.getText().replace('<!--here-->', text));
    const position = doc.positionAt(doc.getText().indexOf(text) + text.length);
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
    assert.equal(await hover('<joint name="j"/>', 2), undefined);
});

test('packageSearchPaths finds packages below the folders it names, as colcon does', async () => {
    const { ws, primary } = robotWorkspace('<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro">'
        + '<xacro:include filename="$(find deep_pkg)/urdf/a.xacro"/><xacro:include filename="$(find ignored_pkg)/urdf/b.xacro"/></robot>\n', 'robot.urdf.xacro');
    const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-other-ws-')));
    write(path.join(other, 'src/group/deep_pkg/package.xml'), '<package><name>deep_pkg</name></package>');
    write(path.join(other, 'src/group/deep_pkg/urdf/a.xacro'), '<robot/>');
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
