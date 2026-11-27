import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadExtension, sleep, fakePanel, chromePath, webviewFile } from '../extension/vscode-mock.mjs';
import { MeshoptEncoder } from '../../packages/mesh-splat/node_modules/meshoptimizer/meshopt_encoder.js';

const extension = fileURLToPath(new URL('../../packages/mesh-splat/extension.js', import.meta.url));
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

// A unit cube whose vertex and index data exist only EXT_meshopt_compression-encoded, so it shows only if
// the viewer decodes meshopt.
await MeshoptEncoder.ready;
function meshoptCube() {
    const positions = new Float32Array(Array.from({ length: 8 }, (_, i) => [i & 1, (i >> 1) & 1, (i >> 2) & 1]).flat());
    const indices = new Uint16Array([[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]].flatMap(([a, b, c, d]) => [a, b, c, a, c, d]));
    const vertices = MeshoptEncoder.encodeVertexBuffer(new Uint8Array(positions.buffer), 8, 12);
    const triangles = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(indices.buffer), indices.length, 2);
    const at = (vertices.length + 3) & ~3;
    const packed = Buffer.alloc(at + triangles.length);
    packed.set(vertices, 0);
    packed.set(triangles, at);
    const meshopt = (byteOffset, byteLength, byteStride, count, mode) => ({ EXT_meshopt_compression: { buffer: 0, byteOffset, byteLength, byteStride, count, mode } });
    return JSON.stringify({
        asset: { version: '2.0' }, extensionsUsed: ['EXT_meshopt_compression'], extensionsRequired: ['EXT_meshopt_compression'],
        scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] },
            { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' }
        ],
        bufferViews: [
            { buffer: 1, byteLength: positions.byteLength, byteStride: 12, extensions: meshopt(0, vertices.length, 12, 8, 'ATTRIBUTES') },
            { buffer: 1, byteLength: indices.byteLength, extensions: meshopt(at, triangles.length, 2, indices.length, 'TRIANGLES') }
        ],
        buffers: [
            { byteLength: packed.length, uri: `data:application/octet-stream;base64,${packed.toString('base64')}` },
            { byteLength: positions.byteLength + indices.byteLength, extensions: { EXT_meshopt_compression: { fallback: true } } }
        ]
    });
}

// 20 x 10 cells, image rows top to bottom: the top-right quadrant occupied (0), the bottom-left unknown (205),
// the rest free (254). With map.yaml's 90 degree yaw, image +x runs up the screen and the image's top to the left,
// so the occupied quadrant lands top-left on screen and the unknown one bottom-right.
function mapPgm() {
    const pixels = Array.from({ length: 200 }, (_, i) => {
        const x = i % 20, y = Math.floor(i / 20);
        return x >= 10 && y < 5 ? 0 : x < 10 && y >= 5 ? 205 : 254;
    });
    return Buffer.concat([Buffer.from('P5\n# CREATOR: e2e 0.100 m/pix\n20 10\n255\n'), Buffer.from(pixels)]);
}

// A headerless float32 LiDAR scan (KITTI, or nuScenes with `ring`): a disc whose intensity grows outward.
function lidarScan(count, ring) {
    const width = ring ? 5 : 4;
    const body = Buffer.alloc(count * width * 4);
    for (let i = 0; i < count; i++) {
        const r = Math.sqrt(i / count), a = i * 2.399;
        [r * Math.cos(a), r * Math.sin(a), 0, i / count, i % 32].slice(0, width).forEach((value, j) => body.writeFloatLE(value, (i * width + j) * 4));
    }
    return body;
}

// A LAS 1.4, point format 7 disc of red points at UTM coordinates (mm scale), its classes and intensity varying.
function lasDisc(count) {
    const head = Buffer.alloc(375), stride = 36, body = Buffer.alloc(count * stride);
    head.write('LASF');
    head[24] = 1;
    head[25] = 4;
    head.writeUInt16LE(375, 94);
    head.writeUInt32LE(375, 96);
    head[104] = 7;
    head.writeUInt16LE(stride, 105);
    head.writeUInt32LE(count, 107);
    [0.001, 0.001, 0.001, 500000, 4000000, 0].forEach((v, i) => head.writeDoubleLE(v, 131 + i * 8));
    [500101, 500099, 4000201, 4000199, 121, 120].forEach((v, i) => head.writeDoubleLE(v, 179 + i * 8));
    head.writeUInt32LE(count, 247);
    for (let i = 0; i < count; i++) {
        const r = Math.sqrt(i / count), a = i * 2.399, at = i * stride;
        body.writeInt32LE(Math.round(100000 + 1000 * r * Math.cos(a)), at);
        body.writeInt32LE(Math.round(200000 + 1000 * r * Math.sin(a)), at + 4);
        body.writeInt32LE(120000 + (i % 100), at + 8);
        body.writeUInt16LE(i, at + 12);
        body[at + 14] = 0x11;
        body[at + 16] = i % 7;
        body.writeDoubleLE(1.3e9 + i, at + 22);
        body.writeUInt16LE(65535, at + 30);
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
        'rgb.xyz': Array.from({ length: 4000 }, (_, i) => { const r = Math.sqrt(i / 4000), t = i * 2.399; return `${r * Math.cos(t)} ${r * Math.sin(t)} 0 255 0 0`; }).join('\n'),
        'mesh.ply': 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0 255 0 0\n1 0 0 0 255 0\n0 1 0 0 0 255\n3 0 1 2\n',
        'cloud.ply': `ply\nformat ascii 1.0\nelement vertex 3000\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n${Array.from({ length: 3000 }, (_, i) => { const r = Math.sqrt(i / 3000), t = i * 2.399; return `${r * Math.cos(t)} ${r * Math.sin(t)} 0 255 ${i % 255} 0`; }).join('\n')}\n`,
        // cloud.ply moved to UTM coordinates: its grid must draw as cleanly as at the origin.
        'cloud-utm.ply': `ply\nformat ascii 1.0\nelement vertex 3000\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n${Array.from({ length: 3000 }, (_, i) => { const r = Math.sqrt(i / 3000), t = i * 2.399; return `${500000 + r * Math.cos(t)} ${4000000 + r * Math.sin(t)} 0 255 ${i % 255} 0`; }).join('\n')}\n`,
        // A pole below z = 0 and an object 0.15 m above it must still show the grid on z = 0. A cloud in UTM
        // coordinates at 500 m altitude has its origin out of view and is framed without that plane. A 2 x 1 m wall
        // scanned from 10 m still shows the axes at the sensor.
        // Half the pole's points lie on its axis, which projects onto the screen's vertical center line.
        'pole.xyz': Array.from({ length: 1000 }, (_, i) => i % 2 ? `${0.1 * ((i * 0.618) % 1) - 0.05} ${0.1 * ((i * 0.755) % 1) - 0.05} ${-i / 1000}` : `0 0 ${-i / 1000}`).join('\n'),
        'table.xyz': Array.from({ length: 1000 }, (_, i) => `${0.1 * ((i * 0.618) % 1)} ${0.1 * ((i * 0.755) % 1)} ${0.15 + i / 10000}`).join('\n'),
        'wall.xyz': Array.from({ length: 1000 }, (_, i) => `10 ${2 * ((i * 0.618) % 1) - 1} ${(i * 0.755) % 1}`).join('\n'),
        'utm.xyz': Array.from({ length: 1000 }, (_, i) => `${500000 + 100 * ((i * 0.618) % 1)} ${4000000 + 100 * ((i * 0.755) % 1)} ${500 + i / 200}`).join('\n'),
        // Without a POINTS line only PCDLoader reads it, and float32 holds its 0.125 x 0.5 m lattice at UTM coordinates.
        'utm-loader.pcd': `VERSION .7\nFIELDS x y z rgb\nSIZE 4 4 4 4\nTYPE F F F F\nCOUNT 1 1 1 1\nWIDTH 1600\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nDATA ascii\n${Array.from({ length: 1600 }, (_, i) => `${500000 + 0.125 * (i % 40)} ${4000000 + 0.5 * Math.floor(i / 40)} 0 ${new Float32Array(new Uint32Array([0xff0000]).buffer)[0].toPrecision(9)}`).join('\n')}\n`,
        'cloud.pcd': `VERSION .7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\nWIDTH 200\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS 200\nDATA ascii\n${Array.from({ length: 200 }, (_, i) => `${Math.cos(i)} ${i / 200} ${Math.sin(i)}`).join('\n')}\n`,
        'tri.gltf': JSON.stringify({
            asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
            meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
            accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
            bufferViews: [{ buffer: 0, byteLength: 36 }],
            buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${triangle.toString('base64')}` }]
        }),
        'cube-meshopt.gltf': meshoptCube(),
        'gauss2d.ply': splatPly(['scale_0', 'scale_1']),
        'fields.ply': `ply\nformat ascii 1.0\nelement vertex 2000\nproperty float x\nproperty float y\nproperty float z\nproperty float confidence\nend_header\n${Array.from({ length: 2000 }, (_, i) => { const r = Math.sqrt(i / 2000), t = i * 2.399; return `${r * Math.cos(t)} ${r * Math.sin(t)} 0 ${i / 2000}`; }).join('\n')}\n`,
        'scene.usda': `#usda 1.0\n(\n    upAxis = "Z"\n    defaultPrim = "World"\n)\ndef Xform "World"\n{\n    def Mesh "Tri"\n    {\n        int[] faceVertexCounts = [3]\n        int[] faceVertexIndices = [0, 1, 2]\n        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]\n    }\n    def Mesh "Hidden"\n    {\n        token visibility = "invisible"\n        int[] faceVertexCounts = [3]\n        int[] faceVertexIndices = [0, 1, 2]\n        point3f[] points = [(50, 0, 0), (51, 0, 0), (50, 1, 0)]\n    }\n    def ParticleField3DGaussianSplat "Gaussians"\n    {\n        point3f[] positions = [(0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1)]\n        quatf[] orientations = [(1, 0, 0, 0), (1, 0, 0, 0), (1, 0, 0, 0), (1, 0, 0, 0)]\n        float3[] scales = [(0.1, 0.1, 0.1), (0.1, 0.1, 0.1), (0.1, 0.1, 0.1), (0.1, 0.1, 0.1)]\n        float[] opacities = [0.9, 0.9, 0.9, 0.9]\n        int radiance:sphericalHarmonicsDegree = 0\n        float3[] radiance:sphericalHarmonicsCoefficients = [(1, 0, 0), (1, 0, 0), (1, 0, 0), (1, 0, 0)]\n    }\n}\n`,
        'scan.bin': lidarScan(3000),
        'utm.las': lasDisc(3000),
        'scan.pcd.bin': lidarScan(2000, true),
        'short.bin': lidarScan(100).subarray(0, 1599),
        'map.yaml': '# e2e map\nimage: map.pgm\nresolution: 0.1\norigin: [1.0, 2.0, 1.5707963]  # yaw 90 degrees\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.196\n',
        'map.pgm': mapPgm(),
        // Nav2's map_saver may write the image's absolute path.
        'abs.yaml': `image: ${path.join(dir, 'map.pgm')}\nresolution: 0.1\norigin: [1.0, 2.0, 1.5707963]\n`,
        'plain.pgm': 'P2\n# not a map\n4 2\n255\n0 64 128 255\n255 128 64 0\n',
        // A picture whose same-named YAML is a camera calibration, not a map.
        'camera.pgm': 'P2\n4 2\n255\n0 64 128 255\n255 128 64 0\n',
        'camera.yaml': 'image_width: 4\nimage_height: 2\ncamera_name: front\n',
        'BIG.STL': fs.readFileSync(new URL('../fixtures/ros_ws/src/robot_b/meshes/arm.stl', import.meta.url))
    };
    Object.entries(files).forEach(([name, data]) => fs.writeFileSync(path.join(dir, name), data));
    return Object.keys(files).filter(name => !['quad.mtl', 'camera.yaml'].includes(name)).map(name => path.join(dir, name));
}

const globalStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-storage-'));
const panels = new Map();
// The page shown is the last panel made; its `settings` messages reach the extension as a webview's do.
let activePanel = null;
async function htmlFor(file) {
    const env = loadExtension({ workspace: path.dirname(file), extension, globalStorage });
    env.activate();
    const panel = activePanel = fakePanel();
    panel.env = env;
    panels.set(path.basename(file), panel);
    await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(file) }, panel);
    return panel.webview.html.replaceAll('vscode-webview:', "'self'");
}

