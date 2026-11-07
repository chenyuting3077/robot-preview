import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadExtension } from './vscode-mock.mjs';
import { write } from './path-fixture.mjs';

const MAIN = `<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro">
  <xacro:include filename="$(find pkg)/urdf/parts.xacro"/>
  <xacro:arg name="side" default="left"/>
  <xacro:property name="arm_length" value="0.4"/>
  <link name="base">
    <visual><geometry><mesh filename="package://pkg/meshes/base.stl"/></geometry></visual>
  </link>
  <xacro:arm prefix="$(arg side)" length="\${arm_length}"/>
  <joint name="j" type="fixed"><parent link="base"/><child link="tool"/></joint>
</robot>
`;
const PARTS = `<robot xmlns:xacro="http://www.ros.org/wiki/xacro">
  <xacro:property name="arm_length" value="9"/>
  <xacro:property name="radius" value="0.05"/>
  <xacro:macro name="arm" params="prefix length:=0.3">
    <link name="\${prefix}_arm"/>
    <joint name="\${prefix}_joint" type="fixed"><parent link="\${base_name}"/><child link="\${prefix}_arm"/></joint>
    <link name="\${prefix}_$(arg side)_marker"/>
  </xacro:macro>
  <link name="tool"/>
</robot>
`;
const SIBLING = '<robot xmlns:xacro="http://www.ros.org/wiki/xacro"><xacro:property name="arm_length" value="1"/></robot>\n';

function setup() {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-nav-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    write(path.join(ws, 'src/pkg/meshes/base.stl'));
    const main = path.join(ws, 'src/pkg/urdf/robot.urdf.xacro');
    const parts = path.join(ws, 'src/pkg/urdf/parts.xacro');
    write(main, MAIN.replace('<xacro:property name="arm_length" value="0.4"/>', '<xacro:property name="arm_length" value="0.4"/>\n  <xacro:property name="base_name" value="base"/>'));
    write(parts, PARTS);
    // Neither included nor including: must not offer definitions.
    write(path.join(ws, 'src/pkg/urdf/sibling.xacro'), SIBLING);
    write(path.join(ws, 'src/pkg/launch/view.launch.xml'), SIBLING);
    const env = loadExtension({ workspace: ws, config: { autoOpen: false } });
    env.activate();
    return { env, ws, main, parts };
}

async function at(env, fsPath, needle, offset = 0) {
    const doc = await env.vscode.workspace.openTextDocument(fsPath);
    return { doc, position: doc.positionAt(doc.getText().indexOf(needle) + offset) };
}

const lineOf = (fsPath, needle) => fs.readFileSync(fsPath, 'utf8').split('\n').findIndex(line => line.includes(needle));
const definitions = async (env, fsPath, needle, offset) => {
    const { doc, position } = await at(env, fsPath, needle, offset);
    return (await env.state.definitions.provideDefinition(doc, position)) || [];
};

test('a property jumps to its definitions, same file first, without the preview', async () => {
    const { env, main, parts } = setup();
    assert.equal(env.state.panels.length, 0);
    const found = await definitions(env, main, '${arm_length}', 3);
    assert.deepEqual(found.map(location => [location.uri.fsPath, location.range.start.line]), [
        [main, lineOf(main, 'name="arm_length"')],
        [parts, lineOf(parts, 'name="arm_length"')]
    ]);
});

test('a macro call, an argument and a link name jump to their definitions', async () => {
    const { env, main, parts } = setup();
    const [macro] = await definitions(env, main, '<xacro:arm ', 8);
    assert.deepEqual([macro.uri.fsPath, macro.range.start.line], [parts, lineOf(parts, '<xacro:macro name="arm"')]);
    const [arg] = await definitions(env, main, '$(arg side)', 7);
    assert.deepEqual([arg.uri.fsPath, arg.range.start.line], [main, lineOf(main, '<xacro:arg name="side"')]);
    const [link] = await definitions(env, main, '<child link="tool"/>', 14);
    assert.deepEqual([link.uri.fsPath, link.range.start.line], [parts, lineOf(parts, '<link name="tool"/>')]);
});

