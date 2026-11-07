import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyFixture, loadExtension, sleep } from '../extension/vscode-mock.mjs';
import { createPathMatrix } from '../extension/path-fixture.mjs';

const dist = new URL('../../packages/urdf-mjcf/dist/', import.meta.url).pathname;
const chromeBinary = process.env.CHROME || 'google-chrome';
const results = [];
const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${detail}` : ''}`);
};

async function captureMessages() {
    const workspace = await copyFixture();
    const env = loadExtension({ workspace });
    const primary = path.join(workspace, 'src/robot_a/urdf/robot_a.urdf.xacro');
    const doc = env.open(primary);
    env.activate();
    while (!env.state.panels[0]?.webview.html) await sleep(20);
    env.state.panels[0].receive({ type: 'ready' });
    while (!env.lastOf('load')) await sleep(20);
    doc.edit(doc.getText().replace('<box size="0.2 0.2 0.05"/>', '<box size="0.2 0.2 0.05"/>\n      </geometry>\n    </visual>\n    <visual>\n      <origin xyz="0 0 0.4"/>\n      <geometry>\n        <sphere radius="0.05"/>'));
    env.fire('change', { document: doc, contentChanges: [{}] });
    while (!env.lastOf('update')) await sleep(20);
    const encode = message => ({ ...message, files: message.files.map(file => ({ path: file.path, data: Buffer.from(file.data).toString('base64') })) });
    return { load: encode(env.lastOf('load')), update: encode(env.lastOf('update')), matrix: encode(await capturePathMatrix()) };
}

async function capturePathMatrix() {
    const matrix = createPathMatrix();
    Object.assign(process.env, matrix.env);
    const env = loadExtension({ workspace: matrix.ws, config: matrix.config });
    env.open(matrix.primary);
    env.activate();
    while (!env.state.panels[0]?.webview.html) await sleep(20);
    env.state.panels[0].receive({ type: 'ready' });
    while (!env.lastOf('load')) await sleep(20);
    return { ...env.lastOf('load'), expectedMissing: matrix.expectedMissing };
}