const pages = new Map();
let postedCache = null;
let originShot = null;
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/cache') {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        return req.on('end', () => { postedCache = Buffer.concat(chunks); res.end(); });
    }
    const page = pages.get(decodeURIComponent(url.pathname));
    if (page) {
        res.setHeader('Content-Type', 'text/html');
        return res.end(page);
    }
    let file;
    try {
        file = webviewFile(url.pathname);
    } catch {
        return res.writeHead(404).end();
    }
    fs.readFile(file, (error, data) => {
        if (error) return res.writeHead(404).end();
        res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream');
        res.end(data);
    });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// #24: without WebGL the view says why it is empty instead of staying blank. Its own Chrome, since the flag is per browser.
{
    const started = Date.now();
    const bareProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-nogl-'));
    const barePort = 9100 + Math.floor(Math.random() * 400);
    const bare = spawn(chromePath(), ['--headless=new', `--remote-debugging-port=${barePort}`, `--user-data-dir=${bareProfile}`, '--disable-3d-apis', 'about:blank'], { stdio: 'ignore' });
    let target;
    for (let i = 0; i < 100 && !target; i++) {
        try { target = (await (await fetch(`http://127.0.0.1:${barePort}/json`)).json()).find(t => t.type === 'page'); } catch { await sleep(100); }
    }
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(resolve => { socket.onopen = resolve; });
    let id = 0;
    const replies = new Map();
    const thrown = [];
    socket.onmessage = ({ data }) => {
        const m = JSON.parse(data);
        replies.get(m.id)?.(m.result);
        if (m.method === 'Runtime.exceptionThrown') thrown.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    };
    const call = (method, params = {}) => new Promise(resolve => { replies.set(++id, resolve); socket.send(JSON.stringify({ id, method, params })); });
    await call('Runtime.enable');
    await call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.acquireVsCodeApi = () => ({ getState: () => null, setState() {}, postMessage() {} });' });
    const cube = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-nogl-files-'));
    fs.writeFileSync(path.join(cube, 'cube.stl'), 'solid c\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid c\n');
    pages.set('/page/nogl', await htmlFor(path.join(cube, 'cube.stl')));
    await call('Page.navigate', { url: `${origin}/page/nogl` });
    let text = '';
    for (let i = 0; i < 50 && !/WebGL/.test(text); i++) {
        await sleep(200);
        text = (await call('Runtime.evaluate', { expression: "document.getElementById('load-error')?.checkVisibility() && !document.getElementById('loading-indicator').checkVisibility() ? document.getElementById('load-error').textContent : ''", returnByValue: true })).result.value;
    }
    const unlabelled = (await call('Runtime.evaluate', { expression: "[...document.querySelectorAll('[data-t]')].filter(e => !(e.querySelector('span') ?? e).textContent.trim()).length", returnByValue: true })).result.value;
    const evaluateBare = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    // A triple click selects the message, so it can be copied into a bug report.
    const at = await evaluateBare("(() => { const r = document.getElementById('load-error').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 12 }; })()");
    for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 3 });
    const selected = await evaluateBare('getSelection().toString()');
    const ok = /WebGL/.test(text) && !thrown.length && unlabelled === 0 && /WebGL/.test(selected);
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'} without WebGL the view says so ${Math.round((Date.now() - started) / 100) / 10}s ${JSON.stringify({ text, thrown, unlabelled, selected: selected.slice(0, 40) })}`);
    // Any throw before the view is up shows too: here the file list the page parses first.
    pages.set('/page/broken', pages.get('/page/nogl').replace(/data-files="[^"]*"/, 'data-files="{"'));
    await call('Page.navigate', { url: `${origin}/page/broken` });
    let broken = null;
    for (let i = 0; i < 50 && !broken?.error; i++) {
        await sleep(200);
        broken = await evaluateBare("({ error: document.getElementById('load-error')?.checkVisibility() ? document.getElementById('load-error').textContent : '', loading: document.getElementById('loading-indicator')?.checkVisibility() })");
    }
    const brokenOk = /JSON/.test(broken?.error) && !broken.loading;
    results.push(brokenOk);
    console.log(`${brokenOk ? 'PASS' : 'FAIL'} a throw while the page starts shows in the view ${JSON.stringify(broken)}`);
    bare.kill();
    await new Promise(resolve => bare.on('exit', resolve));
    await sleep(500);
    for (const at of [bareProfile, cube]) try { fs.rmSync(at, { recursive: true, force: true, maxRetries: 5 }); } catch {}
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-e2e-'));
const port = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath(), [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=900,600',
    '--use-gl=angle', `--use-angle=${process.env.ANGLE || 'swiftshader'}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc', 'about:blank'
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
    pending.get(message.id)?.(message);
};
// A reply that never comes (a screenshot or an awaited page promise) fails the file with what it waited for
// instead of hanging the run: one run sat 63 minutes after cloud.ply with nothing logged.
const send = (method, params = {}, timeout = 60000) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const what = `${method} ${String(params.expression ?? '').slice(0, 200)}`;
    const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`no reply in ${timeout / 1000} s: ${what}`));
    }, timeout);
    pending.set(id, message => {
        clearTimeout(timer);
        pending.delete(id);
        if (message.error) reject(new Error(`${message.error.message}: ${what}`));
        else resolve(message.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, timeout) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeout)).result.value;
// The share of a quarter-size screenshot that differs between two of them.
const pageShot = async () => {
    const [width, height] = await evaluate('[innerWidth, innerHeight]');
    return (await send('Page.captureScreenshot', { format: 'jpeg', quality: 60, clip: { x: 0, y: 0, width, height, scale: 0.25 } })).data;
};
const shotDiff = (a, b) => evaluate(`(async () => {
    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/jpeg;base64,' + src; });
    const [x, y] = await Promise.all([load('${a}'), load('${b}')]);
    const px = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const p = px(x), q = px(y); let n = 0;
    for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 40) n++;
    return n / (p.length / 4);
})()`);
// [share, x, y]: how much of a PNG the coloured points cover, and their centroid in pixels. Grey grid lines and
// the background are left out.
const coloredPoints = png => evaluate(`(async () => {
    const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,${png}'; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0, x = 0, y = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 60) { n++; x += (i / 4) % c.width; y += Math.floor(i / 4 / c.width); }
    return [n / (d.length / 4), x / n, y / n];
})()`);
await send('Page.enable');
// Viewer warnings and errors go to stderr, so a failed check shows why.
const exceptions = [];
ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(m.params.type)) console.error('console:', m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.bindingCalled' && m.params.name === '__toExtension') activePanel?.listener(JSON.parse(m.params.payload));
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.exceptionThrown') console.error('exception:', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
await send('Runtime.enable');
await send('Runtime.addBinding', { name: '__toExtension' });
await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.acquireVsCodeApi = () => ({ getState: () => JSON.parse(sessionStorage.getItem('vscodeState') || 'null'), setState: state => { window.__setStates = (window.__setStates || 0) + 1; if (!document.getElementById('loading-indicator')?.hidden) window.__early = (window.__early || 0) + 1; sessionStorage.setItem('vscodeState', JSON.stringify(state)); }, postMessage: message => { if (message.type === 'stepCache') { (window.__cache ||= []).push(message); window.postMessage({ type: 'stepCacheAck', key: message.key, render: message.render, at: message.at }, '*'); } else if (message.type === 'read') window.postMessage({ type: 'readReply', file: message.file, id: message.id, at: message.at, error: 'no extension' }, '*'); else if (message.type === 'settings') window.__toExtension(JSON.stringify(message)); else if (message.type === 'readImage') { (window.__imageReads ||= []).push(message.path); fetch(encodeURI(message.path.replace(/\\\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/'))).then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))).then(b => window.postMessage({ type: 'imageReply', id: message.id, render: message.render, bytes: new Uint8Array(b) }, '*'), e => window.postMessage({ type: 'imageReply', id: message.id, render: message.render, error: e.message }, '*')); } else if (message.type !== 'readDone') window.__posted = message; } }); window.__draws = 0; for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) { const draw = proto[name]; if (draw) proto[name] = function (...args) { window.__draws++; return draw.apply(this, args); }; } window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));" });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-fixtures-'));
const files = [...fixtures(dir), ...extraFiles.map(file => path.resolve(file))];
// CAD files (STEP, IGES) open twice: tessellated first, then from the cache the first open handed to the extension.
const CAD = /\.(ste?p|ige?s)$/i;
for (const file of [...files, ...files.filter(file => CAD.test(file))]) {
    const name = path.basename(file);
    const extra = path.dirname(file) !== dir;
    const counted = results.length;
    try {
        const reopen = pages.has(`/page/${name}`);
        pages.set(`/page/${name}`, await htmlFor(file));
        await send('Page.navigate', { url: `${origin}/page/${name}` });
        let state;
        const started = Date.now();
        while (Date.now() - started < 60000) {
            state = await evaluate(`({ loading: !document.getElementById('loading-indicator')?.hidden, error: document.getElementById('load-error')?.hidden ? '' : document.getElementById('load-error')?.textContent, info: [...(document.getElementById('info-table')?.rows ?? [])].map(row => [...row.cells].map(cell => cell.textContent).join('\\t')).join('\\n'), csp: window.__csp })`, 120000);
            if (state && !state.loading) break;
            await sleep(200);
        }
        let camera = ` shown ${Math.round((Date.now() - started) / 100) / 10}s`;
        if (CAD.test(name) && !state.loading && !state.error && !reopen) {
            // POSTed, not returned through CDP: a 150 MB cache file as a base64 string stalls the protocol.
            const posted = await evaluate(`new Promise(async resolve => {
                const done = () => window.__cache?.length > 0 && window.__cache.reduce((n, m) => n + m.chunk.byteLength, 0) === window.__cache[0].size;
                for (let i = 0; !done(); i++) {
                    if (i > 300) return resolve('cache never completed: ' + JSON.stringify((window.__cache || []).map(m => [m.at, m.size, m.chunk?.byteLength])));
                    await new Promise(r => setTimeout(r, 100));
                }
                resolve((await fetch('/cache', { method: 'POST', body: new Blob(window.__cache.map(m => m.chunk)) })).ok);
                window.__cache = [];
            })`);
            if (posted !== true) state.error = String(posted);
            const piece = 16 << 20;
            const key = pages.get(`/page/${name}`).match(/data-key="([^"]+)"/)?.[1];
            for (let at = 0; posted === true && at < postedCache.length; at += piece) {
                await panels.get(name).listener({ type: 'stepCache', key, at, size: postedCache.length, chunk: new Uint8Array(postedCache.subarray(at, at + piece)) });
            }
        }
        if (reopen) {
            state.cacheOk = /data-cached="[^"]+"/.test(pages.get(`/page/${name}`));
            camera += ` cache ${state.cacheOk}`;
        }
        if (!state.loading && !state.error && /^(cube\.stl|cloud\.ply|pole\.xyz)$/.test(name)) {
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
            // Above the center, on the pole's axis.
            const [clickX, clickY] = name === 'pole.xyz' ? [0.5, 0.3] : [0.42, 0.58];
            await evaluate(`document.querySelector('canvas').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: ${Math.round(size[0] * clickX)}, clientY: ${Math.round(size[1] * clickY)} }))`);
            await sleep(600);
            const moved = await diff(before, await shot());
            await key('f');
            const restored = await diff(before, await shot());
            await key('w', 400);
            const flown = await diff(before, await shot());
            await key('f');
            camera += ` dblclick ${(moved * 100).toFixed(1)}%, F ${(restored * 100).toFixed(1)}%, W ${(flown * 100).toFixed(1)}%`;
            state.cameraOk = moved > 0.01 && restored < 0.01 && flown > 0.01;
            if (name === 'pole.xyz') {
                // F with the grid hidden returns to the view the cloud opened with, camera above the plane.
                const grid = `document.querySelector('[data-helper="grid"]').click()`;
                await evaluate(grid);
                const hidden = await evaluate(`!document.querySelector('[data-helper="grid"]').classList.contains('active')`);
                state.cameraOk &&= hidden;
                await key('w', 400);
                await key('f');
                await evaluate(grid);
                await sleep(400);
                const hiddenF = await diff(before, await shot());
                camera += `, F without grid ${(hiddenF * 100).toFixed(1)}%`;
                state.cameraOk &&= hiddenF < 0.01;
            }
        }
        if (!state.loading && !state.error && /^(map|abs)\.(yaml|pgm)$/.test(name)) {
            const rows = String(state.info).split('\n');
            // An absolute image path is outside the webview's roots in VS Code: the page asks the extension for it.
            const asked = name === 'abs.yaml' ? JSON.stringify(await evaluate('window.__imageReads || []')) === JSON.stringify([path.join(dir, 'map.pgm')]) : true;
            if (!asked) camera += ' image not asked of the extension';
            const infoOk = asked && ['格數\t20 × 10', '尺寸\t2 × 1 m', '解析度\t0.1 m/格', '原點\t1, 2, 90°'].every(row => rows.includes(row));
            await sleep(800);
            const png = (await send('Page.captureScreenshot', { format: 'png' })).data;
            // The map's rectangle on screen is found along the middle row and column (the toolbar is off both), then
            // each quadrant is sampled at its center.
            const quadrants = await evaluate(`(async () => {
                const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,${png}'; });
                const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
                const d = g.getImageData(0, 0, c.width, c.height).data;
                const at = (x, y) => { const i = 4 * (Math.round(y) * c.width + Math.round(x)); return [d[i], d[i + 1], d[i + 2]]; };
                const background = at(c.width - 2, c.height - 2);
                const isMap = (x, y) => at(x, y).reduce((sum, v, k) => sum + Math.abs(v - background[k]), 0) > 40;
                const cx = c.width / 2, cy = c.height / 2;
                const edge = (dx, dy) => { let k = 0; while (isMap(cx + dx * (k + 1), cy + dy * (k + 1)) && k < 2000) k++; return k; };
                const [left, right, up, down] = [edge(-1, 0), edge(1, 0), edge(0, -1), edge(0, 1)];
                const sample = (fx, fy) => at(cx - left + (left + right) * fx, cy - up + (up + down) * fy);
                return { width: left + right, height: up + down, tl: sample(0.25, 0.25), tr: sample(0.75, 0.25), bl: sample(0.25, 0.75), br: sample(0.75, 0.75) };
            })()`);
            const black = rgb => rgb.every(v => v < 40);
            const white = rgb => rgb.every(v => v > 215);
            // RViz's unknown, 0x708986.
            const unknown = rgb => Math.abs(rgb[0] - 0x70) + Math.abs(rgb[1] - 0x89) + Math.abs(rgb[2] - 0x86) < 30;
            const { width, height, tl, tr, bl, br } = quadrants;
            state.mapOk = infoOk && height > 1.6 * width && black(tl) && white(tr) && white(bl) && unknown(br);
            camera += ` map ${width}x${height} tl ${tl} tr ${tr} bl ${bl} br ${br} info ${infoOk}`;
        }
        if (!state.loading && !state.error && name === 'plain.pgm') {
            state.mapOk = /地圖 YAML\t找不到/.test(state.info);
            camera += ` no yaml ${state.mapOk}`;
        }
        if (name === 'camera.pgm') {
            state.mapOk = /灰階影像/.test(state.info) && /地圖 YAML\tcamera\.yaml: not a map YAML/.test(state.info);
            camera += ` calibration yaml passed over ${state.mapOk}`;
        }
        if (!state.loading && !state.error) {
            const ui = await evaluate(`(() => {
                const visible = el => el && !el.hidden && !el.closest('[hidden]');
                document.getElementById('help-btn').click();
                const help = document.getElementById('help-panel');
                return {
                    help: help.classList.contains('open') && help.querySelectorAll('tr').length === 8 && help.innerText.includes('W A S D'),
                    display: visible(document.getElementById('display-menu-btn')),
                    modes: visible(document.querySelector('[data-mode]')),
                    sizes: visible(document.querySelector('[data-size]')),
                    up: document.getElementById('up-select').value,
                    grid: document.querySelector('[data-helper="grid"]').classList.contains('active'),
                    axes: document.querySelector('[data-helper="axes"]').classList.contains('active'),
                    bounds: visible(document.querySelector('[data-helper="bounds"]')),
                    shot: (() => {
                        const button = document.getElementById('screenshot-btn');
                        if (!visible(button)) return false;
                        window.__posted = null;
                        button.click();
                        return window.__posted?.type === 'screenshot' && window.__posted.data.length > 100;
                    })()
                };
            })()`);
            const usdKind = ui.modes ? 'mesh' : 'splat';
            const kind = [[/\.usd/, usdKind], [/gauss/, 'splat'], [/\.(pgm|yaml)$/, 'map'], [/BIG|cube|quad|square|mesh\.ply|\.gl(tf|b)$|\.dae$|\.(ste?p|ige?s)$/i, 'mesh']].find(([pattern]) => pattern.test(name))?.[1] ?? 'points';
            const expected = { mesh: [true, true, true], points: [true, false, true], splat: [true, false, false], map: [true, false, false] }[kind];
            // A map starts with its axes but not the grid, which would lie in the map's plane; everything else with the grid.
            state.uiOk = ui.help && [ui.display, ui.modes, ui.sizes].every((v, i) => v === expected[i]) && ui.up === (/\.gl(tf|b)$|\.(ste?p|ige?s)$/i.test(name) ? '+Y' : '+Z') && ui.grid === (kind !== 'map') && ((extra && kind === 'points') || ui.axes === ((kind === 'points' && !/utm/.test(name)) || kind === 'map')) && ui.bounds === (kind !== 'points') && ui.shot;
            camera += ` ui ${JSON.stringify(ui)}`;
            // The saved picture shows the model, not a blank or black frame: some pixels differ from the corner.
            if (ui.shot) {
                const drawn = await evaluate(`(async () => {
                    const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + window.__posted.data; });
                    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
                    const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0, left = c.width, right = 0;
                    for (let i = 0; i < d.length; i += 4) {
                        if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 40) n++;
                        // Height colors, not the grey grid: how wide the cloud is drawn.
                        if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 60) { const x = (i / 4) % c.width; left = Math.min(left, x); right = Math.max(right, x); }
                    }
                    return [n / (d.length / 4), Math.max(right - left, 0) / c.width];
                })()`);
                state.uiOk &&= drawn[0] > 0.001;
                // At 900 x 600 the cloud spans 55% of the width framed alone and 0% framed with the z = 0 plane 500 m
                // below; turbo's darkest end (saturation 41) is missed, but the other heights span the same width.
                if (name === 'utm.xyz') state.uiOk &&= drawn[1] > 0.4;
                camera += ` shot ${(drawn[0] * 100).toFixed(1)}% wide ${(drawn[1] * 100).toFixed(0)}%`;
                if (name === 'cloud.ply') originShot = await evaluate('window.__posted.data');
                if (name === 'cloud-utm.ply') {
                    // Grid speckle: grey pixels brighter than all four neighbours, outside the box round the coloured
                    // points and axes. float32 world coordinates at 4e6 drew the lines as such noise. The two are
                    // compared as rates.
                    const speckle = await evaluate(`(async () => {
                        const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + src; });
                        const rate = img => {
                            const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
                            const d = g.getImageData(0, 0, c.width, c.height).data, w = c.width, h = c.height, margin = Math.round(w * 0.02);
                            const colored = i => Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 60;
                            let left = w, right = 0, top = h, bottom = 0, n = 0, all = 0;
                            for (let i = 0; i < d.length; i += 4) if (colored(i)) { const x = (i / 4) % w, y = Math.floor(i / 4 / w); left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
                            for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
                                if (x >= left - margin && x <= right + margin && y >= top - margin && y <= bottom + margin) continue;
                                all++;
                                const v = i => d[i * 4 + 1], at = y * w + x;
                                if (v(at) > Math.max(v(at - 1), v(at + 1), v(at - w), v(at + w)) + 20) n++;
                            }
                            return n / all;
                        };
                        const [x, y] = await Promise.all([load('${originShot}'), load(window.__posted.data)]);
                        return [rate(x), rate(y)];
                    })()`);
                    state.uiOk &&= speckle[1] <= speckle[0] * 2 + 0.0005;
                    camera += ` grid speckle ${(speckle[1] * 100).toFixed(3)}% vs origin ${(speckle[0] * 100).toFixed(3)}%`;
                    // Its 3000 points cover as much of the frame as cloud.ply's (whose axes add a little). Stored as
                    // float32 at 4e6 they snapped to a 0.03 x 0.25 m lattice and drew as about 100 dots.
                    const [origin, utm] = [(await coloredPoints(originShot))[0], (await coloredPoints(await evaluate('window.__posted.data')))[0]];
                    const offsetShown = /X 500,000\s+Y 4,000,000/.test(state.info);
                    state.uiOk &&= utm >= origin * 0.7 && offsetShown;
                    camera += ` points cover ${(utm * 100).toFixed(2)}% vs origin ${(origin * 100).toFixed(2)}%, offset row ${offsetShown}`;
                }
            }
            if (name === 'utm-loader.pcd') {
                // PCDLoader's bounding sphere at the file's coordinates, kept after recentering, culled the cloud.
                const [cover] = await coloredPoints(await evaluate('window.__posted.data'));
                const offsetShown = /X 500,000\s+Y 4,000,000/.test(state.info);
                state.uiOk &&= cover > 0.002 && offsetShown;
                camera += ` points cover ${(cover * 100).toFixed(2)}%, offset row ${offsetShown}`;
            }
            if (/^cloud(-utm)?\.ply$/.test(name)) {
                // Orbiting in 1-pixel drags about the cloud's center barely moves its coloured points' centroid:
                // 0.1-0.6 px per step at the origin and, recentered, at UTM; 5-18 px when cloud-utm.ply was drawn
                // from float32 world coordinates.
                const [w, h] = await evaluate('[innerWidth, innerHeight]');
                const centroid = async () => (await coloredPoints((await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 0.5 } })).data)).slice(1);
                const mouse = (type, dx) => send('Input.dispatchMouseEvent', { type, x: Math.round(w * 0.5) + dx, y: Math.round(h * 0.7), button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
                await mouse('mousePressed', 0);
                const at = [await centroid()];
                for (let dx = 1; dx <= 12; dx++) {
                    await mouse('mouseMoved', dx);
                    await sleep(150);
                    at.push(await centroid());
                }
                await mouse('mouseReleased', 12);
                const steps = at.slice(1).map((c, i) => Math.hypot(c[0] - at[i][0], c[1] - at[i][1]));
                state.uiOk &&= Math.max(...steps) < 2;
                camera += ` orbit steps ${steps.map(v => v.toFixed(1)).join(' ')} px`;
            }
            if (name === 'utm.xyz') {
                // Axes left off for a far origin are still saved as on, so the next cloud opens with them.
                const saved = await evaluate(`(() => { const grid = document.querySelector('[data-helper="grid"]'); grid.click(); grid.click(); return JSON.stringify(window.__posted); })()`);
                state.uiOk &&= saved === '{"type":"helpers","helpers":{"cloud":["grid","axes"]}}';
                camera += ` saved ${saved}`;
            }
            if (name === 'scene.usda') {
                const size = await evaluate('[innerWidth, innerHeight]');
                const shot = async () => (await send('Page.captureScreenshot', { format: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: size[0], height: size[1], scale: 0.25 } })).data;
                const tree = await evaluate(`(() => {
                    if (document.getElementById('stage-panel').hidden) return 'closed';
                    const rows = [...document.querySelectorAll('#stage-panel .prim-row')];
                    return rows.map(row => row.querySelector('.prim-name span').textContent + ':' + row.querySelector('.prim-type').textContent + ':' + row.querySelector('.prim-eye').getAttribute('aria-pressed')).join(',');
                })()`);
                const shotChange = (a, b) => evaluate(`(async () => {
                    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/jpeg;base64,' + src; });
                    const [x, y] = await Promise.all([load('${a}'), load('${b}')]);
                    const px = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
                    const p = px(x), q = px(y); let n = 0;
                    for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 40) n++;
                    return n / (p.length / 4);
                })()`);
                // Picking: a Stage row selects and boxes its prim, Escape clears, a click on the view selects what it hits
                // and a click on nothing clears.
                const selectedName = () => evaluate(`document.querySelector('#stage-panel .prim-row.selected .prim-name span')?.textContent ?? ''`);
                // An idle view draws nothing, and headless Chrome may then capture a blank canvas: wake it first.
                await evaluate(`window.dispatchEvent(new Event('input'))`);
                await sleep(300);
                const unpicked = await shot();
                await evaluate(`[...document.querySelectorAll('#stage-panel .prim-row')].find(row => row.querySelector('.prim-name span').textContent === 'Tri').querySelector('.prim-name span').click()`);
                await sleep(600);
                const boxed = await shotChange(unpicked, await shot());
                const byRow = `${await selectedName()} ${await evaluate(`document.getElementById('prim-path').textContent`)}`;
                await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
                const cleared = await evaluate(`!document.querySelector('#stage-panel .prim-row.selected') && document.getElementById('prim-path').hidden`);
                const click = async (x, y) => {
                    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
                    await sleep(50);
                };
                // The whole grid is clicked: Tri must be hit somewhere, the Gaussian field never (splats are not picked).
                const clicked = new Set();
                let onTri = null;
                for (let y = 0.15; y < 0.95; y += 0.1) {
                    for (let x = 0.05; x < 0.6; x += 0.1) {
                        const at = [Math.round(x * size[0]), Math.round(y * size[1])];
                        await click(...at);
                        const picked = await selectedName();
                        clicked.add(picked);
                        if (picked === 'Tri') onTri ??= at;
                    }
                }
                const byClick = [...clicked].filter(Boolean).sort().join('+');
                await click(Math.round(size[0] * 0.02), Math.round(size[1] * 0.97));
                const emptyClears = await selectedName() === '';
                // Resting the pointer names the part under it; moving off the model clears the name.
                const hoverAt = async (x, y) => {
                    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
                    await sleep(400);
                    return evaluate(`document.getElementById('hover-label').hidden ? '' : document.getElementById('hover-label').textContent`);
                };
                const hoverName = await hoverAt(...onTri);
                const hoverOff = await hoverAt(Math.round(size[0] * 0.02), Math.round(size[1] * 0.97));
                // With picking turned off neither a rest nor a click picks; turned on again, a click does.
                await click(...onTri);
                await evaluate(`document.getElementById('pick-btn').click()`);
                await click(Math.round(size[0] * 0.02), Math.round(size[1] * 0.97));
                const offClears = await selectedName() === '';
                const offPressed = await evaluate(`document.getElementById('pick-btn').getAttribute('aria-pressed')`);
                const offHover = await hoverAt(...onTri);
                await click(...onTri);
                const offClick = await selectedName();
                await evaluate(`document.getElementById('pick-btn').click()`);
                await click(...onTri);
                const backOn = await selectedName();
                // A click with the Stage panel closed leaves it closed; opening it then shows the picked prim's row.
                await click(Math.round(size[0] * 0.02), Math.round(size[1] * 0.97));
                await evaluate(`document.getElementById('stage-btn').click()`);
                await click(...onTri);
                const staysClosed = await evaluate(`document.getElementById('stage-panel').hidden`);
                await evaluate(`document.getElementById('stage-btn').click()`);
                await sleep(100);
                const reopened = await evaluate(`(() => {
                    const row = document.querySelector('#stage-panel .prim-row.selected'), list = document.getElementById('stage-rows').getBoundingClientRect(), r = row?.getBoundingClientRect();
                    return { name: row?.querySelector('.prim-name span').textContent ?? '', shown: !!r && r.height > 0 && r.top >= list.top - 1 && r.bottom <= list.bottom + 1 };
                })()`);
                await click(Math.round(size[0] * 0.02), Math.round(size[1] * 0.97));
                // Hiding the selected part hides its box: the view then matches the same part hidden and unselected.
                const viewShot = async () => (await send('Page.captureScreenshot', { format: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: Math.round(size[0] * 0.55), height: size[1], scale: 0.25 } })).data;
                const triRow = `[...document.querySelectorAll('#stage-panel .prim-row')].find(row => row.querySelector('.prim-name span').textContent === 'Tri')`;
                await evaluate(`${triRow}.querySelector('.prim-name span').click(); ${triRow}.querySelector('.prim-eye').click()`);
                await sleep(400);
                const hiddenSelected = await viewShot();
                await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
                await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
                await sleep(400);
                const hiddenBox = await shotChange(hiddenSelected, await viewShot());
                await evaluate(`${triRow}.querySelector('.prim-eye').click()`);
                await sleep(300);
                const toggleOk = hiddenBox < 0.001 && offClears && offPressed === 'false' && offHover === '' && offClick === '' && backOn === 'Tri' && staysClosed && reopened.name === 'Tri' && reopened.shown;
                const pickOk = byRow === 'Tri World/TriMesh' && boxed > 0.0005 && cleared && byClick === 'Tri' && emptyClears && hoverName === 'World › Tri' && hoverOff === '' && toggleOk;
                camera += ` pick row "${byRow}" box ${(boxed * 100).toFixed(2)}% esc ${cleared} click ${byClick} empty ${emptyClears} hover "${hoverName}" off "${hoverOff}" toggle ${toggleOk} closed-pick ${staysClosed} reopened ${JSON.stringify(reopened)} hidden-box ${(hiddenBox * 100).toFixed(2)}%`;
                // Hiding a prim leaves the grid, axes and F framing as they were; only a file's eye refits them.
                const frameKey = async () => {
                    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', text: 'f' });
                    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF' });
                    await sleep(600);
                };
                await frameKey();
                await evaluate(`${triRow}.querySelector('.prim-eye').click()`);
                await sleep(400);
                const primHidden = await shot();
                await frameKey();
                const reframed = await shotChange(primHidden, await shot());
                await evaluate(`${triRow}.querySelector('.prim-eye').click()`);
                await sleep(300);
                camera += ` F after hiding a prim ${(reframed * 100).toFixed(2)}%`;
                const before = await shot();
                await evaluate(`['Tri', 'Gaussians'].forEach(name => [...document.querySelectorAll('#stage-panel .prim-row')].find(row => row.querySelector('.prim-name span').textContent === name).querySelector('.prim-eye').click())`);
                await sleep(600);
                const after = await shot();
                const changed = await evaluate(`(async () => {
                    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/jpeg;base64,' + src; });
                    const [x, y] = await Promise.all([load('${before}'), load('${after}')]);
                    const px = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
                    const p = px(x), q = px(y); let n = 0;
                    for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 40) n++;
                    return n / (p.length / 4);
                })()`);
                const parentOff = await evaluate(`(() => {
                    document.querySelector('#stage-panel .prim-row .prim-eye').click();
                    const allOff = [...document.querySelectorAll('#stage-panel .prim-eye')].every(eye => eye.querySelector('line'));
                    document.querySelector('#stage-panel .prim-toggle').click();
                    return allOff && document.querySelectorAll('#stage-panel .prim-row').length === 1;
                })()`);
                // The column's eye shows every top row when all are hidden, then hides them all.
                const allEye = await evaluate(`(() => {
                    const head = () => document.querySelector('#stage-panel .stage-head .prim-eye');
                    const top = () => document.querySelector('#stage-panel .prim-row .prim-eye').getAttribute('aria-pressed');
                    head().click(); const shown = !head().querySelector('line') && top() === 'true';
                    head().click(); const hidden = !!head().querySelector('line') && top() === 'false';
                    head().click();
                    return shown && hidden;
                })()`);
                state.treeOk = tree === 'World:Xform:true,Tri:Mesh:true,Hidden:Mesh:false,Gaussians:ParticleField3DGaussianSplat:true' && changed > 0.05 && parentOff && allEye && pickOk && reframed < 0.002;
                camera += ` tree ${tree} hide ${(changed * 100).toFixed(1)}% parentOff ${parentOff} allEye ${allEye}`;
            }
            if (/^(cube\.stl|cloud\.ply|pole\.xyz|table\.xyz)$/.test(name)) {
                // Past the settle after the last input, the view draws nothing; a click on the grid draws it.
                await sleep(2000);
                const idle = await evaluate('new Promise(resolve => { const before = window.__draws; setTimeout(() => resolve(window.__draws - before), 1000); })');
                const before = await pageShot();
                const toggled = {};
                for (const helper of /^(pole|table)\.xyz$/.test(name) ? ['grid'] : name === 'cloud.ply' ? ['grid', 'axes'] : ['grid', 'axes', 'bounds']) {
                    await evaluate(`document.querySelector('[data-helper="${helper}"]').click()`);
                    await sleep(400);
                    toggled[helper] = await shotDiff(before, await pageShot());
                    await evaluate(`document.querySelector('[data-helper="${helper}"]').click()`);
                    await sleep(400);
                }
                const restored = await shotDiff(before, await pageShot());
                // cube.stl's faces lie on the axis planes and cover its axes and grid, so only its bounds must show.
                const shown = name === 'cube.stl' ? [toggled.bounds] : Object.values(toggled);
                state.helpersOk = idle === 0 && shown.every(share => share > 0.002) && restored < 0.002;
                camera += ` idle draws ${idle} helpers ${Object.entries(toggled).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(', ')} off ${(restored * 100).toFixed(1)}%`;
            }
            if (name === 'fields.ply') {
                const legend = await evaluate(`(() => {
                    const button = document.querySelector('[data-color="field:confidence"]');
                    if (!button || button.hidden) return 'no confidence button';
                    button.click();
                    const shown = !document.getElementById('color-legend').hidden;
                    const text = document.getElementById('color-legend').innerText.replace(/\\s+/g, ' ').trim();
                    document.querySelector('[data-color="rgb"]').click();
                    return shown && document.getElementById('color-legend').hidden ? text : 'legend did not follow the mode: ' + text;
                })()`);
                state.fieldsOk = /^confidence 0\.0\d+ 0\.9\d+$/.test(legend);
                camera += ` legend "${legend}"`;
            }
            if (/\.bin$/.test(name)) {
                const scan = await evaluate(`(() => {
                    const active = document.querySelector('[data-color].active')?.dataset.color;
                    const legend = document.getElementById('color-legend');
                    return { active, legend: legend.hidden ? '' : legend.innerText.replace(/\\s+/g, ' ').trim(), fields: [...document.querySelectorAll('#color-fields [data-color]')].map(b => b.dataset.color).join(',') };
                })()`);
                const [count, layout, fields] = name === 'scan.bin' ? ['3,000', 'KITTI x y z intensity', 'field:intensity'] : ['2,000', 'nuScenes x y z intensity ring', 'field:intensity,field:ring'];
                state.scanOk = state.info.includes(`點數\t${count}`) && state.info.includes(`欄位配置\t${layout}`) && scan.fields === fields
                    && scan.active === 'field:intensity' && /^強度 0\.0\d+ 0\.9\d+$/.test(scan.legend);
                camera += ` scan ${JSON.stringify(scan)}`;
            }
            if (name === 'utm.las') {
                const las = await evaluate(`(() => ({
                    active: document.querySelector('[data-color].active')?.dataset.color,
                    fields: [...document.querySelectorAll('#color-fields [data-color]')].map(b => b.dataset.color).join(',')
                }))()`);
                state.scanOk = ['點數\t3,000', '格式\tLAS 1.4', '點格式\t7'].every(row => state.info.includes(row)) && /已扣除的偏移\tX 500,100\s+Y 4,000,200/.test(state.info)
                    && las.active === 'rgb' && las.fields.split(',').includes('field:classification');
                camera += ` las ${JSON.stringify(las)}`;
            }
            if (/^(rgb\.xyz|utm\.las)$/.test(name)) {
                const png = (await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 400, height: 400, scale: 0.25 } })).data;
                state.redOk = await evaluate(`(async () => {
                    const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,${png}'; });
                    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
                    const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
                    for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] < 80 && d[i + 2] < 80) n++;
                    return n > 20;
                })()`);
                camera += ` red ${state.redOk}`;
            }
        }
        if (process.env.PERF && !state.loading && !state.error) {
            await evaluate('gc()');
            const perf = await evaluate(`new Promise(resolve => {
                const gl = document.querySelector('canvas').getContext('webgl2');
                const gpu = gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
                let frames = 0;
                const start = performance.now();
                const tick = () => {
                    frames++;
                    if (performance.now() - start < 3000) return requestAnimationFrame(tick);
                    resolve({ fps: Math.round(frames * 1000 / (performance.now() - start)), heapMB: Math.round(performance.memory.usedJSHeapSize / 1e6), gpu });
                };
                requestAnimationFrame(tick);
            })`);
            camera += ` perf ${JSON.stringify(perf)}`;
        }
        // A .bin of the wrong size shows why instead of a cloud.
        if (name === 'short.bin') {
            const refused = /1599 bytes.*KITTI.*16 bytes/.test(state.error) && !state.info.includes('點數');
            state.error = refused ? '' : `not refused: ${state.error}`;
            camera += ` refused ${refused}`;
        }
        const ok = !state.loading && !state.error && state.csp.length === 0 && state.cameraOk !== false && state.uiOk !== false && state.redOk !== false && state.treeOk !== false && state.cacheOk !== false && state.helpersOk !== false && state.fieldsOk !== false && state.scanOk !== false && state.mapOk !== false;
        results.push(ok);
        console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${Math.round((Date.now() - started) / 100) / 10}s ${state.error || ''} ${state.csp.join(', ')}${camera}\n  ${String(state.info).replace(/\n/g, ' | ')}`);
        if (shots) {
            await sleep(1500);
            fs.mkdirSync(shots, { recursive: true });
            fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        }
    } catch (error) {
        results.splice(counted, 1, false);
        console.log(`FAIL ${name} ${error.message}`);
    }
}

