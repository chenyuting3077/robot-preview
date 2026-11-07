import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { copyFixture, loadExtension, sleep } from './vscode-mock.mjs';

const PRIMARY = 'src/robot_a/urdf/robot_a.urdf.xacro';
const ARM = 'src/robot_b/urdf/arm.xacro';

async function waitFor(predicate, ms = 5000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
        const value = predicate();
        if (value) return value;
        await sleep(20);
    }
    throw new Error('timed out');
}

async function start(config) {
    const workspace = await copyFixture();
    const env = loadExtension({ workspace, config });
    const primary = path.join(workspace, PRIMARY);
    const doc = env.open(primary);
    env.activate();
    const panel = await waitFor(() => env.state.panels[0]?.webview.html && env.state.panels[0]);
    panel.receive({ type: 'ready' });
    const load = await waitFor(() => env.lastOf('load'));
    return { ...env, workspace, primary, doc, panel, load };
}

const lineOf = (file, needle) => fs.readFileSync(file, 'utf8').split('\n').findIndex(line => line.includes(needle));
const textOf = file => Buffer.from(file.data).toString();

test('opens beside the editor and sends every referenced package', async () => {
    const { load, panel, primary } = await start();
    const paths = load.files.map(file => file.path);
    for (const expected of ['/robot_a/urdf/robot_a.urdf.xacro', '/robot_b/urdf/arm.xacro', '/robot_b/meshes/arm.stl', '/robot_b/meshes/tip.gltf', '/robot_b/meshes/tip.bin']) {
        assert.ok(paths.includes(expected), expected);
    }
    assert.equal(load.primary, '/robot_a/urdf/robot_a.urdf.xacro');
    assert.equal(load.sourcePath, primary);
    assert.match(panel.webview.html, /Content-Security-Policy/);
    assert.match(panel.webview.html, /<html lang="zh-tw">/);
    assert.ok(load.files.every(file => file.data instanceof Uint8Array && file.data.constructor === Uint8Array));
});

test('the cursor position at open is highlighted once the preview loads', async () => {
    const workspace = await copyFixture();
    const env = loadExtension({ workspace });
    const primary = path.join(workspace, PRIMARY);
    const doc = env.open(primary);
    env.vscode.window.activeTextEditor.selections = [{ active: doc.positionAt(doc.getText().indexOf('<link name="lift_link">') + 5) }];
    env.activate();
    const panel = await waitFor(() => env.state.panels[0]?.webview.html && env.state.panels[0]);
    panel.receive({ type: 'ready' });
    const highlight = await waitFor(() => env.lastOf('highlight'));
    assert.equal(highlight.pattern, 'lift_link');
});

test('typing resends only the edited file and merges rapid edits', async () => {
    const env = await start();
    env.doc.edit(env.doc.getText().replace('0.2 0.2 0.05', '0.3 0.2 0.05'));
    env.fire('change', { document: env.doc, contentChanges: [{}] });
    env.fire('change', { document: env.doc, contentChanges: [{}] });
    await sleep(600);
    const updates = env.allOf('update');
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].files.map(file => file.path), ['/robot_a/urdf/robot_a.urdf.xacro']);
    assert.match(textOf(updates[0].files[0]), /0\.3 0\.2 0\.05/);
});

test('save mode ignores typing and never leaks unsaved text', async () => {
    const env = await start({ updateOn: 'save' });
    env.doc.edit(env.doc.getText().replace('lift_link', 'lift_link2'));
    env.fire('change', { document: env.doc, contentChanges: [{}] });
    env.fire('config', { affectsConfiguration: key => key === 'robotPreviewUrdf.updateOn' });
    await sleep(600);
    const leaked = env.allOf('update').flatMap(message => message.files).some(file => textOf(file).includes('lift_link2'));
    assert.equal(leaked, false);

    env.doc.save();
    env.fire('save', env.doc);
    await sleep(600);
    const saved = env.lastOf('update');
    assert.ok(saved && textOf(saved.files[0]).includes('lift_link2'));
});

