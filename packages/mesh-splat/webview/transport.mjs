// VS Code hands a webview a fetched resource only once all of it is in memory (a 1.2 GB PCD grew the webview
// by 1.6 GB before parsing), so in VS Code the extension reads the file and sends it in pieces on request;
// elsewhere, and when the extension cannot read it, fetch streams it. The STEP cache goes the other way in
// pieces, each acknowledged before the next, so the workbench and the extension host never hold all of it.

// `page` is the page's dataset as the extension rendered it: the file's `src` and `bytes`, the cache file
// name `key` it may write, and the extension's read size `piece`, which also sizes the cache pieces.
export function createTransport(vscodeApi, page) {
    const { src, bytes: fileSize, key: cacheKey, piece } = page;
    const PIECE = Number(piece);
    const replies = new Map();
    let cacheAck = null;
    let reads = 0;
    window.addEventListener('message', ({ data }) => {
        if (data?.type === 'stepCacheAck' && data.key === cacheKey) cacheAck?.(data);
        if (data?.type === 'readReply') replies.get(`${data.id}:${data.at}`)?.(data);
    });

    // A size other than the rendered one means a save mid-read, which re-renders the page; the page
    // keeps showing that it is loading instead of an error (see main.js). Checked once a read ends, so a
    // reader that stops early (a header PCDLoader must take) is not an error.
    const changed = () => Object.assign(new Error('the file changed while it was read'), { name: 'FileChanged' });
    async function* fileChunks() {
        let total = 0;
        for await (const chunk of pieces()) {
            total += chunk.length;
            yield chunk;
        }
        if (total !== Number(fileSize)) throw changed();
    }

    // Each read has its own id, so replies of an abandoned read never answer a later one.
    // Three pieces in flight keep the transfer busy while one is parsed.
    async function* pieces() {
        const id = ++reads;
        const request = at => new Promise(resolve => {
            replies.set(`${id}:${at}`, resolve);
            vscodeApi.postMessage({ type: 'read', id, at });
        }).finally(() => replies.delete(`${id}:${at}`));
        if (vscodeApi) {
            const ahead = [0, 1, 2].map(i => request(i * PIECE));
            try {
                for (let at = 0; ; at += PIECE) {
                    const { chunk, error } = await ahead.shift();
                    if (error && at === 0) break;
                    if (error) throw new Error(error);
                    if (!chunk.byteLength) return;
                    ahead.push(request(at + 3 * PIECE));
                    yield new Uint8Array(chunk.buffer ?? chunk, chunk.byteOffset ?? 0, chunk.byteLength);
                    if (chunk.byteLength < PIECE) return;
                }
            } finally {
                vscodeApi.postMessage({ type: 'readDone', id });
            }
        }
        const stream = (await fetch(src)).body.getReader();
        try {
            for (let chunk; !(chunk = await stream.read()).done;) yield chunk.value;
        } finally {
            stream.cancel();
        }
    }


    async function readAll() {
        const out = new Uint8Array(Number(fileSize));
        let at = 0;
        for await (const chunk of fileChunks()) {
            if (at + chunk.length > out.length) throw changed();
            out.set(chunk, at);
            at += chunk.length;
        }
        if (at !== out.length) throw changed();
        return out;
    }

    async function sendCache(bytes) {
        for (let at = 0; at < bytes.byteLength; at += PIECE) {
            // An ack is for this page's key and this piece; one left over from a replaced page is not.
            const acked = new Promise(resolve => { cacheAck = ack => ack.at === at && resolve(ack); });
            vscodeApi.postMessage({ type: 'stepCache', key: cacheKey, at, size: bytes.byteLength, chunk: bytes.slice(at, at + PIECE) });
            const { error } = await acked;
            if (error) return console.warn('STEP cache not written:', error);
        }
    }

    return { fileChunks, readAll, sendCache: vscodeApi ? sendCache : null };
}