// Several files in one view: a red map, then a blue scan from another folder, added through the protocol. The
// extension re-renders the page with both, as VS Code would; the toolbar, Stage and legend are left out of
// the pictures compared.
{
    const started = Date.now();
    const disk = (cx, z, rgb) => Array.from({ length: 3000 }, (_, i) => { const r = Math.sqrt(i / 3000), a = i * 2.399; return `${cx + r * Math.cos(a)} ${r * Math.sin(a)} ${z} ${rgb}`; }).join('\n');
    const map = path.join(dir, 'map.xyz');
    const scanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-scan-'));
    const scan = path.join(scanDir, 'scan.xyz');
    fs.writeFileSync(map, disk(0, 0, '255 0 0'));
    fs.writeFileSync(scan, disk(2.5, 2, '0 0 255'));
    await htmlFor(map);
    const panel = panels.get('map.xyz');
    const showPage = async () => {
        pages.set('/page/pair', panel.webview.html.replaceAll('vscode-webview:', "'self'"));
        await send('Page.navigate', { url: `${origin}/page/pair` });
        for (let i = 0; i < 300 && await evaluate("!document.getElementById('loading-indicator') || !document.getElementById('loading-indicator').hidden"); i++) await sleep(200);
        await evaluate("document.querySelectorAll('#top-control-bar, #stage-bar, #stage-panel, #color-legend').forEach(e => { e.style.visibility = 'hidden'; })");
        await sleep(800);
    };
    const eye = row => evaluate(`document.querySelectorAll('#stage-panel .prim-row')[${row}].querySelector('.prim-eye').click()`);
    const colored = png => evaluate(`(async () => {
        const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,${png}'; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data; let red = 0, blue = 0, orange = 0, steel = 0, green = 0;
        for (let i = 0; i < d.length; i += 4) {
            if (d[i] > 150 && d[i + 1] < 80 && d[i + 2] < 80) red++;
            if (d[i + 2] > 150 && d[i] < 80 && d[i + 1] < 80) blue++;
            if (d[i] > 200 && d[i + 1] > 110 && d[i + 1] < 175 && d[i + 2] < 90) orange++;
            // Solid's second and third colors, #4e79a7 and #59a14f.
            if (d[i + 2] > 145 && d[i] < 110 && d[i + 1] > 100 && d[i + 1] < 145) steel++;
            if (d[i + 1] > 140 && d[i] < 120 && d[i + 2] < 110 && d[i + 1] - d[i] > 40) green++;
        }
        return { red, blue, orange, steel, green };
    })()`);
    await showPage();
    // What the Display menu set survives the re-render for an added file: grid off, large points.
    await evaluate(`document.querySelector('[data-helper="grid"]').click(); document.querySelector('[data-size="4"]').click()`);
    await sleep(600);
    const alone = await pageShot();
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(scan).href] });
    await showPage();
    const display = await evaluate("[...document.querySelectorAll('[data-helper].active, [data-size].active')].map(b => b.dataset.helper ?? 'size ' + b.dataset.size).join(',')");
    const rows = await evaluate("[...document.querySelectorAll('#stage-panel .prim-row .prim-name span')].map(span => span.textContent).join(',')");
    const both = await pageShot();
    await eye(1);
    await sleep(600);
    const hidden = await pageShot();
    await eye(1);
    await sleep(600);
    const shownAgain = await pageShot();
    const [hide, show, kept] = [await shotDiff(both, hidden), await shotDiff(both, shownAgain), await shotDiff(alone, hidden)];
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', text: 'f' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF' });
    await sleep(800);
    const framed = await colored((await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 900, height: 600, scale: 0.5 } })).data);
    // A recolor from the Display menu updates a row's color menu in place, so one left open stays open.
    await evaluate(`window.__select = document.querySelector('#stage-panel select')`);
    const legend = await evaluate(`(() => {
        document.querySelector('[data-color="height"]').click();
        return [document.getElementById('legend-low').textContent, document.getElementById('legend-high').textContent].map(Number);
    })()`);
    const select = await evaluate(`window.__select?.isConnected && window.__select.value`);
    const ok = rows === 'map.xyz,scan.xyz' && select === 'height' && display === 'size 4,axes' && hide > 0.002 && show < 0.002 && kept < 0.002 && framed.red > 50 && framed.blue > 50 && legend[0] < 0.1 && legend[1] > 1.9;
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'} map.xyz + scan.xyz ${Math.round((Date.now() - started) / 100) / 10}s rows ${rows} hide ${(hide * 100).toFixed(1)}% show ${(show * 100).toFixed(1)}% display kept on add "${display}" camera kept on add ${(kept * 100).toFixed(1)}% F red ${framed.red} blue ${framed.blue} legend ${legend.join('..')} row menu kept ${select}`);
    // A third file, then all three Solid: a file keeps its color when one before it is removed.
    const removedAt = Date.now();
    const third = path.join(scanDir, 'third.xyz');
    fs.writeFileSync(third, disk(-2.5, -2, '255 255 0'));
    const idOf = i => JSON.parse(panel.webview.html.match(/data-files="([^"]*)"/)[1].replace(/&quot;/g, '"'))[i].id;
    const frameAll = async () => {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', text: 'f' });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF' });
        await sleep(800);
    };
    const picture = async () => colored((await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 900, height: 600, scale: 0.5 } })).data);
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(third).href] });
    await showPage();
    await evaluate(`document.querySelector('[data-color="solid"]').click()`);
    await sleep(600);
    await panel.listener({ type: 'removeFile', file: idOf(1) });
    await showPage();
    await frameAll();
    const solids = await picture();
    // Hiding the map and removing the third leaves one hidden file: the map shows again, not in Solid, which is not
    // offered for one file and could not be turned off, but in the colouring last chosen from the Display menu
    // (Height, clicked for the legend above), which the extension keeps.
    await eye(0);
    await sleep(600);
    await panel.listener({ type: 'removeFile', file: idOf(1) });
    await showPage();
    const after = await evaluate("({ loading: !document.getElementById('loading-indicator').hidden, error: document.getElementById('load-error').hidden ? '' : document.getElementById('load-error').textContent, color: [...document.querySelectorAll('[data-color].active')].map(b => b.dataset.color).join() })");
    const alone2 = await picture();
    // A few steel pixels are antialiased edges, not a cloud.
    const okSolid = solids.orange > 50 && solids.green > 50 && solids.steel < solids.green / 20;
    const okRemoved = !after.loading && !after.error && after.color === 'height' && alone2.orange < 20;
    results.push(okSolid, okRemoved);
    console.log(`${okSolid ? 'PASS' : 'FAIL'} map.xyz + third.xyz, Solid, after scan.xyz removed: orange ${solids.orange} green ${solids.green} steel ${solids.steel}`);
    // The up axis chosen in a view of one file holds when a file is added (it is kept by the extension).
    await evaluate(`document.querySelector('[data-up="-Z"]').click()`);
    await sleep(300);
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(third).href] });
    await showPage();
    const upKept = await evaluate(`document.getElementById('up-select').value`);
    results.push(upKept === '-Z');
    console.log(`${upKept === '-Z' ? 'PASS' : 'FAIL'} map.xyz up -Z, then third.xyz added: up ${upKept}`);
    // The view is saved once the camera stops, not on every frame it moves.
    await evaluate('window.__setStates = 0');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', text: 'w' });
    await sleep(500);
    const whileMoving = await evaluate('window.__setStates');
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW' });
    await sleep(800);
    const settled = await evaluate('window.__setStates');
    const savesOk = whileMoving <= 1 && settled >= 1;
    results.push(savesOk);
    console.log(`${savesOk ? 'PASS' : 'FAIL'} view saved while flying ${whileMoving} times, after stopping ${settled}`);
    console.log(`${okRemoved ? 'PASS' : 'FAIL'} map.xyz, hidden, after third.xyz removed ${Math.round((Date.now() - removedAt) / 100) / 10}s loading ${after.loading} error "${after.error}" color ${after.color} red ${alone2.red} orange ${alone2.orange} blue ${alone2.blue}`);
    fs.rmSync(scanDir, { recursive: true, force: true });
}

