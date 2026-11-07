// Path forms the extension must follow so the webview receives the file.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadExtension, sleep } from './vscode-mock.mjs';
import { createPathMatrix, write } from './path-fixture.mjs';

let load;
let root;

async function waitFor(predicate, ms = 5000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
        const value = predicate();
        if (value) return value;
        await sleep(20);
    }
    throw new Error('timed out');
}

before(async () => {
    const matrix = createPathMatrix();
    root = matrix.root;
    Object.assign(process.env, matrix.env);
    const env = loadExtension({ workspace: matrix.ws, config: matrix.config });
    env.open(matrix.primary);
    env.activate();
    const panel = await waitFor(() => env.state.panels[0]?.webview.html && env.state.panels[0]);
    panel.receive({ type: 'ready' });
    load = await waitFor(() => env.lastOf('load'));
});

const sent = key => load.files.some(file => file.path === key);
const abs = rel => path.join(root, rel);

const ROWS = [
    ['package:// inside the opened package', () => '/pkg/meshes/a.stl'],
    ['relative path leaving the package', () => abs('ws/src/other/meshes/c.stl')],
    ['absolute path', () => abs('outside/d.stl')],
    ['file:// URI', () => abs('outside/d2.stl')],
    ['URL-encoded absolute path', () => abs('outside/my part.stl')],
    ['outside .obj', () => abs('outside/g.obj')],
    ['.mtl next to an outside .obj', () => abs('outside/g.mtl')],
    ['texture next to an outside .obj', () => abs('outside/tex.png')],
    ['Gazebo model:// from GZ_SIM_RESOURCE_PATH', () => '/model_x/meshes/e.stl'],
    ['package from the robotPreviewUrdf.packages setting', () => '/ext_pkg/meshes/f.stl'],
    ['xacro $(env) in a mesh path', () => abs('outside/env/h.stl')]
];

for (const [name, key] of ROWS) {
    test(`path matrix (extension): ${name}`, () => {
        assert.ok(sent(key()), `${key()} not sent; got ${load.files.map(file => file.path).join(', ')}`);
    });
}

test('path matrix (extension): unreferenced files outside the package stay unsent', () => {
    assert.ok(!sent(abs('outside/unrelated.stl')));
});

test('path matrix (extension): only textures a mesh names are sent, and non-mesh files never', () => {
    assert.ok(sent(abs('outside/k_tex.jpg')), 'texture named inside the .dae');
    assert.ok(!sent(abs('outside/stray.png')), 'image beside the .obj that its .mtl does not name');
    assert.ok(!sent(abs('outside/recording.bag')), 'plugin file that is not a model asset');
    assert.ok(!sent(abs('outside/env')), 'directory');
});

async function startIn(ws, primary, config) {
    const env = loadExtension({ workspace: ws, config });
    env.open(primary);
    env.activate();
    const panel = await waitFor(() => env.state.panels[0]?.webview.html && env.state.panels[0]);
    panel.receive({ type: 'ready' });
    return { env, load: await waitFor(() => env.lastOf('load')) };
}

function packageSettingWorkspace() {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-pkgs-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    write(path.join(ws, 'src/dup/package.xml'), '<package><name>dup</name></package>');
    write(path.join(ws, 'src/dup/meshes/from_workspace.stl'));
    write(path.join(ws, 'vendor/dup/meshes/from_setting.stl'));
    write(path.join(ws, 'vendor/env_pkg/meshes/e.stl'));
    write(path.join(ws, 'vendor/late/meshes/l.stl'));
    const primary = path.join(ws, 'src/pkg/urdf/robot.urdf');
    write(primary, '<robot name="r"><link name="a"><visual><geometry><mesh filename="package://dup/meshes/from_setting.stl"/></geometry></visual></link>'
        + '<link name="b"><visual><geometry><mesh filename="package://env_pkg/meshes/e.stl"/></geometry></visual></link>'
        + '<link name="c"><visual><geometry><mesh filename="package://late/meshes/l.stl"/></geometry></visual></link></robot>');
    return { ws, primary };
}

