import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openMeshSplat, waitFor } from './vscode-mock.mjs';

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