test('reveal jumps to literal and xacro-macro definitions', async () => {
    const env = await start();
    const arm = path.join(env.workspace, ARM);

    env.panel.receive({ type: 'reveal', kind: 'link', name: 'lift_link' });
    await waitFor(() => env.state.revealed);
    assert.deepEqual(env.state.revealed, { fsPath: env.primary, line: lineOf(env.primary, '<link name="lift_link">'), viewColumn: 1, focus: true });

    env.state.revealed = null;
    env.panel.receive({ type: 'reveal', kind: 'link', name: 'left_arm' });
    await waitFor(() => env.state.revealed);
    assert.equal(env.state.revealed.fsPath, arm);
    assert.equal(env.state.revealed.line, lineOf(arm, '<link name="${arm_link_name}">'));

    env.state.revealed = null;
    env.panel.receive({ type: 'reveal', kind: 'joint', name: 'left_arm_joint' });
    await waitFor(() => env.state.revealed);
    assert.equal(env.state.revealed.line, lineOf(arm, '<joint name="${arm_link_name}_joint"'));
});

test('cursor inside an element highlights it, expanding xacro properties', async () => {
    const env = await start();
    const select = (doc, needle) => {
        const offset = doc.getText().indexOf(needle) + needle.length + 2;
        env.fire('selection', { textEditor: { document: doc }, selections: [{ active: doc.positionAt(offset) }] });
    };
    select(env.doc, '<link name="lift_link">');
    await sleep(200);
    assert.deepEqual(env.lastOf('highlight'), { type: 'highlight', kind: 'link', pattern: 'lift_link' });

    const armDoc = await env.vscode.workspace.openTextDocument(path.join(env.workspace, ARM));
    select(armDoc, '<link name="${arm_link_name}">');
    await sleep(200);
    assert.deepEqual(env.lastOf('highlight'), { type: 'highlight', kind: 'link', pattern: '.*?_arm' });
});

test('joint limits are written back to literal URDF joints only', async () => {
    const env = await start();
    env.panel.receive({ type: 'editLimits', joint: 'lift_joint', limits: { upper: 0.3 } });
    await waitFor(() => env.state.applied.length === 1);
    assert.match(env.state.applied[0], /<limit lower="0" upper="0\.3" effort="10" velocity="1"\/>/);

    env.panel.receive({ type: 'editLimits', joint: 'mount_joint', limits: { lower: -0.5, upper: 1.5707963267948966 } });
    await waitFor(() => env.state.applied.length === 2);
    assert.match(env.state.applied[1], /<limit lower="-0\.5" upper="1\.570796"\/>\s*<\/joint>$/);

    env.panel.receive({ type: 'editLimits', joint: 'left_arm_joint', limits: { upper: 2 } });
    await waitFor(() => env.state.status.some(message => message.includes('cannot write limits')));
    assert.equal(env.state.applied.length, 2);
});

test('diagnostics map syntax errors, load errors and missing meshes to source lines', async () => {
    const env = await start();
    const arm = path.join(env.workspace, ARM);
    const primaryKey = '/robot_a/urdf/robot_a.urdf.xacro';

    env.panel.receive({ type: 'diagnostics', syntax: { [primaryKey]: [{ line: 3, column: 2, message: 'bad tag' }] }, loadError: 'xacro failed', missingMeshes: [] });
    await sleep(50);
    assert.deepEqual(env.state.diagnostics.get(env.primary).map(d => [d.message, d.range.start.line, d.severity]), [['bad tag', 3, 0]]);

    env.panel.receive({ type: 'diagnostics', syntax: { [primaryKey]: [] }, loadError: 'missing link foo', missingMeshes: ['robot_b/meshes/arm.stl'] });
    await sleep(100);
    assert.deepEqual(env.state.diagnostics.get(env.primary).map(d => d.message), ['missing link foo']);
    const mesh = env.state.diagnostics.get(arm);
    assert.equal(mesh[0].severity, 1);
    assert.equal(mesh[0].range.start.line, lineOf(arm, 'package://robot_b/meshes/arm.stl'));

    env.panel.receive({ type: 'diagnostics', syntax: {}, loadError: null, missingMeshes: [] });
    await sleep(50);
    assert.equal(env.state.diagnostics.size, 0);
});