// Distance colors (#18) and panes (#19). The scan is the map's disk 2 cm up, with the quarter past x = 0.4
// lifted 1 m (mean 0.27, 75% within 5 cm):
// colored by its distance to the map (or to a plane mesh under it), the near part takes the low end and the lifted
// part the top; the first tolerance (3 medians, 0.06 rounded to 0.05) hides the near part.
{
    const started = Date.now();
    const compareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-compare-'));
    const at = name => path.join(compareDir, name);
    const disk = (lift, rgb) => Array.from({ length: 3000 }, (_, i) => { const r = Math.sqrt(i / 3000), a = i * 2.399, x = r * Math.cos(a); return `${x} ${r * Math.sin(a)} ${lift(x)} ${rgb}`; }).join('\n');
    fs.writeFileSync(at('map.xyz'), disk(() => 0, '255 0 0'));
    fs.writeFileSync(at('scan.xyz'), disk(x => (x > 0.4 ? 1.02 : 0.02), '0 0 255'));
    fs.writeFileSync(at('plane.off'), 'OFF\n4 2 0\n-1 -1 0\n1 -1 0\n1 1 0\n-1 1 0\n3 0 1 2\n3 0 2 3\n');
    await htmlFor(at('map.xyz'));
    const panel = panels.get('map.xyz');
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(at('scan.xyz')).href, pathToFileURL(at('plane.off')).href] });
    const idOf = i => JSON.parse(panel.webview.html.match(/data-files="([^"]*)"/)[1].replace(/&quot;/g, '"'))[i].id;
    const show = async key => {
        pages.set(`/page/${key}`, panel.webview.html.replaceAll('vscode-webview:', "'self'"));
        await evaluate('sessionStorage.clear()');
        await send('Page.navigate', { url: `${origin}/page/${key}` });
        for (let i = 0; i < 300 && await evaluate("!document.getElementById('loading-indicator') || !document.getElementById('loading-indicator').hidden"); i++) await sleep(100);
    };
    const settle = async () => {
        for (let i = 0; i < 300 && await evaluate("!document.getElementById('loading-indicator').hidden"); i++) await sleep(100);
        await sleep(600);
    };
    const choose = (row, value) => evaluate(`(() => { const menu = document.querySelectorAll('#stage-panel .prim-row')[${row}].querySelector('select'); menu.value = ${JSON.stringify(value)}; menu.dispatchEvent(new Event('change')); return menu.value; })()`);
    const info = () => evaluate("document.getElementById('info-table').innerText");
    const nonBackground = png => evaluate(`(async () => {
        const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,${png}'; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0, warm = 0, cold = 0;
        // The view's dark background is #505050; points are anything off grey.
        for (let i = 0; i < d.length; i += 4) {
            const spread = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
            if (spread < 30) continue;
            n++;
            // Turbo's low end near 0 is a dark violet (54 35 86 at 2% of the scale), its top a dark red (144 13 0).
            if (d[i] > d[i + 2] + 40) warm++;
            if (d[i + 2] > d[i] + 25) cold++;
        }
        return { n, warm, cold };
    })()`);
    const shot = async () => nonBackground((await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 900, height: 600, scale: 0.5 } })).data);
    await show('compare');
    await evaluate("document.querySelectorAll('#top-control-bar, #stage-bar, #stage-panel, #color-legend').forEach(e => { e.style.visibility = 'hidden'; })");
    // Only the scan shown, so the picture is its colors alone.
    await evaluate(`[0, 2].forEach(row => document.querySelectorAll('#stage-panel .prim-row')[row].querySelector('.prim-eye').click())`);
    // The first distance through the toolbar's Compare menu, which offers the file added last against the opened one.
    const menu = await evaluate(`(() => {
        document.getElementById('compare-btn').click();
        const shown = document.getElementById('compare-menu').classList.contains('open') && !document.getElementById('compare-distance').hidden;
        const picked = [document.getElementById('compare-file').selectedOptions[0]?.textContent, document.getElementById('compare-reference').selectedOptions[0]?.textContent].join('>');
        document.getElementById('compare-file').value = ${JSON.stringify(idOf(1))};
        document.getElementById('compare-file').dispatchEvent(new Event('change'));
        document.getElementById('compare-reference').value = ${JSON.stringify(idOf(0))};
        document.getElementById('compare-run').click();
        return shown && picked;
    })()`);
    await settle();
    const chosen = await evaluate(`document.querySelectorAll('#stage-panel .prim-row')[1].querySelector('select').value`);
    // Chosen from a row, the reference turns grey, so its colors are not read as distances.
    const referenceGrey = await evaluate(`document.querySelectorAll('#stage-panel .prim-row')[0].querySelector('select').value`);
    const legend = await evaluate("[document.getElementById('legend-name').textContent, document.getElementById('legend-low').textContent, document.getElementById('legend-top').value, document.getElementById('tolerance-input').value].join('|')");
    const colored = await shot();
    const toMap = await info();
    await evaluate("document.getElementById('hide-within-btn').click()");
    await sleep(600);
    const hidden = await shot();
    await evaluate("document.getElementById('hide-within-btn').click()");
    // The plane as the reference: the same split, measured to its triangles.
    await choose(1, `distance:${idOf(2)}`);
    await settle();
    const toPlane = await info();
    // The plane colored by its distance to the scan (its four corners), then back to its own grey.
    await evaluate(`document.querySelectorAll('#stage-panel .prim-row')[2].querySelector('.prim-eye').click()`);
    await choose(2, `distance:${idOf(1)}`);
    await settle();
    const planeInfo = await info();
    const planeBack = await choose(2, 'rgb');
    await sleep(300);
    const error = await evaluate("document.getElementById('load-error').hidden ? '' : document.getElementById('load-error').textContent");
    // The harness's VS Code speaks zh-TW; English is matched too.
    const distanceTo = name => `(?:Distance to ${name.replace('.', '\\.')}|到 ${name.replace('.', '\\.')} 的距離)`;
    // A closed Info panel's innerText runs its cells together.
    const mean = (text, reference) => Number(text.match(new RegExp(`${distanceTo(reference)}\\s*(?:mean|平均) ([\\d.]+)`))?.[1]);
    const within = text => Number(text.match(/(?:Within|容差) 0\.05(?: 內)?\s*([\d.]+)%/)?.[1]);
    const planeMeasured = new RegExp(`plane\\.off[\\s\\S]*${distanceTo('scan.xyz')}`).test(planeInfo);
    const ok = chosen === `distance:${idOf(0)}` && new RegExp(`^${distanceTo('map.xyz')}\\|0\\.0\\|1\\.02\\|0\\.05$`).test(legend) && colored.warm > 50 && colored.cold > 50
        && hidden.n < colored.n * 0.6 && hidden.warm > 50 && Math.abs(mean(toMap, 'map.xyz') - 0.27) < 0.02 && Math.abs(within(toMap) - 75) < 3
        && Math.abs(mean(toPlane, 'plane.off') - 0.27) < 0.02 && planeMeasured && planeBack === 'rgb' && referenceGrey === 'grey' && menu === 'plane.off>map.xyz' && !error;
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'} scan.xyz by distance to map.xyz and plane.off ${Math.round((Date.now() - started) / 100) / 10}s legend ${legend} warm ${colored.warm} cold ${colored.cold} shown ${colored.n} hidden within ${hidden.n} mean ${mean(toMap, 'map.xyz')} / ${mean(toPlane, 'plane.off')} within ${within(toMap)}% plane measured ${planeMeasured} map ${referenceGrey} compare menu ${menu} ${error}`);
    console.log(`  ${toMap.replace(/\n/g, ' | ')}`);

    // Panes (#19): turned on, a pane for each of the three files: the map (red), the scan (blue, its own colors
    // again) and the plane (hidden, so its pane is empty). Then the scan goes into the map's pane too.
    const splitAt = Date.now();
    await choose(1, 'rgb');
    await choose(0, 'rgb');
    await evaluate(`[0].forEach(row => document.querySelectorAll('#stage-panel .prim-row')[row].querySelector('.prim-eye').click()); document.querySelectorAll('#stage-panel .prim-row')[2].querySelector('.prim-eye').click()`);
    await evaluate("document.getElementById('panes-btn').click()");
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', text: 'f' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF' });
    await sleep(800);
    const part = async (x, width) => nonBackground((await send('Page.captureScreenshot', { format: 'png', clip: { x, y: 0, width, height: 600, scale: 0.5 } })).data);
    const thirds = async () => [await part(0, 300), await part(300, 300), await part(600, 300)];
    const [first, second, third] = await thirds();
    const paneLabels = () => evaluate("[...document.querySelectorAll('.pane-label')].map(label => label.textContent).join('|')");
    const labels = await paneLabels();
    const buttons = await evaluate("[...document.querySelectorAll('#stage-panel .prim-row')].map(row => row.querySelectorAll('.prim-pane').length).join()");
    await evaluate(`document.querySelectorAll('#stage-panel .prim-row')[1].querySelectorAll('.prim-pane')[0].click()`);
    await sleep(600);
    const [shared] = await thirds();
    const sharedLabels = await paneLabels();
    // A drag in the middle pane turns the first too: one camera.
    const before = await pageShot();
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 450, y: 300, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 510, y: 320, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 510, y: 320, button: 'left', clickCount: 1 });
    await sleep(600);
    const [firstAfter] = await thirds();
    const moved = await shotDiff(before, await pageShot());
    // The saved PNG with and without the labels and lines: their pixels must change.
    const savedOverlay = await evaluate(`(async () => {
        const save = async () => {
            window.__posted = null;
            document.getElementById('screenshot-btn').click();
            const image = new Image();
            image.src = 'data:image/png;base64,' + window.__posted.data;
            await image.decode();
            const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height });
            canvas.getContext('2d').drawImage(image, 0, 0);
            return canvas.getContext('2d').getImageData(0, 0, image.width, image.height);
        };
        const changed = (a, b, rect) => {
            const origin = document.querySelector('canvas').getBoundingClientRect();
            const x0 = Math.round((rect.left - origin.left) * 2), y0 = Math.round((rect.top - origin.top) * 2);
            const x1 = Math.round((rect.right - origin.left) * 2), y1 = Math.round((rect.bottom - origin.top) * 2);
            let n = 0, all = 0;
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, all++) {
                const i = (y * a.width + x) * 4;
                if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 6) n++;
            }
            return all ? n / all : 0;
        };
        const label = document.querySelector('.pane-label:not([hidden])'), line = document.querySelector('.pane-line');
        const labelRect = label.getBoundingClientRect(), lineRect = line.getBoundingClientRect();
        const withOverlay = await save();
        const lines = [...document.getElementById('pane-lines').children];
        const labels = [...document.querySelectorAll('.pane-label')].filter(element => !element.hidden);
        labels.forEach(element => { element.hidden = true; });
        document.getElementById('pane-lines').replaceChildren();
        const without = await save();
        labels.forEach(element => { element.hidden = false; });
        document.getElementById('pane-lines').replaceChildren(...lines);
        return { label: changed(withOverlay, without, labelRect), line: changed(withOverlay, without, lineRect) };
    })()`);
    // The axes (red x, blue z) show in every pane, so a few pixels of the other color are theirs.
    const okSplit = first.warm > 50 && first.cold < first.warm / 10 && second.cold > 50 && second.warm < second.cold / 10 && third.warm < 200 && third.cold < 200
        && labels === 'map.xyz|scan.xyz|' && buttons === '3,3,3' && shared.cold > 50 && sharedLabels === 'map.xyz · scan.xyz|scan.xyz|'
        && moved > 0.002 && JSON.stringify(firstAfter) !== JSON.stringify(shared) && savedOverlay.label > 0.3 && savedOverlay.line > 0.3;
    results.push(okSplit);
    console.log(`${okSplit ? 'PASS' : 'FAIL'} map.xyz | scan.xyz | plane.off in panes ${Math.round((Date.now() - splitAt) / 100) / 10}s first red ${first.warm} blue ${first.cold}, second red ${second.warm} blue ${second.cold}, third red ${third.warm} blue ${third.cold}, labels ${labels}, pane buttons ${buttons}, scan in the first too: blue ${shared.cold} labels ${sharedLabels}, drag moved ${(moved * 100).toFixed(1)}%, saved PNG label ${Math.round(savedOverlay.label * 100)}% line ${Math.round(savedOverlay.line * 100)}%`);

    // The scan written again keeps its distance colors and the tolerance (#18), measured again.
    const changedAt = Date.now();
    await choose(1, `distance:${idOf(0)}`);
    await settle();
    await evaluate("(() => { const input = document.getElementById('tolerance-input'); input.value = '0.2'; input.dispatchEvent(new Event('input')); })()");
    await sleep(800);
    fs.writeFileSync(at('scan.xyz'), disk(x => (x > 0.4 ? 1.02 : 0.02), '0 0 255') + '\n');
    await panel.env.state.watchers.find(({ pattern }) => pattern.pattern === 'scan.xyz').change({ fsPath: at('scan.xyz') });
    const keep = panel.webview.html.match(/data-keep="([^"]*)"/)[1];
    pages.set('/page/compare-changed', panel.webview.html.replaceAll('vscode-webview:', "'self'"));
    await send('Page.navigate', { url: `${origin}/page/compare-changed` });
    for (let i = 0; i < 300 && await evaluate("!document.getElementById('loading-indicator') || !document.getElementById('loading-indicator').hidden"); i++) await sleep(100);
    await settle();
    const afterChange = await evaluate("[document.querySelectorAll('#stage-panel .prim-row')[1].querySelector('select').value, document.getElementById('tolerance-input').value, document.getElementById('panes-btn').classList.contains('active')].join('|')");
    const changedInfo = await info();
    const okChanged = keep === 'colors' && afterChange === `distance:${idOf(0)}|0.2|false` && Math.abs(mean(changedInfo, 'map.xyz') - 0.27) < 0.02;
    results.push(okChanged);
    console.log(`${okChanged ? 'PASS' : 'FAIL'} scan.xyz written again keeps its distance ${Math.round((Date.now() - changedAt) / 100) / 10}s keep ${keep} row|tolerance|panes ${afterChange} mean ${mean(changedInfo, 'map.xyz')}`);
    fs.rmSync(compareDir, { recursive: true, force: true });
}

