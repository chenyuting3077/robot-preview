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

test('packages referenced from an included file outside every package are sent too', async () => {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-shared-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    write(path.join(ws, 'src/other_pkg/package.xml'), '<package><name>other_pkg</name></package>');
    write(path.join(ws, 'src/other_pkg/meshes/a.stl'));
    const shared = path.join(ws, 'shared');
    write(path.join(shared, 'common.xacro'), '<robot xmlns:xacro="http://www.ros.org/wiki/xacro"><link name="c"><visual><geometry><mesh filename="package://other_pkg/meshes/a.stl"/></geometry></visual></link><link name="g"><visual><geometry><mesh filename="package://ghost_pkg/m.stl"/></geometry></visual></link></robot>');
    const primary = path.join(ws, 'src/pkg/urdf/robot.urdf.xacro');
    write(primary, `<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro"><xacro:include filename="${path.join(shared, 'common.xacro')}"/></robot>`);
    const { load } = await startIn(ws, primary, {});
    assert.ok(load.files.some(file => file.path === '/other_pkg/meshes/a.stl'), load.files.map(file => file.path).join(', '));
});

test('a relative mesh in an included file resolves from the opened file, as the webview does', async () => {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-relbase-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    write(path.join(ws, 'src/assets/a.stl'));
    const arm = path.join(ws, 'src/pkg/urdf/inc/arm.xacro');
    write(arm, '<robot xmlns:xacro="http://www.ros.org/wiki/xacro">\n<link name="a"><visual><geometry><mesh filename="../../assets/a.stl"/></geometry></visual></link>\n<link name="b"><visual><geometry><mesh filename="../../assets/gone.stl"/></geometry></visual></link>\n</robot>');
    const primary = path.join(ws, 'src/pkg/urdf/robot.urdf.xacro');
    write(primary, '<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro"><xacro:include filename="inc/arm.xacro"/></robot>');
    const { load } = await startIn(ws, primary, {});
    assert.ok(load.files.some(file => file.path === path.join(ws, 'src/assets/a.stl')), load.files.map(file => file.path).join(', '));
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