test('settings, xacro arguments and the open preview survive a reload', async () => {
    const env = await start();
    env.panel.receive({ type: 'settings', settings: { 'show-collision': true, unit: 'deg' } });
    await sleep(20);

    env.state.inputBoxValue = 'side:=right';
    await env.state.commands['robotPreviewUrdf.setXacroArgs'](env.vscode.Uri.file(env.primary));
    assert.deepEqual(env.lastOf('load').xacroArgs, { side: 'right' });

    env.panel.dispose();
    const restored = env.vscode.window.createWebviewPanel();
    await env.state.serializer.deserializeWebviewPanel(restored, { sourcePath: env.primary });
    await waitFor(() => restored.webview.html);
    const before = env.allOf('load').length;
    restored.receive({ type: 'ready' });
    await waitFor(() => env.allOf('load').length > before);
    const load = env.lastOf('load');
    assert.equal(load.primary, '/robot_a/urdf/robot_a.urdf.xacro');
    assert.deepEqual(load.settings, { 'show-collision': true, unit: 'deg' });
    assert.deepEqual(load.xacroArgs, { side: 'right' });
});

test('export writes the expanded URDF with $(find) paths mapped back to the package directories', async () => {
    const env = await start();
    const exporting = env.state.commands['robotPreviewUrdf.exportUrdf']();
    const request = await waitFor(() => env.lastOf('exportUrdf'));
    env.panel.receive({ type: 'urdf', requestId: request.requestId, text: '<robot name="robot_a"><mesh filename="/robot_b/meshes/arm.stl"/><mesh filename="package://robot_b/meshes/arm.stl"/></robot>' });
    await exporting;
    const target = env.primary.replace(/\.urdf\.xacro$/, '.urdf');
    const robotB = path.join(env.workspace, 'src/robot_b');
    assert.equal(fs.readFileSync(target, 'utf8'), `<robot name="robot_a"><mesh filename="${robotB}/meshes/arm.stl"/><mesh filename="package://robot_b/meshes/arm.stl"/></robot>`);
});

test('export does not hang when the preview closes before the webview answers', async () => {
    const env = await start();
    const exporting = env.state.commands['robotPreviewUrdf.exportUrdf']();
    await waitFor(() => env.lastOf('exportUrdf'));
    env.panel.dispose();
    await Promise.race([exporting, sleep(1000).then(() => { throw new Error('export still pending'); })]);
});

test('an older diagnostics report never overwrites a newer one', async () => {
    const env = await start();
    env.panel.receive({ type: 'diagnostics', syntax: {}, loadError: null, missingMeshes: ['robot_b/meshes/arm.stl'] });
    env.panel.receive({ type: 'diagnostics', syntax: {}, loadError: null, missingMeshes: [] });
    await sleep(200);
    assert.equal(env.state.diagnostics.size, 0);
});

test('xacro argument values may contain :=', async () => {
    const env = await start();
    env.state.inputBoxValue = 'side:=right  topic:=a:=b';
    await env.state.commands['robotPreviewUrdf.setXacroArgs'](env.vscode.Uri.file(env.primary));
    assert.deepEqual(env.lastOf('load').xacroArgs, { side: 'right', topic: 'a:=b' });
});

test('mesh files open in their own preview', async () => {
    const env = loadExtension({ workspace: await copyFixture() });
    env.activate();
    const workspace = env.vscode.workspace.getWorkspaceFolder().uri.fsPath;
    const stl = path.join(workspace, 'src/robot_b/meshes/arm.stl');
    const panel = env.vscode.window.createWebviewPanel();
    await env.state.customEditors['robotPreviewUrdf.mesh'].resolveCustomEditor({ uri: { fsPath: stl } }, panel);
    assert.match(panel.webview.html, /Content-Security-Policy/);
    panel.receive({ type: 'ready' });
    panel.receive({ type: 'ready' });
    const second = await waitFor(() => env.lastOf('update'));
    const load = env.lastOf('load');
    assert.equal(env.allOf('load').length, 1);
    assert.deepEqual(load.files.map(file => file.path), ['/mesh/arm.stl']);
    assert.equal(load.primary, '/mesh/arm.stl');
    assert.equal(second.primary, '/mesh/arm.stl');
});