test('the packages setting wins over a package.xml in the workspace and expands variables', async () => {
    const { ws, primary } = packageSettingWorkspace();
    process.env.PATH_MATRIX_VENDOR = path.join(ws, 'vendor');
    const { load } = await startIn(ws, primary, { packages: { dup: '${workspaceFolder}/vendor/dup', env_pkg: '${env:PATH_MATRIX_VENDOR}/env_pkg' } });
    const keys = load.files.map(file => file.path);
    assert.ok(keys.includes('/dup/meshes/from_setting.stl'), keys.join(', '));
    assert.ok(!keys.includes('/dup/meshes/from_workspace.stl'));
    assert.ok(keys.includes('/env_pkg/meshes/e.stl'), keys.join(', '));
});

test('a relative packages entry starts at the workspace folder, and editing the setting reloads', async () => {
    const { ws, primary } = packageSettingWorkspace();
    const { env } = await startIn(ws, primary, { packages: {} });
    env.state.config.packages = { late: 'vendor/late' };
    env.fire('config', { affectsConfiguration: key => key === 'robotPreviewUrdf.packages' });
    const reload = await waitFor(() => env.state.posted.filter(m => m.type === 'load' || m.type === 'update').find(m => m.files?.some(file => file.path === '/late/meshes/l.stl')), 3000);
    assert.ok(reload);
});

test('only the environment variables the model references are sent', () => {
    assert.deepEqual(load.env, { PATH_MATRIX_DIR: process.env.PATH_MATRIX_DIR });
});

async function guessWorkspace() {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-guess-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    write(path.join(ws, 'src/pkg/meshes/arm.stl'));
    write(path.join(ws, 'src/pkg/meshes/hand.stl'));
    const primary = path.join(ws, 'src/pkg/urdf/robot.urdf');
    write(primary, '<robot name="r">\n<link name="a"><visual><geometry><mesh filename="package://pkg/meshes/ARM.STL"/></geometry></visual></link>\n'
        + '<link name="b"><visual><geometry><mesh filename="package://pkg/old/hand.stl"/></geometry></visual></link>\n</robot>\n');
    const { env } = await startIn(ws, primary, {});
    env.state.panels[0].receive({
        type: 'diagnostics', syntax: {}, loadError: null, missingMeshes: [],
        guessedMeshes: [
            { path: 'pkg/meshes/ARM.STL', resolved: '/pkg/meshes/arm.stl', match: 'case' },
            { path: 'pkg/old/hand.stl', resolved: '/pkg/meshes/hand.stl', match: 'basename' }
        ]
    });
    const diagnostics = await waitFor(() => env.state.diagnostics.get(primary)?.length === 2 && env.state.diagnostics.get(primary));
    return { env, primary, diagnostics };
}

test('a mesh found only by ignoring case is a warning on its reference, with a quick fix', async () => {
    const { env, primary, diagnostics } = await guessWorkspace();
    const warning = diagnostics.find(d => /case/i.test(d.message));
    assert.equal(warning.severity, 1);
    const line = fs.readFileSync(primary, 'utf8').split('\n')[warning.range.start.line];
    assert.equal(line.slice(warning.range.start.character, warning.range.end.character), 'package://pkg/meshes/ARM.STL');
    const doc = await env.vscode.workspace.openTextDocument(primary);
    const [fix] = env.state.codeActions.provideCodeActions(doc, warning.range, { diagnostics: [warning] });
    assert.equal(fix.edit.edits[0].text, 'package://pkg/meshes/arm.stl');
});

test('a mesh found only by its file name is a warning naming the file the preview used', async () => {
    const { diagnostics } = await guessWorkspace();
    const warning = diagnostics.find(d => d.message.includes('hand.stl') && !/case/i.test(d.message));
    assert.equal(warning.severity, 1);
    assert.match(warning.message, /src\/pkg\/meshes\/hand\.stl/);
});

