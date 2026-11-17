import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from '../../packages/mesh-splat/webview/transport.mjs';

globalThis.window ??= new EventTarget();
const deliver = data => window.dispatchEvent(Object.assign(new Event('message'), { data }));

// An extension that answers reads from `file` in `piece`-sized chunks, out of order, and records what it saw.
function fakeExtension(file, piece, { failAt } = {}) {
    const seen = { inFlight: 0, most: 0, done: [], cache: [] };
    const vscodeApi = {
        postMessage(message) {
            if (message.type === 'readDone') return seen.done.push(message.id);
            if (message.type === 'stepCache') {
                seen.cache.push(message);
                return setTimeout(() => deliver({ type: 'stepCacheAck', key: message.key, render: message.render, at: message.at, ...(message.at > 0 ? { error: 'disk full' } : {}) }));
            }
            if (message.type !== 'read') return;
            seen.most = Math.max(seen.most, ++seen.inFlight);
            setTimeout(() => {
                seen.inFlight--;
                if (message.at === failAt) return deliver({ type: 'readReply', id: message.id, at: message.at, error: 'cannot read' });
                deliver({ type: 'readReply', id: message.id, at: message.at, chunk: file.slice(message.at, message.at + piece) });
            }, Math.random() * 5);
        }
    };
    return { vscodeApi, seen };
}

const bytes = n => Uint8Array.from({ length: n }, (_, i) => i % 251);

test('reads the file in pieces, three at a time, and says when it is done', async () => {
    const file = bytes(100);
    const { vscodeApi, seen } = fakeExtension(file, 16);
    const { readAll } = createTransport(vscodeApi, { src: 'unused', bytes: '100', key: 'k', piece: '16' });
    assert.deepEqual([...await readAll()], [...file]);
    assert.equal(seen.most, 3);
    assert.equal(seen.done.length, 1);
});

test('a file shorter than the page was rendered for is a FileChanged error', async () => {
    const { vscodeApi } = fakeExtension(bytes(40), 16);
    const { readAll } = createTransport(vscodeApi, { src: 'unused', bytes: '100', key: 'k', piece: '16' });
    await assert.rejects(readAll(), { name: 'FileChanged' });
});

test('falls back to fetch when the extension cannot read the file', async () => {
    const file = bytes(30);
    const { vscodeApi } = fakeExtension(file, 16, { failAt: 0 });
    const fetched = [];
    const fetch = globalThis.fetch;
    globalThis.fetch = async url => {
        fetched.push(url);
        return new Response(file);
    };
    try {
        const { readAll } = createTransport(vscodeApi, { src: 'file.pcd', bytes: '30', key: 'k', piece: '16' });
        assert.deepEqual([...await readAll()], [...file]);
        assert.deepEqual(fetched, ['file.pcd']);
    } finally {
        globalThis.fetch = fetch;
    }
});

test('sends the cache in pieces under its key and stops at an error ack', async () => {
    const { vscodeApi, seen } = fakeExtension(bytes(0), 16);
    const { sendCache } = createTransport(vscodeApi, { src: 'unused', bytes: '0', key: 'part-1-2-0.meshopt', piece: '16' });
    const warn = console.warn;
    console.warn = () => {};
    try {
        await sendCache(bytes(40));
    } finally {
        console.warn = warn;
    }
    assert.deepEqual(seen.cache.map(m => [m.key, m.at, m.size, m.chunk.length]), [['part-1-2-0.meshopt', 0, 40, 16], ['part-1-2-0.meshopt', 16, 40, 16]]);
});

test('streaming a file whose size changed since the page was rendered ends in FileChanged', async () => {
    for (const actual of [40, 140]) {
        const { vscodeApi } = fakeExtension(bytes(actual), 16);
        const { fileChunks } = createTransport(vscodeApi, { src: 'unused', bytes: '100', key: 'k', piece: '16' });
        await assert.rejects((async () => { for await (const chunk of fileChunks()) void chunk; })(), { name: 'FileChanged' });
    }
});

test('an ack for another piece does not move the cache on', async () => {
    const sent = [];
    const vscodeApi = { postMessage: message => message.type === 'stepCache' && sent.push(message) };
    const { sendCache } = createTransport(vscodeApi, { src: 'unused', bytes: '0', key: 'k', piece: '16' });
    const sending = sendCache(bytes(40));
    // A late ack from the page this one replaced.
    deliver({ type: 'stepCacheAck', key: 'old-key', at: 0 });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(sent.length, 1, 'still waiting for its own first ack');
    for (const at of [0, 16, 32]) {
        deliver({ type: 'stepCacheAck', key: 'k', at });
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    await sending;
    assert.equal(sent.length, 3);
});

test('an ack for the same key from a page rendered before this one is ignored', async () => {
    const sent = [];
    const vscodeApi = { postMessage: message => message.type === 'stepCache' && sent.push(message) };
    const { sendCache } = createTransport(vscodeApi, { src: 'unused', bytes: '0', key: 'k', piece: '16', render: '2' });
    const sending = sendCache(bytes(20));
    deliver({ type: 'stepCacheAck', key: 'k', at: 0, render: 1 });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(sent.length, 1, 'the earlier page\'s ack did not move it on');
    deliver({ type: 'stepCacheAck', key: 'k', at: 0, render: 2 });
    await new Promise(resolve => setTimeout(resolve, 5));
    deliver({ type: 'stepCacheAck', key: 'k', at: 16, render: 2 });
    await sending;
    assert.equal(sent.length, 2);
});
