import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakePanel, openMeshSplat, waitFor } from './vscode-mock.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

test('a Mesh & Splat screenshot is saved as <file name>.png beside the file, through the save dialog', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-shot-'));
    const model = path.join(root, 'scan.final.ply');
    fs.writeFileSync(model, 'ply\n');
    const { env, panel } = await openMeshSplat(root, model);
    await panel.listener({ type: 'screenshot', data: PNG.toString('base64') });
    const saved = path.join(root, 'scan.final.png');
    await waitFor(() => fs.existsSync(saved));
    assert.deepEqual(fs.readFileSync(saved), PNG);
    assert.match(env.state.status.at(-1), /saved scan\.final\.png/);
});

test('a screenshot message without image data saves nothing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-shot-'));
    const model = path.join(root, 'cube.stl');
    fs.writeFileSync(model, 'solid c\nendsolid c\n');
    const { panel } = await openMeshSplat(root, model);
    await panel.listener({ type: 'screenshot', data: 42 });
    assert.deepEqual(fs.readdirSync(root).filter(name => name.endsWith('.png')), []);
});

test('IGES files get a tessellation cache key like STEP, meshes do not', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-iges-'));
    const keyOf = async name => {
        const file = path.join(root, name);
        fs.writeFileSync(file, 'x');
        const { panel } = await openMeshSplat(root, file);
        return panel.webview.html.match(/data-key="([^"]*)"/)[1];
    };
    assert.match(await keyOf('part.igs'), /\.meshopt$/);
    assert.match(await keyOf('PART.IGES'), /\.meshopt$/);
    assert.equal(await keyOf('part.stl'), '');
});

test('Display helpers left on for a kind of model open the next file, and unknown names are dropped', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-helpers-'));
    const [first, second] = ['a.ply', 'b.ply'].map(name => path.join(root, name));
    for (const file of [first, second]) fs.writeFileSync(file, 'ply\n');
    const helpersOf = html => JSON.parse(html.match(/data-helpers="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    const { env, panel } = await openMeshSplat(root, first);
    assert.deepEqual(helpersOf(panel.webview.html), {});
    await panel.listener({ type: 'helpers', helpers: { cloud: ['grid', 'script'] } });
    await panel.listener({ type: 'helpers', helpers: { model: [] } });
    await panel.listener({ type: 'helpers', helpers: { map: ['axes', 'grid'] } });
    const next = fakePanel();
    await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(second) }, next);
    assert.deepEqual(helpersOf(next.webview.html), { cloud: ['grid'], model: [], map: ['axes', 'grid'] });
});

test('turning part picking off is kept for the next file opened', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-pick-'));
    const [first, second] = ['a.usd', 'b.usd'].map(name => path.join(root, name));
    for (const file of [first, second]) fs.writeFileSync(file, '#usda 1.0\n');
    const { env, panel } = await openMeshSplat(root, first);
    assert.match(panel.webview.html, /data-pick="true"/);
    await panel.listener({ type: 'pick', on: false });
    const next = fakePanel();
    await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(second) }, next);
    assert.match(next.webview.html, /data-pick="false"/);
});

test('point size and colouring carry to every file, the up axis only to the file it was chosen on', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-settings-'));
    const [first, second] = ['a.ply', 'b.ply'].map(name => path.join(root, name));
    for (const file of [first, second]) fs.writeFileSync(file, 'ply\n');
    const settingsOf = html => JSON.parse(html.match(/data-settings="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    const { env, panel } = await openMeshSplat(root, first);
    assert.deepEqual(settingsOf(panel.webview.html), {});
    await panel.listener({ type: 'settings', pointSize: 4 });
    await panel.listener({ type: 'settings', colorMode: 'height' });
    await panel.listener({ type: 'settings', up: '+Y' });
    await panel.listener({ type: 'settings', pointSize: 3, colorMode: 'field:x', up: 'sideways' });
    const open = async file => {
        const next = fakePanel();
        await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(file) }, next);
        return settingsOf(next.webview.html);
    };
    assert.deepEqual(await open(second), { pointSize: 4, colorMode: 'height' });
    assert.deepEqual(await open(first), { pointSize: 4, colorMode: 'height', up: '+Y' });
});
