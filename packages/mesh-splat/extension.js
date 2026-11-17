const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const escapeAttr = text => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Tessellating a STEP assembly takes seconds (foxtrot) to minutes (OpenCascade), so the webview sends back
// its tessellation (meshopt-encoded, see webview/step-cache.mjs) and later opens of the same file (path, mtime, size, extension version) load that instead.
const CACHE_LIMIT = 1 << 30;
const READ_PIECE = 16 << 20;

function stepCache(cacheDir, fileUri, stat, version) {
    if (!cacheDir || !/\.ste?p$/i.test(fileUri.path)) return null;
    const prefix = crypto.createHash('sha1').update(fileUri.path).digest('hex').slice(0, 16);
    return { prefix, uri: vscode.Uri.joinPath(cacheDir, `${prefix}-${stat.mtime}-${stat.size}-${version}.meshopt`) };
}

async function renderHtml(template, webview, distUri, fileUri, stat, cache) {
    const source = webview.cspSource;
    const csp = [
        "default-src 'none'",
        `script-src ${source} 'wasm-unsafe-eval'`,
        `style-src ${source} 'unsafe-inline'`,
        `img-src ${source} blob: data:`,
        `connect-src ${source} blob: data:`,
        'worker-src blob: data:'
    ].join('; ');
    const data = {
        src: `${webview.asWebviewUri(fileUri)}?v=${stat.mtime}`,
        name: path.basename(fileUri.path),
        bytes: stat.size,
        key: cache ? path.basename(cache.uri.fsPath) : '',
        piece: READ_PIECE,
        cached: cache ? await vscode.workspace.fs.stat(cache.uri).then(() => webview.asWebviewUri(cache.uri), () => '') : ''
    };
    return template
        .replace(/<html lang="[^"]*">/, `<html lang="${vscode.env.language}">`)
        .replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}"><base href="${webview.asWebviewUri(distUri)}/">`)
        .replace('<body>', `<body ${Object.entries(data).map(([key, value]) => `data-${key}="${escapeAttr(value)}"`).join(' ')}>`);
}

// The cache arrives in pieces, each acknowledged before the next is sent, and goes straight to disk: one
// 139 MB message was held by the workbench, the extension host and the main process at once. Each editor
// writes its own .part, so two editors of one file don't write over each other. Every piece gets an ack,
// carrying the error when it was refused or could not be written, so the page never waits forever.
function cacheWriter(dir, keys, post) {
    let incoming = null;
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
        if (!dir || !keys.has(message.key) || !(chunk instanceof Uint8Array) || !Number.isInteger(message.size)) throw new Error('bad cache piece');
        if (message.at === 0) {
            drop();
            await fs.promises.mkdir(dir, { recursive: true });
            const target = path.join(dir, message.key);
            const part = `${target}.${crypto.randomBytes(4).toString('hex')}.part`;
            incoming = { target, part, written: 0, size: message.size, handle: await fs.promises.open(part, 'w') };
        }
        if (!incoming || message.at !== incoming.written) throw new Error('cache piece out of order');
        if (message.size !== incoming.size || message.at + chunk.length > message.size) throw new Error('cache piece past its size');
        await incoming.handle.write(chunk, 0, chunk.length, message.at);
        incoming.written += chunk.length;
        if (incoming.written < message.size) return;
        const { target, part, handle } = incoming;
        incoming = null;
        await handle.close();
        const prefix = path.basename(target).split('-')[0];
        for (const file of await fs.promises.readdir(dir)) {
            const full = path.join(dir, file);
            if (file.startsWith(`${prefix}-`) && !file.endsWith('.part') && full !== target) await fs.promises.rm(full, { force: true });
        }
        await fs.promises.rename(part, target);
        await trimCache(dir, target);
    };
    return {
        receive: message => receive(message).then(() => post({ type: 'stepCacheAck' }), error => {
            drop();
            post({ type: 'stepCacheAck', error: String(error?.message ?? error) });
        }),
        dispose: drop
    };
}

// Oldest first until the folder fits. A .part younger than an hour may be another editor's write in
// progress; older ones are left over from a closed window and go like any entry.
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

// VS Code hands a webview a fetched resource only once all of it is in memory (a 1.2 GB PCD grew the
// webview by 1.6 GB before parsing), so big files are read here and sent in pieces on request. Each read
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
            post({ type: 'readReply', id, at, error: String(error?.message ?? error) });
        }
    };
    return { read, done: close, dispose: () => [...handles.keys()].forEach(close) };
}

function activate(context) {
    const distUri = vscode.Uri.joinPath(context.extensionUri, 'dist');
    const cacheDir = context.globalStorageUri && vscode.Uri.joinPath(context.globalStorageUri, 'step-cache');
    const template = fs.readFileSync(path.join(distUri.fsPath, 'index.html'), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(context.extensionUri.fsPath, 'package.json'), 'utf8'));
    const provider = {
        openCustomDocument: uri => ({ uri, dispose() {} }),
        async resolveCustomEditor(document, panel) {
            const dir = vscode.Uri.joinPath(document.uri, '..');
            const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
            panel.webview.options = { enableScripts: true, localResourceRoots: [distUri, dir, ...(folder ? [folder] : []), ...(cacheDir ? [cacheDir] : [])] };
            // The page names the cache key it was rendered with: a save during tessellation re-renders with a
            // new key, and the old page's model must not be filed under it.
            const keys = new Set();
            const render = async () => {
                const stat = await vscode.workspace.fs.stat(document.uri);
                const cache = stepCache(cacheDir, document.uri, stat, manifest.version);
                if (cache) keys.add(path.basename(cache.uri.fsPath));
                panel.webview.html = await renderHtml(template, panel.webview, distUri, document.uri, stat, cache);
            };
            const post = message => panel.webview.postMessage(message);
            const writer = cacheWriter(cacheDir?.fsPath, keys, post);
            const reader = fileReader(document.uri.fsPath, post);
            panel.webview.onDidReceiveMessage(message => {
                if (message?.type === 'read') return reader.read(message.id, message.at);
                if (message?.type === 'readDone') return reader.done(message.id);
                if (message?.type === 'stepCache') return writer.receive(message);
            });
            panel.onDidDispose(() => {
                reader.dispose();
                writer.dispose();
            });
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, path.basename(document.uri.path)));
            // Editors that save by writing a new file and renaming it over the old one fire create, not change.
            watcher.onDidChange(render);
            watcher.onDidCreate(render);
            panel.onDidDispose(() => watcher.dispose());
            await render();
        }
    };
    const options = { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true };
    const { customEditors } = manifest.contributes;
    context.subscriptions.push(...customEditors.map(({ viewType }) => vscode.window.registerCustomEditorProvider(viewType, provider, options)));
}

module.exports = { activate, deactivate() {} };
