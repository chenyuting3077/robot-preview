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
