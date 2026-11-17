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
        cached: cache ? await vscode.workspace.fs.stat(cache.uri).then(() => webview.asWebviewUri(cache.uri), () => '') : ''
    };
    return template
        .replace(/<html lang="[^"]*">/, `<html lang="${vscode.env.language}">`)
        .replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}"><base href="${webview.asWebviewUri(distUri)}/">`)
        .replace('<body>', `<body ${Object.entries(data).map(([key, value]) => `data-${key}="${escapeAttr(value)}"`).join(' ')}>`);
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
            // The cache arrives in pieces, each acknowledged before the next is sent, and goes straight to disk:
            // one 139 MB message was held by the workbench, the extension host and the main process at once.
            // Each panel writes its own .part, so two editors of one file don't write over each other.
            let incoming = null;
            let reading = null;
            panel.onDidDispose(() => {
                reading?.then(handle => handle.close(), () => {});
                incoming?.handle.close().catch(() => {});
            });
            panel.webview.onDidReceiveMessage(async message => {
                if (message?.type === 'read') return read(message.at);
                if (message?.type !== 'stepCache') return;
                try {
                    await receiveCache(message);
                } catch (error) {
                    incoming?.handle.close().catch(() => {});
                    incoming = null;
                    panel.webview.postMessage({ type: 'stepCacheAck', error: String(error?.message ?? error) });
                }
            });
            const receiveCache = async message => {
                const chunk = message.chunk instanceof ArrayBuffer ? new Uint8Array(message.chunk) : message.chunk;
                if (!keys.has(message.key) || !(chunk instanceof Uint8Array) || !Number.isInteger(message.size)) throw new Error('bad cache piece');
                if (message.at === 0) {
                    await incoming?.handle.close();
                    await fs.promises.mkdir(cacheDir.fsPath, { recursive: true });
                    const target = path.join(cacheDir.fsPath, message.key);
                    const part = `${target}.${crypto.randomBytes(4).toString('hex')}.part`;
                    incoming = { target, part, written: 0, handle: await fs.promises.open(part, 'w') };
                }
                if (!incoming || message.at !== incoming.written) throw new Error('cache piece out of order');
                await incoming.handle.write(chunk, 0, chunk.length, message.at);
                incoming.written += chunk.length;
                panel.webview.postMessage({ type: 'stepCacheAck' });
                if (incoming.written < message.size) return;
                const { target, part, handle } = incoming;
                incoming = null;
                await handle.close();
                const prefix = path.basename(target).split('-')[0];
                for (const file of await fs.promises.readdir(cacheDir.fsPath)) {
                    const full = path.join(cacheDir.fsPath, file);
                    if (file.startsWith(`${prefix}-`) && !file.endsWith('.part') && full !== target) await fs.promises.rm(full, { force: true });
                }
                await fs.promises.rename(part, target);
                // Oldest first until the folder fits; the 39 MB AMR caches as 85 MB.
                const files = await Promise.all((await fs.promises.readdir(cacheDir.fsPath)).map(async file => {
                    const full = path.join(cacheDir.fsPath, file);
                    return { full, ...(await fs.promises.stat(full)) };
                }));
                let total = files.reduce((sum, file) => sum + file.size, 0);
                for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
                    if (total <= CACHE_LIMIT || file.full === target) break;
                    await fs.promises.rm(file.full, { force: true });
                    total -= file.size;
                }
            };
            // VS Code hands a webview a fetched resource only once all of it is in memory (a 1.2 GB PCD grew
            // the webview by 1.6 GB before parsing), so big files are read here and sent in pieces on request.
            const read = async at => {
                try {
                    if (!Number.isSafeInteger(at) || at < 0) throw new Error('bad offset');
                    if (at === 0) {
                        reading?.then(handle => handle.close(), () => {});
                        reading = fs.promises.open(document.uri.fsPath, 'r');
                    }
                    const buffer = new Uint8Array(READ_PIECE);
                    const { bytesRead } = await (await reading).read(buffer, 0, READ_PIECE, at);
                    panel.webview.postMessage({ type: 'readReply', at, chunk: bytesRead < READ_PIECE ? buffer.slice(0, bytesRead) : buffer });
                } catch (error) {
                    panel.webview.postMessage({ type: 'readReply', at, error: String(error?.message ?? error) });
                }
            };
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, path.basename(document.uri.path)));
            watcher.onDidChange(render);
            panel.onDidDispose(() => watcher.dispose());
            await render();
        }
    };
    const options = { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true };
    const { customEditors } = manifest.contributes;
    context.subscriptions.push(...customEditors.map(({ viewType }) => vscode.window.registerCustomEditorProvider(viewType, provider, options)));
}

module.exports = { activate, deactivate() {} };
