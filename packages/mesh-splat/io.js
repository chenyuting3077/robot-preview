const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_LIMIT = 1 << 30;
const READ_PIECE = 16 << 20;
const messageOf = error => String(error?.message ?? error);

// `keys` maps each cache file name this editor's pages were rendered with to that STEP file's prefix.
// Pieces go straight to disk because one 139 MB message was held by the workbench, the extension host and
// the main process at once; each editor writes its own .part so two editors of one file don't collide.
function cacheWriter(dir, keys, post) {
    let incoming = null;
    let queue = Promise.resolve();
    // An abandoned write takes its .part along, or it would count against the cache until the trim.
    const drop = () => {
        if (incoming) {
            const { handle, part } = incoming;
            handle.close().catch(() => {}).then(() => fs.promises.rm(part, { force: true }));
        }
        incoming = null;
    };
    const receive = async message => {
        const chunk = message.chunk instanceof ArrayBuffer ? new Uint8Array(message.chunk) : message.chunk;
        if (!dir || !keys.has(message.key) || !(chunk instanceof Uint8Array) || !(Number.isInteger(message.size) && message.size > 0)) throw new Error('bad cache piece');
        if (message.at === 0) {
            drop();
            await fs.promises.mkdir(dir, { recursive: true });
            const target = path.join(dir, message.key);
            const part = `${target}.${crypto.randomBytes(4).toString('hex')}.part`;
            incoming = { target, part, prefix: keys.get(message.key), written: 0, size: message.size, handle: await fs.promises.open(part, 'w') };
        }
        if (!incoming || message.at !== incoming.written) throw new Error('cache piece out of order');
        if (message.size !== incoming.size || message.at + chunk.length > message.size) throw new Error('cache piece past its size');
        await incoming.handle.write(chunk, 0, chunk.length, message.at);
        incoming.written += chunk.length;
        if (incoming.written < message.size) return;
        const { target, part, prefix, handle } = incoming;
        incoming = null;
        await handle.close();
        for (const file of await fs.promises.readdir(dir)) {
            const full = path.join(dir, file);
            if (file.startsWith(`${prefix}-`) && !file.endsWith('.part') && full !== target) await fs.promises.rm(full, { force: true });
        }
        await fs.promises.rename(part, target);
        await trimCache(dir, target);
    };
    return {
        // One piece at a time: a new page's first piece would otherwise drop the old page's write while a
        // piece of it is still being written, and that write's failure would then drop the new one.
        receive: message => (queue = queue.then(() => receive(message).then(
            () => post({ type: 'stepCacheAck', key: message.key, render: message.render, at: message.at }),
            error => {
                drop();
                post({ type: 'stepCacheAck', key: message.key, render: message.render, at: message.at, error: messageOf(error) });
            }))),
        dispose: drop
    };
}

// Oldest first until the folder fits. A .part younger than an hour may be another editor's write in
// progress; older ones are left over from a closed window and go like any entry.
// ponytail: an hour is a guess at the longest write; a write that slow loses its .part to the trim and
// fails its rename, so track live writes across editors if that is ever seen.
async function trimCache(dir, keep) {
    const now = Date.now();
    const files = (await Promise.all((await fs.promises.readdir(dir)).map(async file => {
        const full = path.join(dir, file);
        const stat = await fs.promises.stat(full).catch(() => null);
        return stat && { full, size: stat.size, mtimeMs: stat.mtimeMs, busy: file.endsWith('.part') && now - stat.mtimeMs < 3600e3 };
    }))).filter(file => file && !file.busy);
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
        if (total <= CACHE_LIMIT) break;
        if (file.full === keep) continue;
        await fs.promises.rm(file.full, { force: true });
        total -= file.size;
    }
}

// The page reads big files through here, in pieces on request (why: webview/transport.mjs). Each read
// has its own id and handle, closed when the page says it is done or with the editor: closing at the end
// of the file could fail a piece before it that is still being read, since pieces are read concurrently.
function fileReader(file, post) {
    const handles = new Map();
    const close = id => {
        handles.get(id)?.then(handle => handle.close(), () => {});
        handles.delete(id);
    };
    const read = async (id, at) => {
        try {
            if (!Number.isSafeInteger(at) || at < 0) throw new Error('bad offset');
            if (at === 0) {
                close(id);
                handles.set(id, fs.promises.open(file, 'r'));
            }
            if (!handles.has(id)) throw new Error('read not open');
            const buffer = new Uint8Array(READ_PIECE);
            const { bytesRead } = await (await handles.get(id)).read(buffer, 0, READ_PIECE, at);
            post({ type: 'readReply', id, at, chunk: bytesRead < READ_PIECE ? buffer.slice(0, bytesRead) : buffer });
        } catch (error) {
            post({ type: 'readReply', id, at, error: messageOf(error) });
        }
    };
    return { read, done: close, dispose: () => [...handles.keys()].forEach(close) };
}

module.exports = { cacheWriter, fileReader, READ_PIECE };