function serve(messages) {
    const csp = [
        "default-src 'none'",
        "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "connect-src 'self' blob: data:",
        "font-src 'self' data:",
        'media-src blob: data:',
        'worker-src blob:'
    ].join('; ');
    const harness = `
window.__out = [];
window.__csp = [];
document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
window.acquireVsCodeApi = () => ({ postMessage: m => window.__out.push(m), setState: s => { window.__state = s; } });
window.__send = async (name, patch) => {
  const messages = window.__messages ||= await (await fetch('/messages.json')).json();
  const message = structuredClone(messages[name]);
  if (patch) patch(message);
  message.files = message.files.map(f => ({ path: f.path, data: typeof f.data === 'string' ? Uint8Array.from(atob(f.data), c => c.charCodeAt(0)) : f.data }));
  window.postMessage(message, '*');
};`;
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/messages.json') return res.end(JSON.stringify(messages));
        if (url.pathname === '/harness.js') {
            res.setHeader('Content-Type', 'text/javascript');
            return res.end(harness);
        }
        const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
        if (!file.startsWith(dist) || !fs.existsSync(file)) {
            res.statusCode = 404;
            return res.end();
        }
        if (file.endsWith('index.html')) {
            res.setHeader('Content-Type', 'text/html');
            return res.end(fs.readFileSync(file, 'utf8')
                .replace(/<html lang="[^"]*">/, '<html lang="zh-tw">')
                .replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{padding:0 20px;font-size:13px}</style><script src="/harness.js"></script>`));
        }
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function connect(port) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-chrome-'));
    const chrome = spawn(chromeBinary, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--enable-unsafe-swiftshader', '--window-size=1400,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const wsUrl = await new Promise((resolve, reject) => {
        chrome.stderr.on('data', chunk => {
            const match = String(chunk).match(/ws:\/\/\S+/);
            if (match) resolve(match[0]);
        });
        chrome.on('exit', code => reject(new Error(`chrome exited ${code}`)));
    });
    const targets = await (await fetch(`http://${new URL(wsUrl).host}/json`)).json();
    const ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => { ws.onopen = resolve; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message.result);
            pending.delete(message.id);
        }
        if (message.method === 'Runtime.exceptionThrown') {
            console.log('EXCEPTION', message.params.exceptionDetails.exception?.description?.slice(0, 300));
        }
    };
    const send = (method, params = {}) => new Promise(resolve => {
        pending.set(++id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });
    const ev = async expression => {
        const result = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description);
        return result.result.value;
    };
    const waitFor = async (expression, ms = 20000) => {
        const start = Date.now();
        while (Date.now() - start < ms) {
            if (await ev(`return !!(${expression})`)) return true;
            await sleep(200);
        }
        return false;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    const close = async () => {
        const exited = new Promise(resolve => chrome.once('exit', resolve));
        chrome.kill();
        await exited;
        await sleep(1000);
        try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {}
    };
    return { ev, waitFor, close };
}

const messages = await captureMessages();
const server = await serve(messages);
const page = await connect(server.address().port);
const { ev, waitFor } = page;

try {
    const panelsHidden = `['floating-joints-panel','floating-model-tree'].every(id => getComputedStyle(document.getElementById(id)).display === 'none')`;
    check('ready posted', await waitFor(`window.__out?.some(m => m.type === 'ready')`));
    check('zh-TW from <html lang>', await ev(`return window.i18n.getCurrentLanguage() === 'zh-TW' && document.getElementById('toggle-joints-panel').textContent.trim() === '關節'`));
    check('panels closed by default', await ev(`return ${panelsHidden}`));

    await ev(`await window.__send('load', m => { m.settings = { 'show-collision': true, unit: 'deg' }; })`);
    check('model loads with both packages', await waitFor(`window.app.currentModel?.links?.has('left_arm') && window.app.currentModel.links.has('lift_link')`));
    check('STL without normals is shaded', await ev(`let n; window.app.currentModel.links.get('left_arm').threeObject.traverse(o => { if (!n && o.isMesh) n = o.geometry.attributes.normal; }); return !!n && Array.from(n.array).some(v => v !== 0)`));
    await sleep(800);
    check('loading indicator hidden after load', await ev(`return getComputedStyle(document.getElementById('loading-indicator')).display === 'none'`));
    check('settings applied, panels still closed', await ev(`return document.getElementById('show-collision').classList.contains('active') && window.app.angleUnit === 'deg' && ${panelsHidden}`));
    const diagnostics = await ev(`return window.__out.find(m => m.type === 'diagnostics')`);
    check('clean diagnostics after load', diagnostics?.loadError === null && diagnostics.missingMeshes.length === 0 && Object.values(diagnostics.syntax).every(list => list.length === 0));

    await ev(`
        window.app.poseController.setJointValue('lift_joint', 0.1);
        const camera = window.app.sceneManager.camera;
        camera.position.set(0.8, -0.6, 0.5);
        window.app.sceneManager.controls.target.set(0, 0, 0.1);
        window.app.sceneManager.controls.update();
        const count = () => { let n = 0; window.app.sceneManager.world?.traverse(o => { if (o.isMesh && o.visible) n++; }); return n; };
        window.__steady = count(); window.__min = Infinity; window.__snapshot = false; window.__sampling = true;
        const sample = () => { if (!window.__sampling) return; window.__min = Math.min(window.__min, count()); if (document.getElementById('canvas-snapshot')) window.__snapshot = true; requestAnimationFrame(sample); };
        requestAnimationFrame(sample);
        window.__before = window.app.currentModel;`);
    await ev(`await window.__send('update')`);
    check('update applied', await waitFor(`window.app.currentModel !== window.__before`));
    await sleep(800);
    const smooth = await ev(`window.__sampling = false; return { steady: window.__steady, min: window.__min, snapshot: window.__snapshot }`);
    check('update never drops meshes or shows a snapshot', !smooth.snapshot && smooth.min >= smooth.steady, JSON.stringify(smooth));
    check('camera kept', await ev(`const p = window.app.sceneManager.camera.position; return [p.x, p.y, p.z].map(v => +v.toFixed(3)).join() === '0.8,-0.6,0.5'`));
    check('joint pose kept', await ev(`return Math.abs(window.app.poseController.getJointValue('lift_joint') - 0.1) < 1e-9`));
    const pose = `const c = window.app.sceneManager.camera.position, t = window.app.sceneManager.controls.target; return [c.x, c.y, c.z, t.x, t.y, t.z].map(v => +v.toFixed(3)).join()`;
    const press = async (key, hold) => {
        await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}' }))`);
        await sleep(hold);
        await ev(`document.dispatchEvent(new KeyboardEvent('keyup', { key: '${key}' }))`);
    };
    await press('f', 100);
    const framed = await ev(pose);
    await press('w', 300);
    const flown = await ev(pose);
    await press('q', 300);
    const turned = await ev(pose);
    await ev(`const canvas = window.app.sceneManager.renderer.domElement, r = canvas.getBoundingClientRect(); let m; window.app.currentModel.threeObject.traverse(o => { if (!m && o.isMesh && o.visible) m = o; }); const v = m.getWorldPosition(m.position.clone()).project(window.app.sceneManager.camera); canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + (v.x + 1) / 2 * r.width, clientY: r.top + (1 - v.y) / 2 * r.height }))`);
    const pivot = await ev(pose);
    await press('f', 100);
    check('W flies, Q turns, double-click sets pivot, F frames', flown !== framed && turned !== flown && pivot !== turned && await ev(pose) === framed, JSON.stringify({ framed, flown, turned, pivot }));

    await ev(`window.postMessage({ type: 'highlight', kind: 'link', pattern: 'lift_link' }, '*')`);
    check('cursor highlight', await waitFor(`window.app.sceneManager.highlightManager.currentHighlightedLink?.name === 'lift_link'`, 3000));
    check('help lists the controls', await ev(`document.getElementById('help-btn').click(); const panel = document.getElementById('help-panel'); const open = panel.classList.contains('open') && panel.querySelectorAll('tr').length === 10 && panel.innerText.includes('W A S D'); document.body.click(); return open && !panel.classList.contains('open')`));
    check('cursor highlight does not pop up the hover info', await ev(`return !document.getElementById('hover-info').classList.contains('visible')`));
    await ev(`window.postMessage({ type: 'highlight', kind: 'joint', pattern: '.+?_arm_joint' }, '*')`);
    check('joint highlight resolves to child link', await waitFor(`window.app.sceneManager.highlightManager.currentHighlightedLink?.name === 'left_arm'`, 3000));

    await ev(`window.__out.length = 0; window.app.modelGraphView.onReveal('link', 'base_link')`);
    check('graph click posts reveal', await ev(`return window.__out.some(m => m.type === 'reveal' && m.name === 'base_link')`));

    await ev(`window.__out.length = 0; document.getElementById('toggle-joints-panel').click()`);
    await sleep(400);
    await ev(`const input = [...document.querySelectorAll('.joint-limit-max')].find(i => i.closest('.joint-control')?.textContent.includes('left_arm_joint')); input.value = '45'; input.dispatchEvent(new Event('change'));`);
    const edit = await ev(`return window.__out.find(m => m.type === 'editLimits')`);
    check('limit edit posts radians', edit?.joint === 'left_arm_joint' && Math.abs(edit.limits.upper - Math.PI / 4) < 1e-9, JSON.stringify(edit));
    await sleep(500);
    const settings = await ev(`return window.__out.find(m => m.type === 'settings')?.settings`);
    check('panel toggle saved as setting', settings?.['toggle-joints-panel'] === true && settings['show-collision'] === true, JSON.stringify(settings));


    await ev(`window.__out.length = 0; window.postMessage({ type: 'exportUrdf', requestId: 7 }, '*')`);
    await waitFor(`window.__out.some(m => m.type === 'urdf')`, 3000);
    const exported = await ev(`return window.__out.find(m => m.type === 'urdf')`);
    check('export returns expanded URDF', exported?.requestId === 7 && /<link name="left_arm"/.test(exported.text) && !/xacro:/.test(exported.text));

    await ev(`window.__keep = window.app.currentModel; window.__out.length = 0; await window.__send('update', m => { m.files = [{ path: m.files[0].path, data: new TextEncoder().encode('<robot name="x">\\n  <link name="a">\\n</robot>') }]; })`);
    check('broken XML keeps the model and shows the error', await waitFor(`getComputedStyle(document.getElementById('load-error')).display === 'block'`, 8000) && await ev(`return window.app.currentModel === window.__keep`));
    await waitFor(`window.__out.some(m => m.type === 'diagnostics')`, 5000);
    const broken = await ev(`return Object.values(window.__out.find(m => m.type === 'diagnostics').syntax).flat()`);
    check('syntax error reported with its line', broken.length === 1 && broken[0].line === 2, JSON.stringify(broken));
    await ev(`window.__out.length = 0; window.postMessage({ type: 'exportUrdf', requestId: 8 }, '*')`);
    await waitFor(`window.__out.some(m => m.type === 'urdf')`, 3000);
    check('export refused while the source does not load', await ev(`return window.__out.find(m => m.type === 'urdf').text === null`));
    await ev(`await window.__send('update')`);
    check('fixing the XML clears the error', await waitFor(`getComputedStyle(document.getElementById('load-error')).display === 'none' && window.app.currentModel !== window.__keep`, 8000));

    await ev(`window.__out.length = 0; await window.__send('load', m => { m.xacroArgs = { side: 'right' }; m.files = m.files.filter(f => !f.path.endsWith('arm.stl')); })`);
    check('xacro arguments override defaults', await waitFor(`window.app.currentModel?.links?.has('right_arm')`, 10000));
    await waitFor(`window.__out.some(m => m.type === 'diagnostics')`, 5000);
    const missing = await ev(`return window.__out.find(m => m.type === 'diagnostics').missingMeshes`);
    check('missing mesh reported', missing.length === 1 && missing[0].endsWith('arm.stl'), JSON.stringify(missing));

    await ev(`window.__out.length = 0; await window.__send('matrix')`);
    check('path matrix model loads', await waitFor(`window.app.currentModel?.links?.has('l8')`, 10000));
    await waitFor(`window.__out.some(m => m.type === 'diagnostics')`, 15000);
    const matrixDiagnostics = await ev(`return window.__out.find(m => m.type === 'diagnostics')`);
    const expectedMissing = messages.matrix.expectedMissing;
    const unexpected = (matrixDiagnostics?.missingMeshes || []).filter(mesh => !expectedMissing.some(path => mesh.endsWith(path)));
    check('every path form resolves to its mesh', matrixDiagnostics?.loadError === null && unexpected.length === 0, JSON.stringify(unexpected));


    await ev(`document.body.classList.add('vscode-light')`);
    check('theme follows VS Code', await waitFor(`document.documentElement.getAttribute('data-theme') === 'light'`, 3000));
    await ev(`document.body.classList.remove('vscode-light')`);

    await ev(`await window.__send('load', m => { m.files = m.files.filter(f => f.path.endsWith('arm.stl')).map(f => ({ ...f, path: '/mesh/arm.stl' })); m.primary = '/mesh/arm.stl'; })`);
    check('mesh preview', await waitFor(`window.app.currentModel?.isMesh === true`, 10000));

    const mjcf = '<mujoco model="t"><worldbody><light pos="0 0 3"/><geom type="plane" size="2 2 .1"/><body name="arm" pos="0 0 1"><joint name="hinge" type="hinge" axis="0 1 0"/><geom type="capsule" fromto="0 0 0 .5 0 0" size=".05"/></body></worldbody></mujoco>';
    await ev(`window.postMessage({ type: 'load', files: [{ path: '/t/t.xml', data: new TextEncoder().encode(${JSON.stringify(mjcf)}) }], primary: '/t/t.xml' }, '*')`);
    check('MJCF loads', await waitFor(`window.app.currentModel?.joints?.has('hinge')`, 15000));
    await ev(`document.getElementById('mujoco-simulate-btn-bar').click()`);
    check('MuJoCo simulation runs under the CSP', await waitFor(`window.app.mujocoSimulationManager.isSimulationRunning()`, 30000));

    const violations = await ev(`return window.__csp`);
    check('no CSP violations', violations.length === 0, JSON.stringify(violations));
} finally {
    await page.close();
    server.close();
}

const failed = results.filter(ok => !ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