test('a missing mesh says where it was looked for', async () => {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-missing-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    const primary = path.join(ws, 'src/pkg/urdf/robot.urdf');
    write(primary, '<robot name="r">\n<link name="a"><visual><geometry><mesh filename="package://pkg/meshes/gone.stl"/></geometry></visual></link>\n'
        + '<link name="b"><visual><geometry><mesh filename="../parts/gone2.stl"/></geometry></visual></link>\n</robot>\n');
    const { env } = await startIn(ws, primary, {});
    env.state.panels[0].receive({ type: 'diagnostics', syntax: {}, loadError: null, missingMeshes: ['pkg/meshes/gone.stl', 'pkg/parts/gone2.stl'], guessedMeshes: [] });
    const diagnostics = await waitFor(() => env.state.diagnostics.get(primary)?.length === 2 && env.state.diagnostics.get(primary));
    assert.match(diagnostics[0].message, /looked for src\/pkg\/meshes\/gone\.stl/);
    assert.match(diagnostics[1].message, /looked for src\/pkg\/parts\/gone2\.stl/);
});

test('an unknown package is a diagnostic listing where it was searched, fixed by choosing its folder', async () => {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-ghost-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    const ghost = path.join(ws, 'vendor/ghost');
    write(path.join(ghost, 'meshes/a.stl'));
    const primary = path.join(ws, 'src/pkg/urdf/robot.urdf');
    write(primary, '<robot name="r">\n<link name="a"><visual><geometry><mesh filename="package://ghost/meshes/a.stl"/></geometry></visual></link>\n</robot>\n');
    delete process.env.ROS_PACKAGE_PATH;
    const { env } = await startIn(ws, primary, {});
    env.state.panels[0].receive({ type: 'diagnostics', syntax: {}, loadError: null, missingMeshes: [], guessedMeshes: [] });
    const [diagnostic] = await waitFor(() => env.state.diagnostics.get(primary)?.length && env.state.diagnostics.get(primary));
    assert.match(diagnostic.message, /ROS package "ghost" not found/);
    assert.match(diagnostic.message, /ROS_PACKAGE_PATH \(not set\)/);
    const line = fs.readFileSync(primary, 'utf8').split('\n')[diagnostic.range.start.line];
    assert.equal(line.slice(diagnostic.range.start.character, diagnostic.range.end.character), 'ghost');
    assert.ok(!env.state.status.some(message => /not found/.test(message)), 'no popup');

    const doc = await env.vscode.workspace.openTextDocument(primary);
    const [action] = env.state.codeActions.provideCodeActions(doc, diagnostic.range, { diagnostics: [diagnostic] });
    env.state.openDialogResult = [env.vscode.Uri.file(ghost)];
    await env.state.commands[action.command.command](...action.command.arguments);
    assert.equal(env.state.config.packages.ghost, '${workspaceFolder}/vendor/ghost');
    await waitFor(() => env.state.posted.some(m => (m.type === 'load' || m.type === 'update') && m.files?.some(file => file.path === '/ghost/meshes/a.stl')), 3000);
});

test('a load error with a location is reported in that file and line', async () => {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-yaml-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    const yamlFile = path.join(ws, 'src/pkg/config/bad.yaml');
    write(yamlFile, 'arm:\n  upper: [1, 2\n');
    const primary = path.join(ws, 'src/pkg/urdf/robot.urdf.xacro');
    write(primary, '<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro"><link name="a"/></robot>\n');
    const { env } = await startIn(ws, primary, {});
    env.state.panels[0].receive({ type: 'diagnostics', syntax: {}, loadError: 'YAML error in bad.yaml: unexpected end', loadErrorLocation: { key: '/pkg/config/bad.yaml', line: 2, column: 0 }, missingMeshes: [], guessedMeshes: [] });
    const [diagnostic] = await waitFor(() => env.state.diagnostics.get(yamlFile)?.length && env.state.diagnostics.get(yamlFile));
    assert.equal(diagnostic.range.start.line, 2);
    assert.equal(diagnostic.severity, 0);
    assert.ok(!env.state.diagnostics.get(primary)?.length);
});

test('clicking a link made by a macro with an empty prefix jumps to its definition', async () => {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-reveal-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    const primary = path.join(ws, 'src/pkg/urdf/robot.urdf.xacro');
    write(primary, '<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro">\n<xacro:macro name="arm" params="tf_prefix">\n  <link name="${tf_prefix}base_link"/>\n</xacro:macro>\n<xacro:arm tf_prefix=""/>\n</robot>\n');
    const { env } = await startIn(ws, primary, {});
    await env.state.panels[0].receive({ type: 'reveal', kind: 'link', name: 'base_link' });
    const revealed = await waitFor(() => env.state.revealed, 2000);
    assert.equal(revealed.line, 2);
});

