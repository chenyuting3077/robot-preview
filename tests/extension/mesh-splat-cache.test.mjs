import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadExtension } from './vscode-mock.mjs';

const extension = new URL('../../packages/mesh-splat/extension.js', import.meta.url).pathname;

test('STEP cache drops oldest GLBs past 1 GB and keeps the new one', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-cache-'));
    const storage = path.join(root, 'storage');
    const cacheDir = path.join(storage, 'step-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    // Sparse, so 1.2 GB of old entries costs no disk.
    const old = ['a-1-1-0.glb', 'b-1-1-0.glb'].map((name, i) => {
        const file = path.join(cacheDir, name);
        fs.closeSync(fs.openSync(file, 'w'));
        fs.truncateSync(file, 600 << 20);
        fs.utimesSync(file, 1000 + i, 1000 + i);
        return file;
    });
    const step = path.join(root, 'part.stp');
    fs.writeFileSync(step, 'ISO-10303-21;');
    const env = loadExtension({ workspace: root, extension, globalStorage: storage });
    env.activate();
    const panel = { webview: { options: {}, cspSource: 'vscode-webview:', asWebviewUri: uri => uri.fsPath, html: '', onDidReceiveMessage: listener => { panel.listener = listener; } }, onDidDispose() {} };
    await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(step) }, panel);
    await panel.listener({ type: 'stepCache', glb: new Uint8Array(10) });
    const left = fs.readdirSync(cacheDir);
    assert.equal(fs.existsSync(old[0]), false);
    assert.equal(fs.existsSync(old[1]), true);
    assert.equal(left.length, 2);
    fs.rmSync(root, { recursive: true, force: true });
});