test('a path jumps to the file it names', async () => {
    const { env, ws, main } = setup();
    const [mesh] = await definitions(env, main, 'package://pkg/meshes/base.stl', 12);
    assert.equal(mesh.uri.fsPath, path.join(ws, 'src/pkg/meshes/base.stl'));
    const [include] = await definitions(env, main, '$(find pkg)/urdf/parts.xacro', 15);
    assert.equal(include.uri.fsPath, path.join(ws, 'src/pkg/urdf/parts.xacro'));
});

test('hover shows the definition as written, and an argument its current value', async () => {
    const { env, main } = setup();
    env.state.workspaceState.set('xacroArgs', { [main]: 'side:=right' });
    const hover = async (needle, offset) => {
        const { doc, position } = await at(env, main, needle, offset);
        return (await env.state.hovers.provideHover(doc, position))?.contents.value || '';
    };
    const property = await hover('${arm_length}', 3);
    assert.match(property, /<xacro:property name="arm_length" value="0.4"\/>/);
    assert.match(property, /robot\.urdf\.xacro:4/);
    const macro = await hover('<xacro:arm ', 8);
    assert.match(macro, /params="prefix length:=0.3"/);
    const arg = await hover('$(arg side)', 7);
    assert.match(arg, /default="left"/);
    assert.match(arg, /right/);
});

test('completion offers properties after ${, macros after <xacro: and arguments after $(arg', async () => {
    const { env, main } = setup();
    const doc = await env.vscode.workspace.openTextDocument(main);
    const complete = async text => {
        doc.edit(doc.getText().replace('</robot>', `${text}\n</robot>`));
        const position = doc.positionAt(doc.getText().indexOf(text) + text.length);
        return ((await env.state.completions.provideCompletionItems(doc, position)) || []).map(item => item.label).sort();
    };
    assert.deepEqual(await complete('<link name="${'), ['arm_length', 'base_name', 'radius']);
    assert.deepEqual(await complete('<xacro:'), ['arm']);
    assert.deepEqual(await complete('<link name="$(arg '), ['side']);
});

test('paths are links to their files', async () => {
    const { env, ws, main } = setup();
    const doc = await env.vscode.workspace.openTextDocument(main);
    const links = await env.state.links.provideDocumentLinks(doc);
    assert.deepEqual(links.map(link => link.target.fsPath).sort(), [
        path.join(ws, 'src/pkg/meshes/base.stl'),
        path.join(ws, 'src/pkg/urdf/parts.xacro')
    ]);
});

test('a macro used in ur.urdf.xacro jumps into ur_macro.xacro', async () => {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-nav-ur-')));
    fs.cpSync(new URL('../fixtures/xacro/ur_description', import.meta.url).pathname, path.join(ws, 'ur_description'), { recursive: true });
    const env = loadExtension({ workspace: ws, config: { autoOpen: false } });
    env.activate();
    const main = path.join(ws, 'ur_description/urdf/ur.urdf.xacro');
    const [macro] = await definitions(env, main, '<xacro:ur_robot', 8);
    const macroFile = path.join(ws, 'ur_description/urdf/ur_macro.xacro');
    assert.deepEqual([macro.uri.fsPath, macro.range.start.line], [macroFile, lineOf(macroFile, '<xacro:macro name="ur_robot"')]);
});

test('a property inside a path is the property, not the path', async () => {
    const { env, main } = setup();
    const doc = await env.vscode.workspace.openTextDocument(main);
    doc.edit(doc.getText().replace('</robot>', '  <link name="x"><visual><geometry><mesh filename="package://pkg/${radius}.stl"/></geometry></visual></link>\n</robot>'));
    const position = doc.positionAt(doc.getText().indexOf('${radius}') + 3);
    const [found] = await env.state.definitions.provideDefinition(doc, position);
    assert.match(found.uri.fsPath, /parts\.xacro$/);
});