test('packages referenced from an included file outside every package are sent too', async () => {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-shared-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    write(path.join(ws, 'src/other_pkg/package.xml'), '<package><name>other_pkg</name></package>');
    write(path.join(ws, 'src/other_pkg/meshes/a.stl'));
    const shared = path.join(ws, 'shared');
    write(path.join(shared, 'common.xacro'), '<robot xmlns:xacro="http://www.ros.org/wiki/xacro"><link name="c"><visual><geometry><mesh filename="package://other_pkg/meshes/a.stl"/></geometry></visual></link><link name="g"><visual><geometry><mesh filename="package://ghost_pkg/m.stl"/></geometry></visual></link></robot>');
    const primary = path.join(ws, 'src/pkg/urdf/robot.urdf.xacro');
    write(primary, `<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro"><xacro:include filename="${path.join(shared, 'common.xacro')}"/></robot>`);
    const { env, load } = await startIn(ws, primary, {});
    assert.ok(load.files.some(file => file.path === '/other_pkg/meshes/a.stl'), load.files.map(file => file.path).join(', '));
    env.state.panels[0].receive({ type: 'diagnostics', syntax: {}, loadError: null, missingMeshes: [], guessedMeshes: [] });
    const diagnostics = await waitFor(() => env.state.diagnostics.get(path.join(shared, 'common.xacro'))?.length && env.state.diagnostics.get(path.join(shared, 'common.xacro')));
    assert.match(diagnostics[0].message, /ghost_pkg/);
});

test('a relative mesh in an included file resolves from the opened file, as the webview does', async () => {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-relbase-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    write(path.join(ws, 'src/assets/a.stl'));
    const arm = path.join(ws, 'src/pkg/urdf/inc/arm.xacro');
    write(arm, '<robot xmlns:xacro="http://www.ros.org/wiki/xacro">\n<link name="a"><visual><geometry><mesh filename="../../assets/a.stl"/></geometry></visual></link>\n<link name="b"><visual><geometry><mesh filename="../../assets/gone.stl"/></geometry></visual></link>\n</robot>');
    const primary = path.join(ws, 'src/pkg/urdf/robot.urdf.xacro');
    write(primary, '<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro"><xacro:include filename="inc/arm.xacro"/></robot>');
    const { env, load } = await startIn(ws, primary, {});
    assert.ok(load.files.some(file => file.path === path.join(ws, 'src/assets/a.stl')), load.files.map(file => file.path).join(', '));
    env.state.panels[0].receive({ type: 'diagnostics', syntax: {}, loadError: null, missingMeshes: ['/pkg/urdf/../../assets/gone.stl'], guessedMeshes: [] });
    const [diagnostic] = await waitFor(() => env.state.diagnostics.get(arm)?.length && env.state.diagnostics.get(arm));
    assert.equal(diagnostic.range.start.line, 2);
    assert.match(diagnostic.message, /looked for src\/assets\/gone\.stl/);
});

async function ghostWorkspace() {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-ghost2-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    write(path.join(ws, 'src/pkg/urdf/unrelated.urdf'), '<robot name="u"><link name="u"/></robot>');
    const primary = path.join(ws, 'src/pkg/urdf/robot.urdf');
    write(primary, '<robot name="r">\n<link name="a"><visual><geometry><mesh filename="package://ghost/meshes/a.stl"/></geometry></visual></link>\n</robot>\n');
    const { env } = await startIn(ws, primary, {});
    env.state.panels[0].receive({ type: 'diagnostics', syntax: {}, loadError: null, missingMeshes: [], guessedMeshes: [] });
    const [diagnostic] = await waitFor(() => env.state.diagnostics.get(primary)?.length && env.state.diagnostics.get(primary));
    return { ws, env, primary, diagnostic };
}

test('looking for package references opens only files that contain one', async () => {
    const { ws, env } = await ghostWorkspace();
    assert.ok(!env.state.docs.some(doc => doc.uri.fsPath === path.join(ws, 'src/pkg/urdf/unrelated.urdf')));
});

