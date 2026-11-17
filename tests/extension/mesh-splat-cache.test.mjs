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
    const acks = [];
    const panel = { webview: { options: {}, cspSource: 'vscode-webview:', asWebviewUri: uri => uri.fsPath, html: '', postMessage: m => acks.push(m), onDidReceiveMessage: listener => { panel.listener = listener; } }, onDidDispose() {} };
    await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(step) }, panel);
    const key = panel.webview.html.match(/data-key="([^"]+)"/)[1];
    // A piece under a key this panel never rendered is refused, with an ack so the page stops waiting.
    await panel.listener({ type: 'stepCache', key: 'x-1-1-0.meshopt', at: 0, size: 10, chunk: new Uint8Array([1]).buffer });
    assert.ok(acks.pop().error);
    await panel.listener({ type: 'stepCache', key, at: 0, size: 10, chunk: new Uint8Array([1, 2, 3, 4, 5, 6]).buffer });
    await panel.listener({ type: 'stepCache', key, at: 6, size: 10, chunk: new Uint8Array([7, 8, 9, 10]).buffer });
    assert.deepEqual(acks, [{ type: 'stepCacheAck' }, { type: 'stepCacheAck' }]);
    const written = fs.readdirSync(cacheDir).find(name => name.endsWith('.meshopt') && !old.some(file => file.endsWith(name)));
    assert.deepEqual([...fs.readFileSync(path.join(cacheDir, written))], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const left = fs.readdirSync(cacheDir);
    assert.equal(fs.existsSync(old[0]), false);
    assert.equal(fs.existsSync(old[1]), true);
    assert.equal(left.length, 2);
    fs.rmSync(root, { recursive: true, force: true });
});

test('reads the opened file in pieces on request', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-read-'));
    const file = path.join(root, 'cloud.pcd');
    fs.writeFileSync(file, 'abcdef');
    const env = loadExtension({ workspace: root, extension, globalStorage: path.join(root, 'storage') });
    env.activate();
    const replies = [];
    const panel = { webview: { options: {}, cspSource: 'vscode-webview:', asWebviewUri: uri => uri.fsPath, html: '', postMessage: m => replies.push(m), onDidReceiveMessage: listener => { panel.listener = listener; } }, onDidDispose() {} };
    await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(file) }, panel);
    await panel.listener({ type: 'read', at: 0 });
    await panel.listener({ type: 'read', at: 6 });
    await panel.listener({ type: 'read', at: -1 });
    assert.equal(new TextDecoder().decode(replies[0].chunk), 'abcdef');
    assert.equal(replies[1].chunk.length, 0);
    assert.ok(replies[2].error);
    fs.rmSync(root, { recursive: true, force: true });
});
