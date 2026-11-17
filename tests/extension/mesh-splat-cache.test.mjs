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
    // Another editor's write in progress survives the trim.
    const busy = path.join(cacheDir, 'c-1-1-0.meshopt.0000.part');
    fs.closeSync(fs.openSync(busy, 'w'));
    fs.truncateSync(busy, 100 << 20);
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
    assert.deepEqual(acks, [{ type: 'stepCacheAck', key, render: undefined, at: 0 }, { type: 'stepCacheAck', key, render: undefined, at: 6 }]);
    const written = fs.readdirSync(cacheDir).find(name => name.endsWith('.meshopt') && !old.some(file => file.endsWith(name)));
    assert.deepEqual([...fs.readFileSync(path.join(cacheDir, written))], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const left = fs.readdirSync(cacheDir);
    assert.equal(fs.existsSync(old[0]), false);
    assert.equal(fs.existsSync(old[1]), true);
    assert.ok(fs.existsSync(busy));
    assert.equal(left.length, 3);
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
    await panel.listener({ type: 'read', id: 1, at: 0 });
    await panel.listener({ type: 'read', id: 1, at: 6 });
    await panel.listener({ type: 'read', id: 1, at: -1 });
    // A second read runs on its own handle; after readDone the first one has none.
    await panel.listener({ type: 'read', id: 2, at: 2 });
    await panel.listener({ type: 'readDone', id: 1 });
    await panel.listener({ type: 'read', id: 1, at: 2 });
    assert.equal(new TextDecoder().decode(replies[0].chunk), 'abcdef');
    assert.equal(replies[1].chunk.length, 0);
    assert.ok(replies[2].error);
    assert.ok(replies[3].error, 'a read that never started at 0 has no handle');
    assert.equal(replies[4].error, 'read not open');
    assert.deepEqual(replies.map(r => r.id), [1, 1, 1, 2, 1]);
    fs.rmSync(root, { recursive: true, force: true });
});

test('a cache write cut short leaves no .part behind', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-drop-'));
    const storage = path.join(root, 'storage');
    const step = path.join(root, 'part.stp');
    fs.writeFileSync(step, 'ISO-10303-21;');
    const env = loadExtension({ workspace: root, extension, globalStorage: storage });
    env.activate();
    const acks = [];
    const panel = { webview: { options: {}, cspSource: 'vscode-webview:', asWebviewUri: uri => uri.fsPath, html: '', postMessage: m => acks.push(m), onDidReceiveMessage: listener => { panel.listener = listener; } }, onDidDispose: f => { panel.dispose = f; } };
    await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(step) }, panel);
    const key = panel.webview.html.match(/data-key="([^"]+)"/)[1];
    await panel.listener({ type: 'stepCache', key, at: 0, size: 10, chunk: new Uint8Array(6).buffer });
    // Out of order: refused, and the write so far is dropped.
    await panel.listener({ type: 'stepCache', key, at: 8, size: 10, chunk: new Uint8Array(2).buffer });
    assert.ok(acks.pop().error);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(fs.readdirSync(path.join(storage, 'step-cache')), []);
    fs.rmSync(root, { recursive: true, force: true });
});

test('a cache piece past the announced size is refused', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-size-'));
    const storage = path.join(root, 'storage');
    const step = path.join(root, 'part.stp');
    fs.writeFileSync(step, 'ISO-10303-21;');
    const env = loadExtension({ workspace: root, extension, globalStorage: storage });
    env.activate();
    const acks = [];
    const panel = { webview: { options: {}, cspSource: 'vscode-webview:', asWebviewUri: uri => uri.fsPath, html: '', postMessage: m => acks.push(m), onDidReceiveMessage: listener => { panel.listener = listener; } }, onDidDispose() {} };
    await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(step) }, panel);
    const key = panel.webview.html.match(/data-key="([^"]+)"/)[1];
    await panel.listener({ type: 'stepCache', key, at: 0, size: 4, chunk: new Uint8Array(6).buffer });
    assert.ok(acks.pop().error);
    await panel.listener({ type: 'stepCache', key, at: 0, size: 10, chunk: new Uint8Array(6).buffer });
    await panel.listener({ type: 'stepCache', key, at: 6, size: 12, chunk: new Uint8Array(4).buffer });
    assert.ok(acks.pop().error, 'a size that changes mid-write');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(fs.readdirSync(path.join(storage, 'step-cache')), []);
    fs.rmSync(root, { recursive: true, force: true });
});

test('a save that renames a new file over the old one re-renders with a new cache key', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-rename-'));
    const step = path.join(root, 'part.stp');
    fs.writeFileSync(step, 'ISO-10303-21;');
    const env = loadExtension({ workspace: root, extension, globalStorage: path.join(root, 'storage') });
    env.activate();
    const panel = { webview: { options: {}, cspSource: 'vscode-webview:', asWebviewUri: uri => uri.fsPath, html: '', postMessage() {}, onDidReceiveMessage() {} }, onDidDispose() {} };
    await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(step) }, panel);
    const before = panel.webview.html.match(/data-key="([^"]+)"/)[1];
    fs.writeFileSync(`${step}.tmp`, 'ISO-10303-21; changed');
    fs.renameSync(`${step}.tmp`, step);
    await env.state.watched.create();
    assert.notEqual(panel.webview.html.match(/data-key="([^"]+)"/)[1], before);
    fs.rmSync(root, { recursive: true, force: true });
});