test('choosing a package folder writes only the workspace value, or user settings without a folder', async () => {
    const { ws, env } = await ghostWorkspace();
    env.state.globalConfig = { packages: { user_pkg: '/opt/user_pkg' } };
    env.state.config.packages = { user_pkg: '/opt/user_pkg' };
    env.state.openDialogResult = [env.vscode.Uri.file(path.join(ws, 'vendor/ghost'))];
    await env.state.commands['robotPreviewUrdf.locatePackage']('ghost');
    assert.deepEqual(env.state.configWrites.at(-1), { key: 'packages', value: { ghost: '${workspaceFolder}/vendor/ghost' }, target: 2 });

    env.vscode.workspace.workspaceFolders = undefined;
    env.state.openDialogResult = [env.vscode.Uri.file('/elsewhere/ghost')];
    await env.state.commands['robotPreviewUrdf.locatePackage']('ghost');
    assert.deepEqual(env.state.configWrites.at(-1), { key: 'packages', value: { user_pkg: '/opt/user_pkg', ghost: '/elsewhere/ghost' }, target: 1 });
});

test('a guessed mesh used twice gets one warning per reference, each with its fix', async () => {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-twice-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    write(path.join(ws, 'src/pkg/meshes/Base.STL'));
    const primary = path.join(ws, 'src/pkg/urdf/robot.urdf');
    write(primary, '<robot name="r">\n<link name="a">\n<visual><geometry><mesh filename="package://pkg/meshes/base.stl"/></geometry></visual>\n<collision><geometry><mesh filename="package://pkg/meshes/base.stl"/></geometry></collision>\n</link>\n</robot>\n');
    const { env } = await startIn(ws, primary, {});
    const guess = { path: 'pkg/meshes/base.stl', resolved: '/pkg/meshes/Base.STL', match: 'case' };
    env.state.panels[0].receive({ type: 'diagnostics', syntax: {}, loadError: null, missingMeshes: [], guessedMeshes: [guess, guess] });
    const diagnostics = await waitFor(() => env.state.diagnostics.get(primary)?.length && env.state.diagnostics.get(primary));
    await sleep(100);
    assert.deepEqual(env.state.diagnostics.get(primary).map(d => d.range.start.line), [2, 3]);
    const doc = await env.vscode.workspace.openTextDocument(primary);
    for (const diagnostic of diagnostics) {
        assert.equal(env.state.codeActions.provideCodeActions(doc, diagnostic.range, { diagnostics: [diagnostic] }).length, 1);
    }
});

test('a missing yaml file is reported on the opened file with its path on disk', async () => {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-noyaml-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    const primary = path.join(ws, 'src/pkg/urdf/robot.urdf.xacro');
    write(primary, '<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro"><link name="a"/></robot>\n');
    const { env } = await startIn(ws, primary, {});
    env.state.panels[0].receive({ type: 'diagnostics', syntax: {}, loadError: 'load_yaml: cannot find /pkg/config/missing.yaml', loadErrorLocation: { missing: '/pkg/config/missing.yaml' }, missingMeshes: [], guessedMeshes: [] });
    const [diagnostic] = await waitFor(() => env.state.diagnostics.get(primary)?.length && env.state.diagnostics.get(primary));
    assert.equal(diagnostic.message, 'load_yaml: cannot find src/pkg/config/missing.yaml');
    assert.equal(diagnostic.range.start.line, 0);
});

test('packages setting paths accept ${workspaceFolder:name} and ~', async () => {
    const { ws, primary } = packageSettingWorkspace();
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-home-')));
    write(path.join(home, 'robots/env_pkg/meshes/e.stl'));
    const savedHome = process.env.HOME;
    process.env.HOME = home;
    try {
        const { load } = await startIn(ws, primary, { packages: { dup: `\${workspaceFolder:${path.basename(ws)}}/vendor/dup`, env_pkg: '~/robots/env_pkg' } });
        const keys = load.files.map(file => file.path);
        assert.ok(keys.includes('/dup/meshes/from_setting.stl'), keys.join(', '));
        assert.ok(keys.includes('/env_pkg/meshes/e.stl'), keys.join(', '));
    } finally {
        process.env.HOME = savedHome;
    }
});