// Two UTM clouds 3 m apart, each read less its own offset and placed back: in one view they stand side by side.
{
    const utmDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-utm-'));
    const disk = (cx, rgb) => Array.from({ length: 3000 }, (_, i) => { const r = Math.sqrt(i / 3000), a = i * 2.399; return `${cx + r * Math.cos(a)} ${4000000 + r * Math.sin(a)} 500 ${rgb}`; }).join('\n');
    const west = path.join(utmDir, 'west.xyz');
    const east = path.join(utmDir, 'east.xyz');
    fs.writeFileSync(west, disk(500000, '255 0 0'));
    fs.writeFileSync(east, disk(500003, '0 0 255'));
    await htmlFor(west);
    const panel = panels.get('west.xyz');
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(east).href] });
    pages.set('/page/utm-pair', panel.webview.html.replaceAll('vscode-webview:', "'self'"));
    await evaluate('sessionStorage.clear()');
    await send('Page.navigate', { url: `${origin}/page/utm-pair` });
    for (let i = 0; i < 150 && await evaluate("!document.getElementById('loading-indicator') || !document.getElementById('loading-indicator').hidden"); i++) await sleep(100);
    await evaluate("document.querySelectorAll('#top-control-bar, #stage-bar, #stage-panel, #color-legend').forEach(e => { e.style.visibility = 'hidden'; })");
    await sleep(800);
    const png = (await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 900, height: 600, scale: 0.5 } })).data;
    const seen = await evaluate(`(async () => {
        const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,${png}'; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data; let red = 0, blue = 0, rx = 0, bx = 0;
        for (let i = 0; i < d.length; i += 4) {
            const x = (i / 4) % c.width;
            if (d[i] > 150 && d[i + 1] < 80 && d[i + 2] < 80) { red++; rx += x; }
            if (d[i + 2] > 150 && d[i] < 80 && d[i + 1] < 80) { blue++; bx += x; }
        }
        return { red, blue, apart: Math.round(Math.abs(bx / blue - rx / red)) };
    })()`);
    const info = await evaluate("document.getElementById('info-table').innerText");
    const ok = seen.red > 50 && seen.blue > 50 && seen.apart > 20 && (info.match(/X 500,00[03]/g) ?? []).length === 2;
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'} west.xyz + east.xyz at UTM: red ${seen.red} blue ${seen.blue} apart ${seen.apart}px, offsets ${(info.match(/X 500,00\d/g) ?? []).join(', ')}`);
    fs.rmSync(utmDir, { recursive: true, force: true });
}