test('a property inside a link reference is the property; the reference itself finds a same-written link', async () => {
    const { env, main, parts } = setup();
    const [property] = await definitions(env, parts, '<parent link="${base_name}"/>', 17);
    assert.deepEqual([property.uri.fsPath, property.range.start.line], [main, lineOf(main, 'name="base_name"')]);
    const [link] = await definitions(env, parts, '<child link="${prefix}_arm"/>', 23);
    assert.deepEqual([link.uri.fsPath, link.range.start.line], [parts, lineOf(parts, '<link name="${prefix}_arm"/>')]);
});

test('hover on a path shows its absolute path, on a link where it is defined', async () => {
    const { env, ws, main } = setup();
    const hover = async (needle, offset) => {
        const { doc, position } = await at(env, main, needle, offset);
        return (await env.state.hovers.provideHover(doc, position))?.contents.value || '';
    };
    assert.match(await hover('package://pkg/meshes/base.stl', 12), new RegExp(path.join(ws, 'src/pkg/meshes/base.stl').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
    assert.match(await hover('<child link="tool"/>', 14), /parts\.xacro:\d+/);
});

test('an argument hovered in an included file shows the value set on the file that includes it', async () => {
    const { env, main, parts } = setup();
    env.state.workspaceState.set('xacroArgs', { [main]: 'side:=right' });
    const { doc, position } = await at(env, parts, '$(arg side)', 7);
    assert.match((await env.state.hovers.provideHover(doc, position)).contents.value, /right/);
});

test('an include typed but not yet saved is searched at once', async () => {
    const { env, ws, main } = setup();
    await definitions(env, main, '${arm_length}', 3);
    write(path.join(ws, 'src/pkg/urdf/late.xacro'), '<robot xmlns:xacro="http://www.ros.org/wiki/xacro"><xacro:property name="late_value" value="1"/></robot>\n');
    const doc = await env.vscode.workspace.openTextDocument(main);
    doc.edit(doc.getText().replace('</robot>', '  <xacro:include filename="late.xacro"/>\n  <link name="${late_value}"/>\n</robot>'));
    const [found] = await env.state.definitions.provideDefinition(doc, doc.positionAt(doc.getText().indexOf('${late_value}') + 3));
    assert.match(found.uri.fsPath, /late\.xacro$/);
});

test('a namespaced macro call finds the macro', async () => {
    const { env, main, parts } = setup();
    const doc = await env.vscode.workspace.openTextDocument(main);
    doc.edit(doc.getText().replace('</robot>', '  <xacro:parts.arm prefix="x"/>\n</robot>'));
    const [found] = await env.state.definitions.provideDefinition(doc, doc.positionAt(doc.getText().indexOf('parts.arm') + 7));
    assert.deepEqual([found.uri.fsPath, found.range.start.line], [parts, lineOf(parts, '<xacro:macro name="arm"')]);
});

test('completion inside an expression offers properties', async () => {
    const { env, main } = setup();
    const doc = await env.vscode.workspace.openTextDocument(main);
    doc.edit(doc.getText().replace('</robot>', '  <link name="${arm_length * \n</robot>'));
    const items = await env.state.completions.provideCompletionItems(doc, doc.positionAt(doc.getText().indexOf('${arm_length * ') + 15));
    assert.ok(items.some(item => item.label === 'radius'));
});

test('a path built from an argument resolves with its default', async () => {
    const { env, ws, main } = setup();
    const doc = await env.vscode.workspace.openTextDocument(main);
    doc.edit(doc.getText().replace('<xacro:arg name="side" default="left"/>', '<xacro:arg name="side" default="left"/>\n  <xacro:arg name="mesh" default="base"/>')
        .replace('</robot>', '  <link name="m"><visual><geometry><mesh filename="package://pkg/meshes/$(arg mesh).stl"/></geometry></visual></link>\n</robot>'));
    const [found] = await env.state.definitions.provideDefinition(doc, doc.positionAt(doc.getText().indexOf('package://pkg/meshes/$(arg') + 12));
    assert.equal(found.uri.fsPath, path.join(ws, 'src/pkg/meshes/base.stl'));
});
