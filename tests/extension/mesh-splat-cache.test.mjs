import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openMeshSplat } from './vscode-mock.mjs';


test('STEP cache drops the oldest entries past 1 GB and keeps the new one', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-cache-'));
    const storage = path.join(root, 'storage');
    const cacheDir = path.join(storage, 'step-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    // Sparse, so 1.2 GB of old entries costs no disk.
    const old = ['a-1-1-0.meshopt', 'b-1-1-0.meshopt'].map((name, i) => {
        const file = path.join(cacheDir, name);
        fs.closeSync(fs.openSync(file, 'w'));
        fs.truncateSync(file, 600 << 20);
        fs.utimesSync(file, 1000 + i, 1000 + i);
        return file;
    });
    // Another window's write in progress (its writer, the test runner's parent, is alive) survives the
    // trim; one left by a process that is gone goes first, as the oldest entry.
    const busy = path.join(cacheDir, `c-1-1-0.meshopt.${process.ppid}.0000.part`);
    const stale = path.join(cacheDir, 'd-1-1-0.meshopt.4194303.0000.part');
    for (const part of [busy, stale]) {
        fs.closeSync(fs.openSync(part, 'w'));
        fs.truncateSync(part, 100 << 20);
    }
    fs.utimesSync(stale, 999, 999);
    const step = path.join(root, 'part.stp');
    fs.writeFileSync(step, 'ISO-10303-21;');
    const acks = [];
    const { panel } = await openMeshSplat(root, step, { postMessage: m => acks.push(m), storage });
    const key = panel.webview.html.match(/data-key="([^"]+)"/)[1];
    // The key names the extension version and a fingerprint of the tessellators' WASM.
    assert.match(key, /-\d+\.\d+\.\d+-[0-9a-f]{8}\.meshopt$/);
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
    assert.equal(fs.existsSync(stale), false);
    assert.equal(left.length, 3);
    fs.rmSync(root, { recursive: true, force: true });
});

test('reads the opened file in pieces on request', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-read-'));
    const file = path.join(root, 'cloud.pcd');
    fs.writeFileSync(file, 'abcdef');
    const replies = [];
    const { panel } = await openMeshSplat(root, file, { postMessage: m => replies.push(m) });
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
    const acks = [];
    const { panel } = await openMeshSplat(root, step, { postMessage: m => acks.push(m), storage });
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
    const acks = [];
    const { panel } = await openMeshSplat(root, step, { postMessage: m => acks.push(m), storage });
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
    const { env, panel } = await openMeshSplat(root, step);
    const before = panel.webview.html.match(/data-key="([^"]+)"/)[1];
    fs.writeFileSync(`${step}.tmp`, 'ISO-10303-21; changed');
    fs.renameSync(`${step}.tmp`, step);
    await env.state.watched.create();
    assert.notEqual(panel.webview.html.match(/data-key="([^"]+)"/)[1], before);
    fs.rmSync(root, { recursive: true, force: true });
});

test('a rebuilt tessellator changes the cache key, and an extension without one still renders', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-build-'));
    const pkg = new URL('../../packages/mesh-splat/', import.meta.url).pathname;
    fs.mkdirSync(path.join(root, 'dist'));
    for (const file of ['extension.js', 'io.js', 'package.json']) fs.copyFileSync(path.join(pkg, file), path.join(root, file));
    fs.copyFileSync(path.join(pkg, 'dist/index.html'), path.join(root, 'dist/index.html'));
    const step = path.join(root, 'part.stp');
    fs.writeFileSync(step, 'ISO-10303-21;');
    const keyOf = async () => {
        const { panel } = await openMeshSplat(root, step, { extension: path.join(root, 'extension.js') });
        return panel.webview.html.match(/data-key="([^"]+)"/)[1];
    };
    const without = await keyOf();
    fs.writeFileSync(path.join(root, 'dist/foxtrot_bg.wasm'), 'a');
    fs.writeFileSync(path.join(root, 'dist/occt-import-js.wasm'), 'b');
    const built = await keyOf();
    fs.writeFileSync(path.join(root, 'dist/foxtrot_bg.wasm'), 'c');
    const rebuilt = await keyOf();
    assert.equal(new Set([without, built, rebuilt]).size, 3);
    fs.rmSync(root, { recursive: true, force: true });
});