// A page for a changed file keeps only the colors: a file added before it is up must not bring back the rest.
{
    const staleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-stale-'));
    const cloud = path.join(staleDir, 'cloud.xyz');
    const other = path.join(staleDir, 'other.xyz');
    fs.writeFileSync(cloud, '0 0 0\n1 0 0\n0 1 0\n');
    fs.writeFileSync(other, '2 2 0\n');
    await htmlFor(cloud);
    const panel = panels.get('cloud.xyz');
    const visit = async key => {
        pages.set(`/page/${key}`, panel.webview.html.replaceAll('vscode-webview:', "'self'"));
        await send('Page.navigate', { url: `${origin}/page/${key}` });
    };
    const ready = async () => { for (let i = 0; i < 150 && await evaluate("!document.getElementById('loading-indicator') || !document.getElementById('loading-indicator').hidden"); i++) await sleep(100); };
    await evaluate('sessionStorage.clear()');
    await visit('stale-a');
    await ready();
    // The first page's view: the grid turned off.
    await evaluate(`document.querySelector('[data-helper="grid"]').click()`);
    await sleep(600);
    // The file changes into a slow one; its page is left before it is up, for the page of an added file.
    fs.writeFileSync(cloud, Array.from({ length: 600000 }, (_, i) => `${i % 1000} ${Math.floor(i / 1000)} 0`).join('\n'));
    await panel.env.state.watchers[0].change({ fsPath: cloud });
    await visit('stale-b');
    await sleep(150);
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(other).href] });
    await visit('stale-c');
    await ready();
    const grid = await evaluate(`document.querySelector('[data-helper="grid"]').classList.contains('active')`);
    results.push(grid);
    console.log(`${grid ? 'PASS' : 'FAIL'} cloud.xyz changed, other.xyz added before it was up: grid ${grid ? 'on, as a fresh view' : 'off, from the page before'}`);
    fs.rmSync(staleDir, { recursive: true, force: true });
}

