import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadExtension, sleep } from './vscode-mock.mjs';

const STL = 'solid x\nendsolid x\n';

function write(file, data = STL) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
}

async function waitFor(predicate, ms = 5000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
        const value = predicate();
        if (value) return value;
        await sleep(20);
    }
    throw new Error('timed out');
}

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
