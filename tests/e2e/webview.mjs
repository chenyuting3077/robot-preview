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
    return { load: encode(env.lastOf('load')), update: encode(env.lastOf('update')), matrix: encode(await capturePathMatrix()), ur: encode(urFixture()) };
}

// ur_description has no meshes in the fixture; the check is that load_yaml and
// the patched xacro-parser work in the bundled webview, not only in Node.
function urFixture() {
    const dir = new URL('../fixtures/xacro/ur_description/', import.meta.url).pathname;
    const files = fs.readdirSync(dir, { recursive: true })
        .filter(rel => fs.statSync(path.join(dir, rel)).isFile())
        .map(rel => ({ path: `/ur_description/${rel.split(path.sep).join('/')}`, data: fs.readFileSync(path.join(dir, rel)) }));
    return { type: 'load', files, primary: '/ur_description/urdf/ur.urdf.xacro', xacroArgs: { ur_type: 'ur5e' } };
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
    // The complete report; a partial one goes out first on a cold load.
    const finalDiagnostics = async (ms = 10000) => {
        await waitFor("window.__out.find(m => m.type === 'diagnostics' && !m.partial)", ms);
        return ev("return window.__out.find(m => m.type === 'diagnostics' && !m.partial)");
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
    return { ev, waitFor, finalDiagnostics, close };
}

const messages = await captureMessages();
const server = await serve(messages);
const page = await connect(server.address().port);
const { ev, waitFor, finalDiagnostics } = page;

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
    const diagnostics = await finalDiagnostics();
    check('clean diagnostics after load', diagnostics?.loadError === null && diagnostics.missingMeshes.length === 0 && Object.values(diagnostics.syntax).every(list => list.length === 0));
    const firstReports = await ev(`return window.__out.filter(m => m.type === 'diagnostics').map(m => ({ partial: !!m.partial, checks: m.checks.map(c => c.rule + ':' + c.name).sort() }))`);
    const meshFree = report => JSON.stringify(report.checks.filter(check => !check.startsWith('collision-scale-mismatch')));
    check('the first load reports the checks needing no mesh size before meshes load', firstReports.length === 2 && firstReports[0].partial && !firstReports[1].partial && meshFree(firstReports[0]) === meshFree(firstReports[1]), JSON.stringify(firstReports));

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

    await ev(`document.getElementById('toggle-model-tree').click(); document.getElementById('floating-model-tree').style.transform = 'translate(-300px, 120px)'; document.querySelector('.panel-maximize-btn[data-panel-id=floating-model-tree]').click()`);
    await sleep(800);
    const maximized = await ev(`const r = document.getElementById('floating-model-tree').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight }`);
    check('a dragged tree panel maximizes inside the view', maximized.left >= 0 && maximized.top >= 0 && maximized.right <= maximized.vw && maximized.bottom <= maximized.vh, JSON.stringify(maximized));
    const labels = await ev(`
        const boxes = [...document.querySelectorAll('.graph-joint-group, .graph-node')].map(g => ({ rect: g.querySelector('.joint-capsule-bg, .node-bg').getBoundingClientRect(), text: Math.max(...[...g.querySelectorAll('text')].map(t => t.getBoundingClientRect().width)) }));
        const joints = [...document.querySelectorAll('.joint-capsule-bg')].map(r => r.getBoundingClientRect());
        const overlaps = joints.some((a, i) => joints.some((b, j) => j > i && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
        return { count: boxes.length, clipped: boxes.filter(b => b.rect.width < b.text).length, overlaps };`);
    check('tree labels drawn while hidden fit their boxes and joints never overlap', labels.count > 2 && labels.clipped === 0 && !labels.overlaps, JSON.stringify(labels));
    await ev(`document.querySelector('.panel-maximize-btn[data-panel-id=floating-model-tree]').click(); document.getElementById('toggle-model-tree').click()`);
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
    const broken = Object.values((await finalDiagnostics(5000)).syntax).flat();
    check('syntax error reported with its line', broken.length === 1 && broken[0].line === 2, JSON.stringify(broken));
    await ev(`window.__out.length = 0; window.postMessage({ type: 'exportUrdf', requestId: 8 }, '*')`);
    await waitFor(`window.__out.some(m => m.type === 'urdf')`, 3000);
    check('export refused while the source does not load', await ev(`return window.__out.find(m => m.type === 'urdf').text === null`));
    await ev(`await window.__send('update')`);
    check('fixing the XML clears the error', await waitFor(`getComputedStyle(document.getElementById('load-error')).display === 'none' && window.app.currentModel !== window.__keep`, 8000));
    await finalDiagnostics();
    check('an update sends one report, no partial one first', await ev(`return !window.__out.some(m => m.type === 'diagnostics' && m.partial)`));

    await ev(`window.__out.length = 0; await window.__send('load', m => { m.xacroArgs = { side: 'right' }; m.files = m.files.filter(f => !f.path.endsWith('arm.stl')); })`);
    check('xacro arguments override defaults', await waitFor(`window.app.currentModel?.links?.has('right_arm')`, 10000));
    const missing = (await finalDiagnostics(5000)).missingMeshes;
    check('missing mesh reported', missing.length === 1 && missing[0].endsWith('arm.stl'), JSON.stringify(missing));

    await ev(`window.__out.length = 0; await window.__send('matrix')`);
    check('path matrix model loads', await waitFor(`window.app.currentModel?.links?.has('l9')`, 10000));
    const matrixDiagnostics = await finalDiagnostics(15000);
    const expectedMissing = messages.matrix.expectedMissing;
    const unexpected = (matrixDiagnostics?.missingMeshes || []).filter(mesh => !expectedMissing.some(path => mesh.endsWith(path)));
    check('every path form resolves to its mesh', matrixDiagnostics?.loadError === null && unexpected.length === 0, JSON.stringify(unexpected));
    check('a case-mismatched mesh is reported as a guess', JSON.stringify(matrixDiagnostics?.guessedMeshes) === JSON.stringify([{ path: 'pkg/meshes/case.STL', resolved: '/pkg/meshes/Case.stl', match: 'case' }]), JSON.stringify(matrixDiagnostics?.guessedMeshes));

    await ev(`await window.__send('ur')`);
    check('UR5e with load_yaml loads in the webview', await waitFor(`window.app.currentModel?.links?.has('wrist_3_link') && window.app.currentModel.joints.has('shoulder_pan_joint')`, 15000));
    check('UR5e joint limit read from yaml (!degrees)', await ev(`return Math.abs(window.app.currentModel.joints.get('shoulder_pan_joint').limits.upper - 2 * Math.PI) < 1e-6`), JSON.stringify(await ev(`return window.app.currentModel.joints.get('shoulder_pan_joint')?.limits`)));

    await ev(`window.__out.length = 0; await window.__send('ur', m => { const f = m.files.find(f => f.path.endsWith('ur5e/joint_limits.yaml')); f.data = btoa('joint_limits:\\n  a: [1, 2\\n'); })`);
    const yamlDiagnostics = await finalDiagnostics(15000);
    check('a yaml syntax error points at the yaml file', yamlDiagnostics?.loadErrorLocation?.key === '/ur_description/config/ur5e/joint_limits.yaml' && yamlDiagnostics.loadErrorLocation.line >= 1, JSON.stringify(yamlDiagnostics?.loadErrorLocation));

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

    // The shadow-catching ground plane is coplanar with the grid; if it writes
    // depth, grid lines z-fight with it and flicker as the camera moves.
    const box = '<robot name="b"><link name="base"><visual><origin xyz="0 0 0.1"/><geometry><box size="0.2 0.2 0.2"/></geometry></visual></link></robot>';
    await ev(`window.postMessage({ type: 'load', files: [{ path: '/b/b.urdf', data: new TextEncoder().encode(${JSON.stringify(box)}) }], primary: '/b/b.urdf' }, '*')`);
    await waitFor(`window.app.currentModel?.links?.has('base')`, 10000);
    const hidden = await ev(`
        const sm = window.app.sceneManager, r = sm.renderer, gl = r.getContext(), plane = sm.environmentManager.groundPlane;
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4);
        const gridPixels = () => { r.render(sm.scene, sm.camera); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf); let n = 0; for (let i = 0; i < buf.length; i += 4) if (buf[i] > 90 && buf[i + 1] > 90 && buf[i + 2] > 90) n++; return n; };
        // Shadows off: a shadow under the semi-transparent grid darkens a few
        // pixels legitimately; only depth should be measured.
        sm.environmentManager.setShadowEnabled(false, r);
        let hidden = 0;
        for (const a of [0.35, 0.5, 0.65]) {
            sm.camera.position.set(3 * Math.cos(a), 0.6, 3 * Math.sin(a));
            sm.controls.target.set(0, 0, 0); sm.controls.update(); sm.camera.updateMatrixWorld();
            const withPlane = gridPixels(); plane.visible = false; hidden += gridPixels() - withPlane; plane.visible = true;
        }
        sm.environmentManager.setShadowEnabled(true, r);
        return hidden;`);
    check('the ground plane never hides grid lines', hidden === 0, `${hidden} grid pixels hidden`);

    await ev(`window.__out.length = 0; document.getElementById('screenshot-btn').click()`);
    await waitFor(`window.__out.some(m => m.type === 'screenshot')`, 5000);
    const shot = await ev(`
        const message = window.__out.find(m => m.type === 'screenshot');
        const image = new Image();
        image.src = 'data:image/png;base64,' + message.data;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        // Not blank: more than 1% of pixels differ from the background in the corner.
        let drawn = 0;
        for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - pixels[0]) + Math.abs(pixels[i + 1] - pixels[1]) + Math.abs(pixels[i + 2] - pixels[2]) > 30) drawn++;
        const css = window.app.sceneManager.renderer.domElement.getBoundingClientRect();
        return { name: message.name, width: image.width, height: image.height, cssWidth: Math.round(css.width), cssHeight: Math.round(css.height), drawn: drawn / (pixels.length / 4) };`);
    check('screenshot is twice the view size, not blank, named after <robot name>', shot.name === 'b' && shot.width === shot.cssWidth * 2 && shot.height === shot.cssHeight * 2 && shot.drawn > 0.01, JSON.stringify(shot));

    const flawed = '<robot name="f"><link name="base"/><link name="arm"><visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual></link><joint name="j" type="revolute"><parent link="base"/><child link="arm"/><axis xyz="0 0 1"/></joint></robot>';
    await ev(`window.__out.length = 0; window.postMessage({ type: 'load', files: [{ path: '/f/f.urdf', data: new TextEncoder().encode(${JSON.stringify(flawed)}) }], primary: '/f/f.urdf' }, '*')`);
    const checks = (await finalDiagnostics()).checks.map(c => c.rule + ':' + c.name).sort();
    check('a later load sends one report, no partial one first', await ev(`return !window.__out.some(m => m.type === 'diagnostics' && m.partial)`));
    check('model checks run on the loaded robot', JSON.stringify(checks) === JSON.stringify(['missing-inertial:arm', 'missing-limit:j']), JSON.stringify(checks));

    const violations = await ev(`return window.__csp`);
    check('no CSP violations', violations.length === 0, JSON.stringify(violations));
} finally {
    await page.close();
    server.close();
}

const failed = results.filter(ok => !ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