// Add file… pressed while a slow file still loads saves no half-made view for the page the add brings.
{
    const slowDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-slow-'));
    const small = path.join(slowDir, 'small.xyz');
    const slow = path.join(slowDir, 'slow.xyz');
    fs.writeFileSync(small, '0 0 0\n1 0 0\n0 1 0\n');
    fs.writeFileSync(slow, Array.from({ length: 600000 }, (_, i) => `${i % 1000} ${Math.floor(i / 1000)} ${i % 7}`).join('\n'));
    await htmlFor(small);
    const panel = panels.get('small.xyz');
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(slow).href] });
    pages.set('/page/slow', panel.webview.html.replaceAll('vscode-webview:', "'self'"));
    await evaluate('sessionStorage.clear()');
    await send('Page.navigate', { url: `${origin}/page/slow` });
    // Press Add file… every 10 ms until the view is up.
    await evaluate(`window.__early = 0; window.__clicker = setInterval(() => document.getElementById('add-btn')?.click(), 10)`);
    for (let i = 0; i < 150 && await evaluate("!document.getElementById('loading-indicator') || !document.getElementById('loading-indicator').hidden"); i++) await sleep(100);
    await evaluate('clearInterval(window.__clicker)');
    const early = await evaluate('window.__early');
    results.push(early === 0);
    console.log(`${early === 0 ? 'PASS' : 'FAIL'} small.xyz + slow.xyz, Add file… while loading: views saved before it was up ${early}`);
    fs.rmSync(slowDir, { recursive: true, force: true });
}

// A 200 m cloud added to a 10 cm one: the view kept over the add (its far plane set for 10 cm) still shows it, and
// still does once hidden, framed without it (F) and shown again. A cloud 12 km off must not clip the part either.
{
    const farDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-far-'));
    const disk = (radius, x, z, rgb) => Array.from({ length: 3000 }, (_, i) => { const r = radius * Math.sqrt(i / 3000), a = i * 2.399; return `${x + r * Math.cos(a)} ${r * Math.sin(a)} ${z} ${rgb}`; }).join('\n');
    const small = path.join(farDir, 'small.xyz');
    const big = path.join(farDir, 'big.xyz');
    const distant = path.join(farDir, 'distant.xyz');
    fs.writeFileSync(small, disk(0.05, 0, 0, '255 0 0'));
    fs.writeFileSync(big, disk(100, 0, -30, '255 0 255'));
    fs.writeFileSync(distant, disk(100, 12000, 0, '255 0 255'));
    await htmlFor(small);
    const panel = panels.get('small.xyz');
    const shoot = async () => {
        const png = (await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 900, height: 600, scale: 0.5 } })).data;
        return evaluate(`(async () => {
            const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,${png}'; });
            const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data; let red = 0, magenta = 0;
            for (let i = 0; i < d.length; i += 4) {
                // Magenta, not blue: the axes draw blue.
                if (d[i] > 150 && d[i + 1] < 80 && d[i + 2] < 80) red++;
                if (d[i] > 150 && d[i + 2] > 150 && d[i + 1] < 80) magenta++;
            }
            return { red, magenta };
        })()`);
    };
    const look = async (key, html = panel.webview.html) => {
        pages.set(`/page/${key}`, html.replaceAll('vscode-webview:', "'self'"));
        await send('Page.navigate', { url: `${origin}/page/${key}` });
        for (let i = 0; i < 150 && await evaluate("!document.getElementById('loading-indicator') || !document.getElementById('loading-indicator').hidden"); i++) await sleep(100);
        await evaluate("document.querySelectorAll('#top-control-bar, #stage-bar, #stage-panel, #color-legend').forEach(e => { e.style.visibility = 'hidden'; })");
        await sleep(800);
        return shoot();
    };
    const eye = row => evaluate(`document.querySelectorAll('#stage-panel .prim-row')[${row}].querySelector('.prim-eye').click()`);
    await evaluate('sessionStorage.clear()');
    const alone = await look('far-alone');
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(big).href] });
    const added = await look('far-added');
    await eye(1);
    await sleep(300);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', text: 'f' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF' });
    await sleep(500);
    await eye(1);
    await sleep(800);
    const reshown = await shoot();
    const ok = alone.red > 50 && added.red > 50 && added.magenta > 50 && reshown.magenta > 50;
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'} small.xyz + big.xyz, far plane after the add: alone red ${alone.red}, added red ${added.red} magenta ${added.magenta}; hidden, F, shown magenta ${reshown.magenta}`);
    await htmlFor(small);
    const second = panels.get('small.xyz');
    await evaluate('sessionStorage.clear()');
    const alone2 = await look('far-alone2', second.webview.html);
    await second.listener({ type: 'addPaths', uris: [pathToFileURL(distant).href] });
    const far = await look('far-distant', second.webview.html);
    const okFar = far.red > alone2.red * 0.95;
    results.push(okFar);
    console.log(`${okFar ? 'PASS' : 'FAIL'} small.xyz + distant.xyz 12 km off: part red ${alone2.red} alone, ${far.red} after the add`);
    fs.rmSync(farDir, { recursive: true, force: true });
}

