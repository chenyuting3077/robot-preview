import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadExtension } from './vscode-mock.mjs';

const extension = new URL('../../packages/mesh-splat/extension.js', import.meta.url).pathname;

async function open(root, file, postMessage = () => {}) {
    const env = loadExtension({ workspace: root, extension, globalStorage: path.join(root, 'storage') });
    env.activate();
    const panel = { webview: { options: {}, cspSource: 'vscode-webview:', asWebviewUri: uri => uri.fsPath, html: '', postMessage, onDidReceiveMessage: listener => { panel.listener = listener; } }, onDidDispose() {} };
    await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(file) }, panel);
    return { env, panel };
}

test('two saves whose renders finish out of order leave the page for the newer file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-render-'));
    const step = path.join(root, 'part.stp');
    fs.writeFileSync(step, 'ISO-10303-21;');
    const { env, panel } = await open(root, step);
    const stat = env.vscode.workspace.fs.stat;
    // The first render's stat answers late, with the size the file had then.
    let first = true;
    env.vscode.workspace.fs.stat = async uri => {
        const result = await stat(uri);
        if (first) {
            first = false;
            await new Promise(resolve => setTimeout(resolve, 50));
            return { ...result, size: 1 };
        }
        return result;
    };
    fs.writeFileSync(step, 'ISO-10303-21; saved');
    const late = env.state.watched.change();
    const prompt = env.state.watched.create();
    await Promise.all([late, prompt]);
    assert.equal(panel.webview.html.match(/data-bytes="(\d+)"/)[1], String(fs.statSync(step).size));
    fs.rmSync(root, { recursive: true, force: true });
});

test('a new page starting its cache while the old write is mid-piece keeps its own write', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-ack-'));
    const step = path.join(root, 'part.stp');
    fs.writeFileSync(step, 'ISO-10303-21;');
    const acks = [];
    const { panel } = await open(root, step, m => acks.push(m));
    const key = panel.webview.html.match(/data-key="([^"]+)"/)[1];
    const big = new Uint8Array(32 << 20);
    // Old page: first piece of 3; new page: a whole 4-byte cache, sent before the old piece is written.
    const old = panel.listener({ type: 'stepCache', key, at: 0, size: big.length * 3, chunk: big.buffer });
    const fresh = panel.listener({ type: 'stepCache', key, at: 0, size: 4, chunk: new Uint8Array([1, 2, 3, 4]).buffer });
    await Promise.all([old, fresh]);
    await new Promise(resolve => setTimeout(resolve, 100));
    const cacheDir = path.join(root, 'storage', 'step-cache');
    assert.deepEqual([...fs.readFileSync(path.join(cacheDir, key))], [1, 2, 3, 4]);
    assert.deepEqual(fs.readdirSync(cacheDir).filter(f => f.endsWith('.part')), []);
    fs.rmSync(root, { recursive: true, force: true });
});

test('a save that removes the file for a moment does not leave a failed render', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-gone-'));
    const step = path.join(root, 'part.stp');
    fs.writeFileSync(step, 'ISO-10303-21;');
    const { env } = await open(root, step);
    fs.rmSync(step);
    await env.state.watched.change();
    fs.rmSync(root, { recursive: true, force: true });
});

test('an empty cache is refused', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-empty-'));
    const step = path.join(root, 'part.stp');
    fs.writeFileSync(step, 'ISO-10303-21;');
    const acks = [];
    const { panel } = await open(root, step, m => acks.push(m));
    const key = panel.webview.html.match(/data-key="([^"]+)"/)[1];
    await panel.listener({ type: 'stepCache', key, at: 0, size: 0, chunk: new Uint8Array(0).buffer });
    assert.ok(acks.pop().error);
    assert.equal(fs.existsSync(path.join(root, 'storage', 'step-cache', key)), false);
    fs.rmSync(root, { recursive: true, force: true });
});

test('a file written in place mid-read is reported changed, not read as a mix', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-mtime-'));
    const file = path.join(root, 'cloud.pcd');
    fs.writeFileSync(file, 'abcdef');
    const replies = [];
    const { panel } = await open(root, file, m => replies.push(m));
    const mtime = Number(panel.webview.html.match(/data-mtime="([^"]+)"/)[1]);
    await panel.listener({ type: 'read', id: 1, at: 0, mtime });
    fs.writeFileSync(file, 'ABCDEF');
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    await panel.listener({ type: 'read', id: 1, at: 3, mtime });
    assert.equal(new TextDecoder().decode(replies[0].chunk), 'abcdef');
    assert.equal(replies[1].changed, true);
    fs.rmSync(root, { recursive: true, force: true });
});

test('a write while a piece is being read is reported changed, the last piece included', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-mtime-'));
    const file = path.join(root, 'cloud.pcd');
    fs.writeFileSync(file, 'abcdef');
    const replies = [];
    const { panel } = await open(root, file, m => replies.push(m));
    const mtime = Number(panel.webview.html.match(/data-mtime="([^"]+)"/)[1]);
    const openFile = fs.promises.open;
    fs.promises.open = async (...args) => {
        const handle = await openFile(...args);
        const read = handle.read.bind(handle);
        handle.read = async (...readArgs) => {
            fs.writeFileSync(file, 'ABCDEF');
            fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
            return read(...readArgs);
        };
        return handle;
    };
    try {
        await panel.listener({ type: 'read', id: 1, at: 0, mtime });
    } finally {
        fs.promises.open = openFile;
    }
    assert.equal(replies[0].changed, true);
    fs.rmSync(root, { recursive: true, force: true });
});
