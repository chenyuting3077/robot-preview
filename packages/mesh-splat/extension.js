const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const escapeAttr = text => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// OpenCascade takes minutes on a large STEP assembly, so the webview sends back its tessellation as GLB and
// later opens of the same file (path, mtime, size) load that instead.
function stepCache(cacheDir, fileUri, stat) {
    if (!cacheDir || !/\.ste?p$/i.test(fileUri.path)) return null;
    const prefix = crypto.createHash('sha1').update(fileUri.path).digest('hex').slice(0, 16);
    return { prefix, uri: vscode.Uri.joinPath(cacheDir, `${prefix}-${stat.mtime}-${stat.size}.glb`) };
}

async function renderHtml(template, webview, distUri, fileUri, cacheDir) {
    const stat = await vscode.workspace.fs.stat(fileUri);
    const cache = stepCache(cacheDir, fileUri, stat);
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
    const provider = {
        openCustomDocument: uri => ({ uri, dispose() {} }),
        async resolveCustomEditor(document, panel) {
            const dir = vscode.Uri.joinPath(document.uri, '..');
            const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
            panel.webview.options = { enableScripts: true, localResourceRoots: [distUri, dir, ...(folder ? [folder] : []), ...(cacheDir ? [cacheDir] : [])] };
            const render = async () => {
                panel.webview.html = await renderHtml(template, panel.webview, distUri, document.uri, cacheDir);
            };
            panel.webview.onDidReceiveMessage(async message => {
                const cache = message?.type === 'stepCache' && stepCache(cacheDir, document.uri, await vscode.workspace.fs.stat(document.uri));
                if (!cache || !(message.glb instanceof Uint8Array)) return;
                await vscode.workspace.fs.createDirectory(cacheDir);
                for (const [file] of await vscode.workspace.fs.readDirectory(cacheDir)) {
                    if (file.startsWith(`${cache.prefix}-`)) await vscode.workspace.fs.delete(vscode.Uri.joinPath(cacheDir, file));
                }
                await vscode.workspace.fs.writeFile(cache.uri, message.glb);
            });
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, path.basename(document.uri.path)));
            watcher.onDidChange(render);
            panel.onDidDispose(() => watcher.dispose());
            await render();
        }
    };
    const options = { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true };
    const { customEditors } = JSON.parse(fs.readFileSync(path.join(context.extensionUri.fsPath, 'package.json'), 'utf8')).contributes;
    context.subscriptions.push(...customEditors.map(({ viewType }) => vscode.window.registerCustomEditorProvider(viewType, provider, options)));
}

module.exports = { activate, deactivate() {} };
