import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadExtension, sleep } from '../extension/vscode-mock.mjs';

const extension = new URL('../../packages/mesh-splat/extension.js', import.meta.url).pathname;
const shots = process.env.SHOTS;
const extraFiles = process.argv.slice(2);
const results = [];

function splatPly(scales, count = 2000) {
    const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', ...scales, 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
    const head = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${props.map(p => `property float ${p}\n`).join('')}end_header\n`);
    const body = Buffer.alloc(count * props.length * 4);
    for (let i = 0; i < count; i++) {
        const a = i * 2.399, r = Math.sqrt(i / count);
        const row = [r * Math.cos(a), r * Math.sin(a), 0, 1.5 * Math.cos(a), 1.5 * Math.sin(a), 0.5, 3, ...scales.map(() => -4), 1, 0, 0, 0];
        row.forEach((value, j) => body.writeFloatLE(value, (i * props.length + j) * 4));
    }
    return Buffer.concat([head, body]);
}

function fixtures(dir) {
    const triangle = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
    const files = {
        'cube.stl': `solid c\n${[[0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0, 0, 0, 1, 1, 0, 0]].map(v => `facet normal 0 0 1\nouter loop\nvertex ${v.slice(0, 3).join(' ')}\nvertex ${v.slice(3, 6).join(' ')}\nvertex ${v.slice(6).join(' ')}\nendloop\nendfacet\n`).join('')}endsolid c\n`,
        'quad.obj': 'mtllib quad.mtl\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nusemtl red\nf 1 2 3 4\n',
        'quad.mtl': 'newmtl red\nKd 1 0 0\n',
        'square.off': 'OFF\n4 1 0\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n',
        'cloud.xyz': Array.from({ length: 500 }, (_, i) => `${Math.cos(i)} ${Math.sin(i)} ${i / 500}`).join('\n'),
        'mesh.ply': 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0 255 0 0\n1 0 0 0 255 0\n0 1 0 0 0 255\n3 0 1 2\n',
        'cloud.ply': `ply\nformat ascii 1.0\nelement vertex 3000\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n${Array.from({ length: 3000 }, (_, i) => { const r = Math.sqrt(i / 3000), t = i * 2.399; return `${r * Math.cos(t)} ${r * Math.sin(t)} 0 255 ${i % 255} 0`; }).join('\n')}\n`,
        'cloud.pcd': `VERSION .7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\nWIDTH 200\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS 200\nDATA ascii\n${Array.from({ length: 200 }, (_, i) => `${Math.cos(i)} ${i / 200} ${Math.sin(i)}`).join('\n')}\n`,
        'tri.gltf': JSON.stringify({
            asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
            meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
            accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
            bufferViews: [{ buffer: 0, byteLength: 36 }],
            buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${triangle.toString('base64')}` }]
        }),
        'gauss3d.ply': splatPly(['scale_0', 'scale_1', 'scale_2']),
        'gauss2d.ply': splatPly(['scale_0', 'scale_1']),
        'BIG.STL': fs.readFileSync(new URL('../fixtures/ros_ws/src/robot_b/meshes/arm.stl', import.meta.url))
    };
    Object.entries(files).forEach(([name, data]) => fs.writeFileSync(path.join(dir, name), data));
    return Object.keys(files).filter(name => name !== 'quad.mtl').map(name => path.join(dir, name));
}

async function htmlFor(file) {
    const env = loadExtension({ workspace: path.dirname(file), extension });
    env.activate();
    const panel = { webview: { options: {}, cspSource: 'vscode-webview:', asWebviewUri: uri => uri.fsPath, html: '' }, onDidDispose() {} };
    await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(file) }, panel);
    return panel.webview.html.replaceAll('vscode-webview:', "'self'");
}

const pages = new Map();
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (pages.has(url.pathname)) {
        res.setHeader('Content-Type', 'text/html');
        return res.end(pages.get(url.pathname));
    }
    fs.readFile(decodeURIComponent(url.pathname), (error, data) => {
        if (error) return res.writeHead(404).end();
        res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(data);
    });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-e2e-'));
const port = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn(process.env.CHROME || 'google-chrome', [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=900,600',
    '--use-gl=angle', `--use-angle=${process.env.ANGLE || 'swiftshader'}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank'
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 100 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { await sleep(100); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => { ws.onopen = resolve; });
let nextId = 0;
const pending = new Map();
ws.onmessage = event => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message.result);
};
const send = (method, params = {}) => new Promise(resolve => {
    pending.set(++nextId, resolve);
    ws.send(JSON.stringify({ id: nextId, method, params }));
});
const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));" });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-fixtures-'));
for (const file of [...fixtures(dir), ...extraFiles.map(file => path.resolve(file))]) {
    const name = path.basename(file);
    pages.set(`/page/${name}`, await htmlFor(file));
    await send('Page.navigate', { url: `${origin}/page/${name}` });
    let state;
    const started = Date.now();
    while (Date.now() - started < 60000) {
        state = await evaluate(`({ loading: !document.getElementById('loading-indicator')?.hidden, error: document.getElementById('load-error')?.hidden ? '' : document.getElementById('load-error')?.textContent, info: document.getElementById('info-table')?.innerText, csp: window.__csp })`);
        if (state && !state.loading) break;
        await sleep(200);
    }
    let camera = '';
    if (!state.loading && !state.error && /^(cube\.stl|cloud\.ply|gauss3d\.ply)$/.test(name)) {
        const size = await evaluate('[innerWidth, innerHeight]');
        const shot = async () => (await send('Page.captureScreenshot', { format: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: size[0], height: size[1], scale: 0.25 } })).data;
        const diff = (a, b) => evaluate(`(async () => {
            const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/jpeg;base64,' + src; });
            const [x, y] = await Promise.all([load('${a}'), load('${b}')]);
            const px = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
            const p = px(x), q = px(y); let n = 0;
            for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 40) n++;
            return n / (p.length / 4);
        })()`);
        const key = async (k, hold = 0) => {
            await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: `Key${k.toUpperCase()}`, text: k });
            await sleep(hold);
            await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: `Key${k.toUpperCase()}` });
            await sleep(600);
        };
        await sleep(800);
        const before = await shot();
        await evaluate(`document.querySelector('canvas').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: ${Math.round(size[0] * 0.42)}, clientY: ${Math.round(size[1] * 0.58)} }))`);
        await sleep(600);
        const moved = await diff(before, await shot());
        await key('f');
        const restored = await diff(before, await shot());
        await key('w', 400);
        const flown = await diff(before, await shot());
        await key('f');
        camera = ` dblclick ${(moved * 100).toFixed(1)}%, F ${(restored * 100).toFixed(1)}%, W ${(flown * 100).toFixed(1)}%`;
        state.cameraOk = moved > 0.01 && restored < 0.01 && flown > 0.01;
    }
    const ok = !state.loading && !state.error && state.csp.length === 0 && state.cameraOk !== false;
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${Math.round((Date.now() - started) / 100) / 10}s ${state.error || ''} ${state.csp.join(', ')}${camera}\n  ${String(state.info).replace(/\n/g, ' | ')}`);
    if (shots) {
        await sleep(1500);
        fs.mkdirSync(shots, { recursive: true });
        fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
}

chrome.kill();
await new Promise(resolve => chrome.on('exit', resolve));
server.close();
await sleep(1000);
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
