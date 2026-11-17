// Each extension as `vsce` packs it: only the files its .vscodeignore lets through. Activates it and opens
// every custom editor it contributes, and checks that the page's scripts and the STEP tessellators the
// mesh-splat page fetches are in the package, and that what loads only on demand stays out of main.js.
// Run after a build.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadExtension } from '../extension/vscode-mock.mjs';

const packages = new URL('../../packages/', import.meta.url).pathname;
const required = { 'mesh-splat': ['dist/foxtrot_bg.wasm', 'dist/occt-import-js.wasm', 'dist/step-load.js', 'dist/spark.module.js'], usd: ['dist/usd.js', 'dist/stage.js', 'dist/spark.module.js'], 'urdf-mjcf': [] };
// Strings found only in code that main.js must import lazily: Spark (2.4 MB) and the STEP loader.
const lazy = { PackedSplats: 'Spark', 'neither foxtrot nor OpenCascade': 'the STEP loader' };
let failed = 0;
const check = (ok, what) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
    if (!ok) failed++;
};

for (const name of Object.keys(required)) {
    const source = path.join(packages, name);
    const files = execFileSync('npx', ['--yes', '-p', 'node@20', '-p', '@vscode/vsce@3', 'vsce', 'ls', '--no-dependencies'], { cwd: source, encoding: 'utf8' })
        .split('\n').filter(Boolean);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `packaged-${name}-`));
    for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.copyFileSync(path.join(source, file), path.join(root, file));
    }
    for (const file of required[name]) check(files.includes(file), `${name} packs ${file}`);
    check(!files.some(file => file.endsWith('.map') || /^vendor\/.*\.(js|wasm)$/.test(file)), `${name} packs no source maps or vendor sources`);
    if (files.includes('dist/main.js')) {
        const main = fs.readFileSync(path.join(root, 'dist/main.js'), 'utf8');
        for (const [marker, what] of Object.entries(lazy)) check(!main.includes(marker), `${name} main.js leaves out ${what}`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const env = loadExtension({ workspace: root, extension: path.join(root, manifest.main), root, globalStorage: path.join(root, 'storage') });
    try {
        env.activate();
        check(true, `${name} activates`);
    } catch (error) {
        check(false, `${name} activates: ${error.message}`);
        continue;
    }
    for (const { viewType, selector } of manifest.contributes.customEditors ?? []) {
        const sample = path.join(root, selector[0].filenamePattern.replace('*', 'sample'));
        fs.writeFileSync(sample, '');
        const panel = { webview: { options: {}, cspSource: 'vscode-webview:', asWebviewUri: uri => uri.fsPath, html: '', postMessage() {}, onDidReceiveMessage() {} }, onDidDispose() {} };
        try {
            await env.state.customEditors[viewType].resolveCustomEditor({ uri: env.vscode.Uri.file(sample) }, panel);
        } catch (error) {
            check(false, `${name} ${viewType} renders: ${error.message}`);
            continue;
        }
        const base = panel.webview.html.match(/<base href="([^"]+)"/)?.[1];
        const scripts = [...panel.webview.html.matchAll(/<script[^>]* src="([^"]+)"/g)].map(match => path.join(base, match[1]));
        check(scripts.length > 0 && scripts.every(file => fs.existsSync(file)), `${name} ${viewType} renders with its scripts`);
    }
    fs.rmSync(root, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : 'packaged: all passed');
process.exit(failed ? 1 : 0);