// A file 50 km off cannot share one depth range with a 10 cm part: shown, the view frames both; hidden, it must not
// re-frame the view on every other change. And a cloud whose axes were held back (origin past far) gets them as soon
// as a file shown again brings the origin within far.
{
    const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-remote-'));
    const disk = (radius, x, y, rgb) => Array.from({ length: 3000 }, (_, i) => { const r = radius * Math.sqrt(i / 3000), a = i * 2.399; return `${x + r * Math.cos(a)} ${y + r * Math.sin(a)} 0 ${rgb}`; }).join('\n');
    const at = name => path.join(remoteDir, name);
    fs.writeFileSync(at('part.xyz'), disk(0.05, 0, 0, '255 0 0'));
    fs.writeFileSync(at('side.xyz'), disk(0.05, 0.2, 0, '255 255 0'));
    fs.writeFileSync(at('remote.xyz'), disk(100, 50000, 0, '255 0 255'));
    fs.writeFileSync(at('utm.xyz'), disk(1, 500000, 4000000, '255 0 0'));
    fs.writeFileSync(at('origin.xyz'), disk(0.5, 0, 0, '255 0 255'));
    fs.writeFileSync(at('near.xyz'), disk(1, 500003, 4000000, '255 255 0'));
    const blue = png => evaluate(`(async () => {
        const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,${png}'; });
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
        // The Z axis shades from blue to cyan; the grid is grey and the clouds red, yellow and magenta.
        for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 150 && d[i] < 80) n++;
        return n;
    })()`);
    const axesBlue = async () => blue((await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 900, height: 600, scale: 0.5 } })).data);
    const look = async (key, panel) => {
        pages.set(`/page/${key}`, panel.webview.html.replaceAll('vscode-webview:', "'self'"));
        await send('Page.navigate', { url: `${origin}/page/${key}` });
        for (let i = 0; i < 150 && await evaluate("!document.getElementById('loading-indicator') || !document.getElementById('loading-indicator').hidden"); i++) await sleep(100);
        await evaluate("document.querySelectorAll('#top-control-bar, #stage-bar, #stage-panel, #color-legend').forEach(e => { e.style.visibility = 'hidden'; })");
        await sleep(800);
    };
    const eye = async row => {
        await evaluate(`document.querySelectorAll('#stage-panel .prim-row')[${row}].querySelector('.prim-eye').click()`);
        await sleep(500);
    };
    const key = async (name, code, hold = 0) => {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, text: name });
        await sleep(hold);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code });
        await sleep(800);
    };
    await htmlFor(at('part.xyz'));
    const part = panels.get('part.xyz');
    await evaluate('sessionStorage.clear()');
    await look('remote-alone', part);
    await part.listener({ type: 'addPaths', uris: [pathToFileURL(at('side.xyz')).href, pathToFileURL(at('remote.xyz')).href] });
    await look('remote-added', part);
    // Hide the far file, frame the rest and move off that framing; then hide and show the side file.
    await eye(2);
    await key('f', 'KeyF');
    await key('w', 'KeyW', 300);
    // Where the points fall on screen, not the whole picture: the grid redraws for the far plane the hidden file widens.
    const points = async () => coloredPoints((await send('Page.captureScreenshot', { format: 'png' })).data);
    const [, x0, y0] = await points();
    await eye(1);
    await eye(1);
    const [, x1, y1] = await points();
    const moved = Math.hypot(x1 - x0, y1 - y0);
    const okStay = moved < 2;
    results.push(okStay);
    console.log(`${okStay ? 'PASS' : 'FAIL'} part.xyz + side.xyz + remote.xyz 50 km off, hidden: side hidden and shown again moves the points ${moved.toFixed(1)} px`);
    await htmlFor(at('utm.xyz'));
    const utm = panels.get('utm.xyz');
    await evaluate('sessionStorage.clear()');
    await look('utm-alone', utm);
    await utm.listener({ type: 'addPaths', uris: [pathToFileURL(at('origin.xyz')).href] });
    await look('utm-origin', utm);
    // Hide the file at the origin and frame the UTM cloud: the next page holds the axes back.
    await eye(1);
    await key('f', 'KeyF');
    await utm.listener({ type: 'addPaths', uris: [pathToFileURL(at('near.xyz')).href] });
    await look('utm-near', utm);
    const held = await axesBlue();
    await eye(1);
    const shown = await axesBlue();
    const okAxes = held === 0 && shown > 20;
    results.push(okAxes);
    console.log(`${okAxes ? 'PASS' : 'FAIL'} utm.xyz + origin.xyz hidden + near.xyz: axes blue ${held} held back, ${shown} once origin.xyz is shown`);
    fs.rmSync(remoteDir, { recursive: true, force: true });
}

// #24: a lost context says so in the view, and a restored one draws the same picture again, splats too.
{
    const lostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-lost-'));
    fs.copyFileSync(path.join(dir, 'cube.stl'), path.join(lostDir, 'cube.stl'));
    fs.writeFileSync(path.join(lostDir, 'gauss.ply'), splatPly(['scale_0', 'scale_1', 'scale_2']));
    for (const name of ['cube.stl', 'gauss.ply']) {
        const started = Date.now();
        await evaluate('sessionStorage.clear()');
        pages.set(`/page/lost-${name}`, await htmlFor(path.join(lostDir, name)));
        await send('Page.navigate', { url: `${origin}/page/lost-${name}` });
        for (let i = 0; i < 75 && await evaluate("!document.getElementById('loading-indicator') || !document.getElementById('loading-indicator').hidden"); i++) await sleep(200);
        await sleep(2000);
        const before = await pageShot();
        const message = () => evaluate("document.getElementById('load-error').checkVisibility() ? document.getElementById('load-error').textContent : ''");
        await evaluate("window.__lose = document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lose.loseContext()");
        await sleep(500);
        const lost = await message();
        await evaluate('window.__posted = null; window.__lose.restoreContext()');
        await sleep(2000);
        // A splat view asks for a new page, which the extension renders with the view it saved.
        const rerender = await evaluate('window.__posted?.type');
        if (rerender === 'rerender') {
            await panels.get(name).listener({ type: 'rerender' });
            pages.set(`/page/lost-${name}`, panels.get(name).webview.html.replaceAll('vscode-webview:', "'self'"));
            await send('Page.navigate', { url: `${origin}/page/lost-${name}` });
            for (let i = 0; i < 75 && await evaluate("!document.getElementById('loading-indicator') || !document.getElementById('loading-indicator').hidden"); i++) await sleep(200);
            await sleep(2000);
        }
        const after = await pageShot();
        const changed = await shotDiff(before, after);
        const restored = await message();
        const ok = /GPU/.test(lost) && !restored && changed < 0.01 && (rerender === 'rerender') === (name === 'gauss.ply');
        results.push(ok);
        console.log(`${ok ? 'PASS' : 'FAIL'} ${name} context lost and restored ${Math.round((Date.now() - started) / 100) / 10}s ${JSON.stringify({ lost, restored, changed, rerender })}`);
    }
    fs.rmSync(lostDir, { recursive: true, force: true });
}

// A file with no points opens empty, and a view whose every file fails still lists them, the added one removable.
{
    const started = Date.now();
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-empty-'));
    const at = name => path.join(emptyDir, name);
    fs.writeFileSync(at('empty.bin'), '');
    fs.writeFileSync(at('bad.bin'), Buffer.alloc(15));
    fs.writeFileSync(at('worse.bin'), Buffer.alloc(17));
    const look = async (key, html) => {
        pages.set(`/page/${key}`, html.replaceAll('vscode-webview:', "'self'"));
        await send('Page.navigate', { url: `${origin}/page/${key}` });
        for (let i = 0; i < 75 && await evaluate("!document.getElementById('loading-indicator') || !document.getElementById('loading-indicator').hidden"); i++) await sleep(200);
        return evaluate(`({
            loading: !document.getElementById('loading-indicator').hidden,
            error: document.getElementById('load-error').hidden ? '' : document.getElementById('load-error').textContent,
            info: document.getElementById('info-table').innerText,
            stage: !document.getElementById('stage-panel').hidden,
            rows: [...document.querySelectorAll('#stage-panel .prim-row')].map(row => [row.querySelector('.prim-name span').textContent, row.classList.contains('failed'), !!row.querySelector('.prim-remove') && !row.querySelector('.prim-remove').disabled])
        })`);
    };
    const thrown = exceptions.length;
    const empty = await look('empty.bin', await htmlFor(at('empty.bin')));
    await htmlFor(at('bad.bin'));
    const panel = panels.get('bad.bin');
    // VS Code keeps a state per panel; the harness's sessionStorage is shared, so a new panel starts it empty.
    await evaluate('sessionStorage.clear()');
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(at('worse.bin')).href] });
    const failed = await look('failed', panel.webview.html);
    const removed = await evaluate("(() => { window.__posted = null; document.querySelectorAll('#stage-panel .prim-row')[1]?.querySelector('.prim-remove')?.click(); return window.__posted?.type; })()");
    // With the opened file failed, the view takes its up axis from the first file that loaded (a glTF, +Y).
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(path.join(dir, 'tri.gltf')).href] });
    await look('failed-gltf', panel.webview.html);
    const up = await evaluate("document.getElementById('up-select').value");
    const emptyOk = !empty.loading && !empty.error && empty.info.includes('KITTI');
    const failedOk = !failed.loading && failed.stage && JSON.stringify(failed.rows) === JSON.stringify([['bad.bin', true, false], ['worse.bin', true, true]])
        && failed.info.includes('15 bytes') && failed.info.includes('17 bytes') && removed === 'removeFile';
    const ok = emptyOk && failedOk && up === '+Y' && exceptions.length === thrown;
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'} empty.bin, bad.bin + worse.bin ${Math.round((Date.now() - started) / 100) / 10}s empty ${JSON.stringify(empty)} failed ${JSON.stringify(failed)} remove ${removed} up with tri.gltf ${up} exceptions ${exceptions.length - thrown}`);
    fs.rmSync(emptyDir, { recursive: true, force: true });
}

chrome.kill();
await new Promise(resolve => chrome.on('exit', resolve));
server.close();
await sleep(1000);
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {}
fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(globalStorage, { recursive: true, force: true });
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
