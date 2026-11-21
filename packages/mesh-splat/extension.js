const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cacheWriter, fileReader, READ_PIECE } = require('./io');

const escapeAttr = text => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Tessellating a STEP assembly takes seconds (foxtrot) to minutes (OpenCascade), so the webview sends back
// its tessellation (meshopt-encoded, see webview/step-cache.mjs) and later opens of the same file (path, mtime,
// size, `build`) load that instead. `build` names the extension version and the tessellators' WASM, so a
// rebuilt foxtrot or OpenCascade drops old entries even without a version bump.
function stepCache(cacheDir, fileUri, stat, build) {
    if (!cacheDir || !/\.(ste?p|ige?s)$/i.test(fileUri.path)) return null;
    const prefix = crypto.createHash('sha1').update(fileUri.path).digest('hex').slice(0, 16);
    return { prefix, uri: vscode.Uri.joinPath(cacheDir, `${prefix}-${stat.mtime}-${stat.size}-${build}.meshopt`) };
}

// The Display menu's grid / axes / bounds, as last left for point clouds and for other models, open the next file.
const HELPERS_KEY = 'displayHelpers';
const HELPER_NAMES = ['grid', 'axes', 'bounds'];
// Whether a USD view picks parts under the pointer, as last left.
const PICK_KEY = 'pickParts';
const validHelpers = helpers => Object.fromEntries(['cloud', 'model'].filter(kind => Array.isArray(helpers?.[kind]))
    .map(kind => [kind, helpers[kind].filter(name => HELPER_NAMES.includes(name))]));

async function renderHtml(template, webview, distUri, fileUri, stat, cache, turn, helpers, pick) {
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
        mtime: stat.mtime,
        key: cache ? path.basename(cache.uri.fsPath) : '',
        piece: READ_PIECE,
        render: turn,
        cached: cache ? await vscode.workspace.fs.stat(cache.uri).then(() => webview.asWebviewUri(cache.uri), () => '') : '',
        helpers: JSON.stringify(helpers),
        pick: String(pick)
    };
    return template
        .replace(/<html lang="[^"]*">/, `<html lang="${vscode.env.language}">`)
        .replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}"><base href="${webview.asWebviewUri(distUri)}/">`)
        .replace('<body>', `<body ${Object.entries(data).map(([key, value]) => `data-${key}="${escapeAttr(value)}"`).join(' ')}>`);
}

async function saveScreenshot(fileUri, data) {
    if (typeof data !== 'string' || !data) return;
    const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(fileUri, '..', `${path.parse(fileUri.path).name}.png`),
        filters: { 'PNG image': ['png'] }
    });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, Buffer.from(data, 'base64'));
    vscode.window.setStatusBarMessage(`Robot Preview: saved ${vscode.workspace.asRelativePath(target.fsPath)}`, 4000);
}

function activate(context) {
    const distUri = vscode.Uri.joinPath(context.extensionUri, 'dist');
    const cacheDir = context.globalStorageUri && vscode.Uri.joinPath(context.globalStorageUri, 'step-cache');
    const template = fs.readFileSync(path.join(distUri.fsPath, 'index.html'), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(context.extensionUri.fsPath, 'package.json'), 'utf8'));
    // The USD extension shares this file but ships no tessellators: it never opens STEP.
    const tessellators = crypto.createHash('sha1');
    for (const wasm of ['foxtrot_bg.wasm', 'occt-import-js.wasm']) {
        const file = path.join(distUri.fsPath, wasm);
        if (fs.existsSync(file)) tessellators.update(fs.readFileSync(file));
    }
    const build = `${manifest.version}-${tessellators.digest('hex').slice(0, 8)}`;
    const provider = {
        openCustomDocument: uri => ({ uri, dispose() {} }),
        async resolveCustomEditor(document, panel) {
            const dir = vscode.Uri.joinPath(document.uri, '..');
            const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
            panel.webview.options = { enableScripts: true, localResourceRoots: [distUri, dir, ...(folder ? [folder] : []), ...(cacheDir ? [cacheDir] : [])] };
            // The page names the cache key it was rendered with: a save during tessellation re-renders with a
            // new key, and the old page's model must not be filed under it.
            const keys = new Map();
            // A save can fire two events whose renders finish out of order; only the latest one writes the page.
            let renders = 0;
            const render = async () => {
                const turn = ++renders;
                // A rename-style save removes the file for a moment; the create that follows renders again.
                const stat = await vscode.workspace.fs.stat(document.uri).catch(() => null);
                if (!stat) return;
                const cache = stepCache(cacheDir, document.uri, stat, build);
                const html = await renderHtml(template, panel.webview, distUri, document.uri, stat, cache, turn, context.globalState.get(HELPERS_KEY) ?? {}, context.globalState.get(PICK_KEY) ?? true);
                if (turn !== renders) return;
                if (cache) keys.set(path.basename(cache.uri.fsPath), cache.prefix);
                panel.webview.html = html;
            };
            const post = message => panel.webview.postMessage(message);
            const writer = cacheWriter(cacheDir?.fsPath, keys, post);
            const reader = fileReader(document.uri.fsPath, post);
            const handlers = {
                read: message => reader.read(message.id, message.at, message.mtime),
                readDone: message => reader.done(message.id),
                stepCache: message => writer.receive(message),
                screenshot: message => saveScreenshot(document.uri, message.data),
                pick: message => context.globalState.update(PICK_KEY, message.on !== false),
                helpers: message => context.globalState.update(HELPERS_KEY, { ...context.globalState.get(HELPERS_KEY), ...validHelpers(message.helpers) })
            };
            panel.webview.onDidReceiveMessage(message => Object.hasOwn(handlers, message?.type) && handlers[message.type](message));
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
