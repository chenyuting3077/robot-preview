import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadExtension, fakePanel } from './vscode-mock.mjs';

const extension = fileURLToPath(new URL('../../packages/mesh-splat/extension.js', import.meta.url));
const usdRoot = fileURLToPath(new URL('../../packages/usd', import.meta.url));
const manifest = name => JSON.parse(fs.readFileSync(new URL(`../../packages/${name}/package.json`, import.meta.url), 'utf8'));
const webview = fs.readFileSync(new URL('../../packages/mesh-splat/webview/index.html', import.meta.url), 'utf8');
const settingsOf = html => JSON.parse(html.match(/data-settings="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

// Opens `name` in the extension at `root` with `values` as the user's settings, keyed by their full names.
async function open(name, values = {}, { root, viewType = 'robotPreviewMeshSplat.viewer', env } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-config-'));
    const file = path.join(dir, name);
    fs.writeFileSync(file, 'ply\n');
    env ??= loadExtension({ workspace: dir, extension, globalStorage: path.join(dir, 'storage'), ...(root ? { root } : {}) });
    env.values = values;
    env.vscode.workspace.getConfiguration = section => ({
        get: key => env.values[`${section}.${key}`],
        inspect: key => ({ globalValue: env.values[`${section}.${key}`] })
    });
    if (!env.activated) env.activate();
    env.activated = true;
    const panel = fakePanel();
    await env.state.customEditors[viewType].resolveCustomEditor({ uri: env.vscode.Uri.file(file) }, panel);
    return { env, panel, file, dir };
}

test('Mesh & Splat and USD each contribute background, point size and up axis, offering only what the view can show', () => {
    const sizes = [...webview.matchAll(/<button[^>]*data-size="(\d+)"/g)].map(match => Number(match[1]));
    const ups = [...webview.match(/<select id="up-select"[\s\S]*?<\/select>/)[0].matchAll(/value="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(sizes, [1, 2, 4]);
    for (const [name, section] of [['mesh-splat', 'robotPreviewMeshSplat'], ['usd', 'robotPreviewUsd']]) {
        const { properties } = manifest(name).contributes.configuration;
        const background = properties[`${section}.background`];
        const pointSize = properties[`${section}.pointSize`];
        const upAxis = properties[`${section}.upAxis`];
        assert.equal(background.default, 'theme', name);
        const pattern = new RegExp(background.pattern);
        for (const value of ['theme', '#ffffff', '#1E1e1E']) assert.ok(pattern.test(value), `${name}: ${value}`);
        for (const value of ['white', '#fff', '#ffffff80', 'theme ']) assert.ok(!pattern.test(value), `${name}: ${value}`);
        assert.deepEqual(pointSize.enum, sizes, name);
        assert.equal(pointSize.default, 2, name);
        assert.deepEqual(upAxis.enum, ['auto', ...ups], name);
        assert.equal(upAxis.default, 'auto', name);
        for (const property of [background, pointSize, upAxis]) assert.ok(property.description || property.markdownDescription, name);
    }
});

test('the opening page gets the background, point size and up axis set in the settings', async () => {
    const { panel } = await open('a.ply', { 'robotPreviewMeshSplat.background': '#ffffff', 'robotPreviewMeshSplat.pointSize': 4, 'robotPreviewMeshSplat.upAxis': '-Y' });
    assert.deepEqual(settingsOf(panel.webview.html), { background: '#ffffff', pointSize: 4, up: '-Y' });
});

test('nothing set: the theme background, the file\'s own up axis and no point size', async () => {
    const { panel } = await open('a.ply');
    assert.deepEqual(settingsOf(panel.webview.html), { background: 'theme' });
});

test('values the view cannot show are left out', async () => {
    const { panel } = await open('a.ply', { 'robotPreviewMeshSplat.background': 'white', 'robotPreviewMeshSplat.pointSize': 3, 'robotPreviewMeshSplat.upAxis': 'up' });
    assert.deepEqual(settingsOf(panel.webview.html), { background: 'theme' });
});

test('a USD view reads the USD settings, not those of Mesh & Splat', async () => {
    const { panel } = await open('scene.usda', { 'robotPreviewMeshSplat.background': '#ffffff', 'robotPreviewUsd.background': '#000000', 'robotPreviewUsd.upAxis': '+X' },
        { root: usdRoot, viewType: 'robotPreviewUsd.viewer' });
    assert.deepEqual(settingsOf(panel.webview.html), { background: '#000000', up: '+X' });
});

test('an up axis chosen in the view for a file wins over the setting, for that file only', async () => {
    const values = { 'robotPreviewMeshSplat.upAxis': '+Y' };
    const { env, panel, file } = await open('a.ply', values);
    await panel.listener({ type: 'settings', up: '-X' });
    const again = fakePanel();
    await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(file) }, again);
    assert.equal(settingsOf(again.webview.html).up, '-X');
    assert.equal(settingsOf((await open('b.ply', values, { env })).panel.webview.html).up, '+Y');
});

test('a point size set in the settings wins over the size last chosen; unset, the last chosen opens the next file', async () => {
    const { env, panel } = await open('a.ply');
    await panel.listener({ type: 'settings', pointSize: 1 });
    assert.equal(settingsOf((await open('b.ply', {}, { env })).panel.webview.html).pointSize, 1);
    assert.equal(settingsOf((await open('c.ply', { 'robotPreviewMeshSplat.pointSize': 4 }, { env })).panel.webview.html).pointSize, 4);
});

test('a point size chosen in a view stays through a file added to it, over the setting', async () => {
    const { panel, dir } = await open('a.ply', { 'robotPreviewMeshSplat.pointSize': 4 });
    fs.writeFileSync(path.join(dir, 'b.ply'), 'ply\n');
    await panel.listener({ type: 'settings', pointSize: 1 });
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(path.join(dir, 'b.ply')).href] });
    assert.match(panel.webview.html, /b\.ply/);
    assert.equal(settingsOf(panel.webview.html).pointSize, 1);
});
