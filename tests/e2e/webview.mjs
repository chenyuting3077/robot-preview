import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFixture, loadExtension, sleep, chromePath } from '../extension/vscode-mock.mjs';
import { createPathMatrix } from '../extension/path-fixture.mjs';

const dist = fileURLToPath(new URL('../../packages/urdf-mjcf/dist/', import.meta.url));
const chromeBinary = chromePath();
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
    const onDemand = {};
    await readOnDemand(env, env.lastOf('load'), onDemand);
    const matrix = await capturePathMatrix(onDemand);
    return { load: encode(env.lastOf('load')), update: encode(env.lastOf('update')), matrix: encode(matrix), ur: encode(urFixture()), xacro: encode(xacroFixture()), onDemand };
}

const encode = message => ({ ...message, files: message.files.map(file => (file.data ? { path: file.path, data: Buffer.from(file.data).toString('base64') } : file)) });

// The meshes the extension sends only on request, read through it now so the page can be answered offline.
async function readOnDemand(env, message, into) {
    for (const file of message.files.filter(file => !file.data)) {
        const id = Object.keys(into).length + 1000;
        env.state.panels[0].receive({ type: 'readFile', id, path: file.path });
        let reply;
        while (!(reply = env.state.posted.find(m => m.type === 'fileData' && m.id === id))) await sleep(20);
        into[file.path] = Buffer.from(reply.data).toString('base64');
    }
}

// ur_description has no meshes in the fixture; the check is that load_yaml and
// the patched xacro-parser work in the bundled webview, not only in Node.
function urFixture() {
    const dir = fileURLToPath(new URL('../fixtures/xacro/ur_description/', import.meta.url));
    const files = fs.readdirSync(dir, { recursive: true })
        .filter(rel => fs.statSync(path.join(dir, rel)).isFile())
        .map(rel => ({ path: `/ur_description/${rel.split(path.sep).join('/')}`, data: fs.readFileSync(path.join(dir, rel)) }));
    return { type: 'load', files, primary: '/ur_description/urdf/ur.urdf.xacro', xacroArgs: { ur_type: 'ur5e' } };
}

// Chrome's DOMParser, not linkedom, reads the rewritten Python (#27).
function xacroFixture() {
    const files = ['turtlebot3_description', 'pmb2_description', 'pal_urdf_utils', 'kortex_description', 'xarm_description', 'expressions'].flatMap(name => {
        const dir = fileURLToPath(new URL(`../fixtures/xacro/${name}/`, import.meta.url));
        return fs.readdirSync(dir, { recursive: true })
            .filter(rel => fs.statSync(path.join(dir, rel)).isFile())
            .map(rel => ({ path: `/${name}/${rel.split(path.sep).join('/')}`, data: fs.readFileSync(path.join(dir, rel)) }));
    });
    return { type: 'load', files, primary: '/turtlebot3_description/urdf/turtlebot3_burger.urdf' };
}

async function capturePathMatrix(onDemand) {
    const matrix = createPathMatrix();
    Object.assign(process.env, matrix.env);
    const env = loadExtension({ workspace: matrix.ws, config: matrix.config });
    env.open(matrix.primary);
    env.activate();
    while (!env.state.panels[0]?.webview.html) await sleep(20);
    env.state.panels[0].receive({ type: 'ready' });
    while (!env.lastOf('load')) await sleep(20);
    await readOnDemand(env, env.lastOf('load'), onDemand);
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
window.acquireVsCodeApi = () => ({ postMessage: m => {
  window.__out.push(m);
  if (m.type === 'readFile') (async () => {
    const data = (window.__messages ||= await (await fetch('/messages.json')).json()).onDemand[m.path];
    window.postMessage(data ? { type: 'fileData', id: m.id, data: Uint8Array.from(atob(data), c => c.charCodeAt(0)) } : { type: 'fileData', id: m.id, error: 'File not found: ' + m.path }, '*');
  })();
}, setState: s => { window.__state = s; } });
window.__send = async (name, patch) => {
  const messages = window.__messages ||= await (await fetch('/messages.json')).json();
  const message = structuredClone(messages[name]);
  if (patch) patch(message);
  message.files = message.files.map(f => (f.data == null ? f : { path: f.path, data: typeof f.data === 'string' ? Uint8Array.from(atob(f.data), c => c.charCodeAt(0)) : f.data }));
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

async function connect(port, flags = []) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-chrome-'));
    const chrome = spawn(chromeBinary, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--enable-unsafe-swiftshader', '--window-size=1400,900', ...flags, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
    const exceptions = [];
    ws.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message.result);
            pending.delete(message.id);
        }
        if (message.method === 'Runtime.exceptionThrown') {
            exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
            console.log('EXCEPTION', exceptions.at(-1)?.slice(0, 300));
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
    return { send, ev, waitFor, finalDiagnostics, close, exceptions };
}

const messages = await captureMessages();
const server = await serve(messages);
const page = await connect(server.address().port);
const { send, ev, waitFor, finalDiagnostics } = page;

// Real pointer events through CDP, so the panel's own hit testing and d3-zoom's
// listeners on the graph both see them, as with a mouse.
async function floatingPanels() {
    const TREE = 'floating-model-tree', JOINTS = 'floating-joints-panel', MARGIN = 20;
    const mouse = (type, x, y, pressed) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !pressed ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount: 1 });
    const drag = async (from, to, { release = true, steps = 6 } = {}) => {
        if (from) {
            await mouse('mouseMoved', from.x, from.y);
            await mouse('mousePressed', from.x, from.y, true);
            drag.last = from;
        }
        for (let i = 1; i <= steps; i++) {
            await mouse('mouseMoved', drag.last.x + (to.x - drag.last.x) * i / steps, drag.last.y + (to.y - drag.last.y) * i / steps, true);
            await sleep(30);
        }
        drag.last = to;
        if (release) {
            await mouse('mouseReleased', to.x, to.y);
            await sleep(600);
        }
    };
    const rectOf = id => ev(`const r = document.getElementById('${id}').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }`);
    const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance;
    const view = () => ev(`return { width: innerWidth, height: innerHeight, toolbar: document.getElementById('top-bars').getBoundingClientRect().bottom }`);
    const header = r => ({ x: r.left + 50, y: r.top + 20 });
    const midLeft = r => ({ x: r.left + 4, y: (r.top + r.bottom) / 2 });
    const midRight = r => ({ x: r.right - 4, y: (r.top + r.bottom) / 2 });
    const midTop = r => ({ x: (r.left + r.right) / 2, y: r.top + 3 });
    const midBottom = r => ({ x: (r.left + r.right) / 2, y: r.bottom - 4 });
    const graph = () => ev(`const svg = document.getElementById('model-graph-svg'), s = svg.getBoundingClientRect(), g = svg.querySelector('.zoom-container').getBoundingClientRect(), t = d3.zoomTransform(svg);
        return { dx: (g.left + g.right - s.left - s.right) / 2, dy: (g.top + g.bottom - s.top - s.bottom) / 2, inside: g.left >= s.left - 1 && g.right <= s.right + 1 && g.top >= s.top - 1 && g.bottom <= s.bottom + 1, k: t.k, centre: t.invert([s.width / 2, s.height / 2]) }`);
    const centred = g => near(g.dx, 0, 3) && near(g.dy, 0, 3) && g.inside;
    const preview = () => ev(`const p = document.querySelector('.panel-snap-preview'); if (!p || getComputedStyle(p).display === 'none') return null; const r = p.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }`);
    // What the extension stores: the last layout each panel was given.
    const stored = {};
    const collect = async () => Object.assign(stored, await ev(`return Object.fromEntries(window.__out.filter(m => m.type === 'panelLayout').map(m => [m.id, m.layout]))`));
    const cursorAt = ({ x, y }) => ev(`return getComputedStyle(document.elementFromPoint(${x}, ${y})).cursor`);

    await ev(`await window.__send('load')`);
    await waitFor(`window.app.currentModel?.links?.has('left_arm')`, 10000);

    // The joints panel has not been moved yet: a click on its header must not pin its CSS place.
    let r = await rectOf(JOINTS);
    await mouse('mouseMoved', header(r).x, header(r).y);
    await mouse('mousePressed', header(r).x, header(r).y, true);
    await mouse('mouseReleased', header(r).x, header(r).y);
    await sleep(500);
    const clicked = await ev(`return { inline: document.getElementById('${JOINTS}').style.top, saved: window.__out.some(m => m.type === 'panelLayout' && m.id === '${JOINTS}') }`);
    check('a click on an untouched panel header keeps its CSS place and saves no layout', clicked.inline === '' && !clicked.saved, JSON.stringify(clicked));

    const maximizeButton = id => `document.querySelector('.panel-maximize-btn[data-panel-id=${id}]').click()`;
    await ev(maximizeButton(JOINTS));
    await sleep(600);
    await ev(maximizeButton(JOINTS));
    await sleep(600);
    const unpinned = await ev(`return { inline: document.getElementById('${JOINTS}').style.top, saved: window.__out.filter(m => m.type === 'panelLayout' && m.id === '${JOINTS}').at(-1)?.layout }`);
    check('maximize and restore of an untouched panel keep its CSS place', unpinned.inline === '' && unpinned.saved?.maximized === false && !('left' in unpinned.saved), JSON.stringify(unpinned));

    const cssPlace = await rectOf(JOINTS);
    await ev(maximizeButton(JOINTS));
    await sleep(600);
    await ev(maximizeButton(JOINTS));
    await sleep(80);
    let moving = await rectOf(JOINTS);
    await drag(midLeft(moving), { x: moving.left - 12, y: midLeft(moving).y });
    let after = await rectOf(JOINTS);
    check('a resize started while an untouched panel restores from maximized starts from its CSS place', near(after.top, cssPlace.top) && near(after.height, cssPlace.height) && near(after.width, cssPlace.width + 15), JSON.stringify({ cssPlace, moving, after }));

    await ev(`if (!document.getElementById('toggle-model-tree').classList.contains('active')) document.getElementById('toggle-model-tree').click()`);
    await sleep(800);

    r = await rectOf(TREE);
    await drag(midRight(r), { x: r.right - 64, y: midRight(r).y });
    after = await rectOf(TREE);
    check('the tree panel resizes from its right border, also beside the graph', near(after.width, r.width - 60) && near(after.left, r.left), JSON.stringify({ r, after }));

    r = after;
    await drag(midLeft(r), { x: r.left - 146, y: midLeft(r).y });
    after = await rectOf(TREE);
    let g = await graph();
    check('an untouched graph refits as the panel grows', near(after.width, r.width + 150) && centred(g), JSON.stringify({ r, after, g }));

    r = after;
    await drag(midBottom(r), { x: midBottom(r).x, y: r.bottom + 76 });
    after = await rectOf(TREE);
    check('the tree panel resizes from its bottom border', near(after.height, r.height + 80) && near(after.top, r.top), JSON.stringify({ r, after }));

    r = after;
    await drag(midLeft(r), { x: r.right - 100, y: midLeft(r).y });
    after = await rectOf(TREE);
    check('shrinking from the left border stops at the minimum width with the right edge fixed', near(after.width, 280) && near(after.right, r.right), JSON.stringify({ r, after }));
    g = await graph();
    check('an untouched graph refits as the panel shrinks', centred(g), JSON.stringify(g));

    r = after;
    await mouse('mouseMoved', midTop(r).x, midTop(r).y);
    const topCursor = await cursorAt(midTop(r));
    await drag(midTop(r), { x: midTop(r).x, y: r.top - 57 });
    after = await rectOf(TREE);
    let v = await view();
    check('the top border shows the resize cursor and resizes up to the toolbar, also over the header', topCursor === 'ns-resize' && after.top < r.top && near(after.top, Math.max(v.toolbar, r.top - 60)) && near(after.bottom, r.bottom), JSON.stringify({ topCursor, r, after, v }));

    r = after;
    await mouse('mouseMoved', (r.left + r.right) / 2, (r.top + r.bottom) / 2 + 20);
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 + 20, deltaX: 0, deltaY: -300 });
    await sleep(300);
    const zoomed = await graph();
    await drag(midLeft(r), { x: r.left - 96, y: midLeft(r).y });
    g = await graph();
    check('a zoomed graph keeps its scale and the point at its centre as the panel resizes', near(g.k, zoomed.k, 1e-6) && near(g.centre[0], zoomed.centre[0], 1) && near(g.centre[1], zoomed.centre[1], 1) && !centred(zoomed), JSON.stringify({ zoomed, g }));

    r = await rectOf(TREE);
    const beforeMax = await graph();
    await ev(`document.querySelector('.panel-maximize-btn[data-panel-id=${TREE}]').click()`);
    await sleep(1300);
    const max = await rectOf(TREE);
    await ev(`document.querySelector('.panel-maximize-btn[data-panel-id=${TREE}]').click()`);
    await sleep(1300);
    after = await rectOf(TREE);
    g = await graph();
    check('maximize then restore gives back the panel and its view', max.width > r.width && ['left', 'top', 'width', 'height'].every(k => near(after[k], r[k])) && near(g.k, beforeMax.k, 1e-3) && near(g.centre[0], beforeMax.centre[0], 1), JSON.stringify({ r, max, after, beforeMax, g }));

    const toggled = await ev(`return window.__out.filter(m => m.type === 'panelLayout' && m.id === '${TREE}').slice(-2).map(m => m.layout)`);
    check('maximize and restore save only the flag, never this window\'s copy of the rect', JSON.stringify(toggled) === '[{"maximized":true},{"maximized":false}]', JSON.stringify(toggled));

    // Maximized again while the graph animates back to its view (450 ms + 600 ms after restore).
    await ev(maximizeButton(TREE));
    await sleep(1300);
    await ev(maximizeButton(TREE));
    await sleep(750);
    await ev(maximizeButton(TREE));
    await sleep(1300);
    await ev(maximizeButton(TREE));
    await sleep(1300);
    g = await graph();
    check('maximizing while the graph returns to its view still gives that view back', near(g.k, beforeMax.k, 1e-3) && near(g.centre[0], beforeMax.centre[0], 1) && near(g.centre[1], beforeMax.centre[1], 1), JSON.stringify({ beforeMax, g }));

    // Dragged while the show fade (200 ms) still runs: the panel must follow the pointer, not ease after it.
    await ev(`document.querySelector('.panel-close-btn[data-panel=${TREE}]').click()`);
    await sleep(400);
    await ev(`document.getElementById('toggle-model-tree').click()`);
    await sleep(30);
    r = await rectOf(TREE);
    await drag(header(r), { x: header(r).x - 150, y: header(r).y + 60 }, { release: false, steps: 12 });
    const lag = await ev(`const p = document.getElementById('${TREE}'); return { inline: parseFloat(p.style.left), shown: parseFloat(getComputedStyle(p).left) }`);
    await mouse('mouseReleased', header(r).x - 150, header(r).y + 60);
    await sleep(600);
    check('a panel dragged right after it is shown follows the pointer', near(lag.inline, lag.shown), JSON.stringify(lag));

    r = await rectOf(JOINTS);
    await drag(midLeft(r), { x: r.right - 100, y: midLeft(r).y });
    after = await rectOf(JOINTS);
    check('the joints panel shrinks from the left border to the minimum with the right edge fixed', near(after.width, 280) && near(after.right, r.right), JSON.stringify({ r, after }));
    r = after;
    await drag(midTop(r), { x: midTop(r).x, y: r.top - 57 });
    after = await rectOf(JOINTS);
    check('the joints panel resizes from its top border', near(after.top, r.top - 60) && near(after.bottom, r.bottom), JSON.stringify({ r, after }));

    r = after;
    await ev(`document.querySelector('.panel-maximize-btn[data-panel-id=${JOINTS}]').click()`);
    await sleep(700);
    await ev(`document.querySelector('.panel-maximize-btn[data-panel-id=${JOINTS}]').click()`);
    await sleep(80);
    const restoring = await rectOf(JOINTS);
    await drag(midLeft(restoring), { x: restoring.left - 37, y: midLeft(restoring).y });
    after = await rectOf(JOINTS);
    check('a resize started while the panel restores from maximized starts from its restored size', near(after.width, r.width + 40) && near(after.top, r.top) && near(after.height, r.height), JSON.stringify({ r, restoring, after }));

    // Snapping by dragging the header.
    r = await rectOf(TREE);
    await drag(header(r), { x: 600, y: 5 });
    after = await rectOf(TREE);
    check('a panel dropped over the toolbar stays below it, so its header can be grabbed', after.top >= v.toolbar, JSON.stringify({ after, v }));

    r = await rectOf(TREE);
    await drag(header(r), { x: 6, y: 420 }, { release: false });
    const dockPreview = await preview();
    await drag(null, { x: 5, y: 420 });
    after = await rectOf(TREE);
    check('dragging to the left edge previews the dock', dockPreview && near(dockPreview.left, MARGIN) && near(dockPreview.top, v.toolbar + MARGIN) && near(dockPreview.height, v.height - v.toolbar - 2 * MARGIN), JSON.stringify(dockPreview));
    check('releasing at the left edge docks the panel at full height, width kept', near(after.left, MARGIN) && near(after.top, v.toolbar + MARGIN) && near(after.height, v.height - v.toolbar - 2 * MARGIN) && near(after.width, r.width), JSON.stringify({ r, after, v }));

    const docked = after;
    await ev(`document.getElementById('top-control-bar').style.minHeight = '85px'`);
    await sleep(300);
    const tall = await view();
    const dockedTall = await rectOf(TREE);
    await ev(`document.getElementById('top-control-bar').style.minHeight = ''`);
    await sleep(300);
    check('a docked panel follows the toolbar height', tall.toolbar > v.toolbar && near(dockedTall.top, tall.toolbar + MARGIN) && near(dockedTall.bottom, tall.height - MARGIN), JSON.stringify({ tall, dockedTall }));
    await drag(header(docked), { x: v.width - 4, y: 400 }, { release: false });
    const rightPreview = await preview();
    await drag(null, { x: 700, y: 300 }, { release: false });
    const leftZone = await preview();
    await drag(null, { x: 700, y: 302 });
    after = await rectOf(TREE);
    check('the preview follows the snap zone and hides outside it', !!rightPreview && near(rightPreview.right, v.width - MARGIN) && leftZone === null, JSON.stringify({ rightPreview, leftZone }));
    check('a docked panel dragged away gets its size from before docking', near(docked.height, v.height - v.toolbar - 2 * MARGIN) && near(after.width, r.width) && near(after.height, r.height), JSON.stringify({ r, docked, after }));

    r = after;
    const half = Math.floor((v.height - v.toolbar - 3 * MARGIN) / 2);
    await drag(header(r), { x: v.width - 5, y: v.height - 150 }, { release: false });
    const alongEdge = await preview();
    check('along the right edge, 150 px above the corner, the corner is previewed', alongEdge && near(alongEdge.right, v.width - MARGIN) && near(alongEdge.bottom, v.height - MARGIN) && near(alongEdge.height, Math.min(r.height, half)), JSON.stringify({ alongEdge, v }));
    await drag(null, { x: v.width - 5, y: v.height - 5 });
    after = await rectOf(TREE);
    check('releasing in a corner snaps the panel flush to it, width kept and at most half the height', near(after.right, v.width - MARGIN) && near(after.bottom, v.height - MARGIN) && near(after.width, r.width) && near(after.height, Math.min(r.height, half)), JSON.stringify({ r, after, v, half }));

    r = after;
    await drag(midTop(r), { x: midTop(r).x, y: 5 });
    await drag(header(await rectOf(TREE)), { x: v.width - 5, y: 5 });
    after = await rectOf(TREE);
    check('a tall panel snapped to a top corner fits between the toolbar and the bottom', near(after.top, v.toolbar + MARGIN) && after.bottom <= v.height - MARGIN + 1 && near(after.right, v.width - MARGIN), JSON.stringify({ after, v }));

    r = after;
    await drag(header(r), { x: 700, y: 300 }, { release: false });
    const held = await rectOf(TREE);
    await send('Emulation.setDeviceMetricsOverride', { width: 1380, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const heldAfterResize = await rectOf(TREE);
    await drag(null, { x: 702, y: 300 });
    await send('Emulation.clearDeviceMetricsOverride');
    await sleep(300);
    check('a window resize during a drag leaves the panel under the pointer', near(heldAfterResize.left, held.left) && near(heldAfterResize.top, held.top), JSON.stringify({ held, heldAfterResize }));

    r = await rectOf(TREE);
    await drag(header(r), { x: header(r).x - 100, y: header(r).y + 40 }, { release: false });
    const lost = await rectOf(TREE);
    for (const step of [1, 2, 3]) await mouse('mouseMoved', header(r).x - 100 - 40 * step, header(r).y + 40);
    await sleep(100);
    const afterLost = await rectOf(TREE);
    await mouse('mouseReleased', header(r).x - 220, header(r).y + 40);
    await sleep(600);
    check('a drag ends when the button was released outside the view', near(afterLost.left, lost.left), JSON.stringify({ lost, afterLost }));

    r = await rectOf(TREE);
    await drag(header(r), { x: v.width - 5, y: 400 });
    r = await rectOf(TREE);
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, deltaX: 0, deltaY: -200 });
    await sleep(300);
    const zoomedDocked = await graph();
    await ev(`document.querySelector('.panel-close-btn[data-panel=${TREE}]').click()`);
    await sleep(400);
    await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 640, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    await ev(`document.getElementById('toggle-model-tree').click()`);
    await sleep(500);
    g = await graph();
    check('a zoomed graph whose panel changed size while hidden keeps its centre point', near(g.k, zoomedDocked.k, 1e-6) && near(g.centre[0], zoomedDocked.centre[0], 1) && near(g.centre[1], zoomedDocked.centre[1], 1), JSON.stringify({ zoomedDocked, g }));
    const small = await view();
    after = await rectOf(TREE);
    check('a right-docked panel stays docked at full height when the view shrinks', near(after.right, small.width - MARGIN) && near(after.top, small.toolbar + MARGIN) && near(after.height, small.height - small.toolbar - 2 * MARGIN), JSON.stringify({ after, small }));
    await send('Emulation.clearDeviceMetricsOverride');
    await sleep(500);

    // Layout survives a new page: free tree panel, maximized joints panel.
    r = await rectOf(TREE);
    await drag(header(r), { x: 600, y: 300 });
    r = await rectOf(TREE);
    await drag(midBottom(r), { x: midBottom(r).x, y: r.bottom + 96 });
    await ev(`document.querySelector('.panel-maximize-btn[data-panel-id=${JOINTS}]').click()`);
    await sleep(1000);
    let tree = await rectOf(TREE);
    await collect();
    const saved = await ev(`return window.__out.filter(m => m.type === 'settings').at(-1)?.settings`);
    check('a moved panel and the maximized state are saved', !!stored[TREE] && near(stored[TREE].left, tree.left) && near(stored[TREE].height, tree.height) && stored[JOINTS]?.maximized === true, JSON.stringify(stored));

    const reload = async () => {
        await send('Page.reload');
        await sleep(300);
        await waitFor(`window.__out?.some(m => m.type === 'ready')`);
    };
    const sendLoad = () => ev(`window.__send('load', m => { m.settings = ${JSON.stringify(saved)}; m.panels = ${JSON.stringify(stored)}; })`);
    const reopen = async () => {
        await reload();
        await sendLoad();
        await waitFor(`window.app.currentModel?.links?.has('left_arm')`, 10000);
        await sleep(800);
    };
    await reopen();
    after = await rectOf(TREE);
    check('a new page opens the panels where they were left', ['left', 'top', 'width', 'height'].every(k => near(after[k], tree[k])) && await ev(`return document.getElementById('${JOINTS}').classList.contains('maximized')`), JSON.stringify({ tree, after }));

    // Held at the parser, so the panel is moved before the first load finishes.
    await reload();
    await ev(`const fileHandler = window.app.fileHandler, load = fileHandler.loadPrimary.bind(fileHandler);
        const gate = new Promise(resolve => { window.__open = resolve; });
        fileHandler.loadPrimary = async (...args) => { await gate; return load(...args); };`);
    await sendLoad();
    await sleep(600);
    r = await rectOf(TREE);
    await drag(header(r), { x: 500, y: 350 });
    tree = await rectOf(TREE);
    await ev(`window.__open()`);
    await waitFor(`window.app.currentModel?.links?.has('left_arm')`, 10000);
    await sleep(500);
    await collect();
    await reopen();
    after = await rectOf(TREE);
    check('a panel moved while the model loads comes back on the next page', near(tree.left, 450, 60) && ['left', 'top', 'width', 'height'].every(k => near(after[k], tree[k])), JSON.stringify({ tree, after }));

    await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 420, deviceScaleFactor: 1, mobile: false });
    await reopen();
    v = await view();
    after = await rectOf(TREE);
    check('a panel saved in a bigger view opens inside a smaller one, shrunk to fit', after.left >= 0 && after.top >= 0 && after.right <= v.width && after.bottom <= v.height && near(after.width, tree.width) && near(after.height, v.height - v.toolbar - 2 * MARGIN), JSON.stringify({ after, v }));
    await drag(header(after), { x: header(after).x - 60, y: header(after).y + 10 });
    await send('Emulation.clearDeviceMetricsOverride');
    await sleep(500);
    after = await rectOf(TREE);
    check('a panel moved while shrunk to fit grows back when the view does', near(after.height, tree.height) && near(after.width, tree.width), JSON.stringify({ tree, after }));
}

try {
    const panelsHidden = `['floating-joints-panel','floating-model-tree'].every(id => getComputedStyle(document.getElementById(id)).display === 'none')`;
    check('ready posted', await waitFor(`window.__out?.some(m => m.type === 'ready')`));
    check('zh-TW from <html lang>', await ev(`return window.i18n.getCurrentLanguage() === 'zh-TW' && document.getElementById('toggle-joints-panel').textContent.trim() === '關節'`));
    check('panels closed by default', await ev(`return ${panelsHidden}`));

    await ev(`await window.__send('load', m => { m.settings = { 'show-visual': false, 'show-collision': true, unit: 'deg' }; })`);
    check('model loads with both packages', await waitFor(`window.app.currentModel?.links?.has('left_arm') && window.app.currentModel.links.has('lift_link')`));
    check('STL without normals is shaded', await ev(`let n; window.app.currentModel.links.get('left_arm').threeObject.traverse(o => { if (!n && o.isMesh) n = o.geometry.attributes.normal; }); return !!n && Array.from(n.array).some(v => v !== 0)`));
    await sleep(800);
    check('loading indicator hidden after load', await ev(`return getComputedStyle(document.getElementById('loading-indicator')).display === 'none'`));
    check('settings applied, panels still closed', await ev(`return document.getElementById('show-collision').classList.contains('active') && window.app.angleUnit === 'deg' && ${panelsHidden}`));
    check('visuals start on even if an older version saved them off', await ev(`return document.getElementById('show-visual').classList.contains('active') && window.app.sceneManager.visualizationManager.showVisual`));
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
    check('panel toggle saved as setting', settings?.['toggle-joints-panel'] === true && settings['show-collision'] === true && !('show-visual' in settings), JSON.stringify(settings));

    const grid = await ev(`const btn = document.getElementById('toggle-grid'); btn.click(); const hidden = !window.app.sceneManager.referenceGrid.visible; btn.click();
        return { hidden, shown: window.app.sceneManager.referenceGrid.visible, label: btn.textContent.trim() };`);
    check('grid button hides and shows the horizon grid', grid.hidden && grid.shown && grid.label === '格線', JSON.stringify(grid));
    const up = await ev(`document.getElementById('up-menu-btn').click(); document.querySelector('[data-up="+Y"]').click();
        const after = { label: document.getElementById('up-label').textContent, select: document.getElementById('up-select').value, closed: !document.getElementById('up-menu').classList.contains('open'), expanded: document.getElementById('up-menu-btn').getAttribute('aria-expanded') };
        document.getElementById('up-menu-btn').click(); document.querySelector('[data-up="+Z"]').click(); return after;`);
    check('up menu sets the axis and closes', up.label === '+Y' && up.select === '+Y' && up.closed && up.expanded === 'false', JSON.stringify(up));
    const gap = await ev(`const button = document.getElementById('display-menu-btn'); button.click();
        const b = button.getBoundingClientRect(), m = document.getElementById('display-menu').getBoundingClientRect(); document.body.click();
        return { below: m.top - b.bottom, left: m.left - b.left };`);
    check('a menu opens 4 px below its button, left edges lined up', Math.abs(gap.below - 4) < 0.5 && Math.abs(gap.left) < 0.5, JSON.stringify(gap));
    const info = await ev(`document.getElementById('info-btn').click(); const text = document.getElementById('info-table').innerText; document.body.click(); return text;`);
    check('info lists the robot', /robot_a\.urdf\.xacro/.test(info) && /Xacro/.test(info) && /Links/.test(info) && /尺寸/.test(info), JSON.stringify(info));
    const esc = await ev(`const highlight = window.app.sceneManager.highlightManager; let cleared = false; const clear = highlight.clearHighlight.bind(highlight);
        highlight.clearHighlight = () => { cleared = true; return clear(); }; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); highlight.clearHighlight = clear; return cleared;`);
    check('Esc clears the selection', esc);

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

    await ev(`await window.__send('xacro')`);
    check('a .urdf containing xacro is expanded', await waitFor(`window.app.currentModel?.links?.has('base_footprint') && window.app.currentModel.links.has('caster_back_link')`, 15000));
    await ev(`await window.__send('xacro', m => { m.primary = '/pmb2_description/robots/pmb2.urdf.xacro'; })`);
    check('PMB2 with not in loads', await waitFor(`window.app.currentModel?.links?.has('base_footprint') && window.app.currentModel.joints.size > 5`, 15000));
    await ev(`await window.__send('xacro', m => { m.primary = '/xarm_description/urdf/xarm_device.urdf.xacro'; })`);
    check('xArm with len() and >= loads', await waitFor(`window.app.currentModel?.links?.has('link_eef')`, 15000));
    await ev(`await window.__send('xacro', m => { m.primary = '/kortex_description/robots/gen3.xacro'; m.xacroArgs = { dof: '7' }; })`);
    check('Kinova Gen3 with dict() defaults loads', await waitFor(`window.app.currentModel?.links?.has('end_effector_link')`, 15000));
    for (const [name, expected] of [['vendor', ['True False', 'True 1300', 'b2 3', 'True', '0.5']], ['python', ['True False True False True False False True True True', 'arm_link arm_joint armarm a m', 'arm_7 0.25 7% True True', '4 [2, 3] [0, 1, 2] 8 3 True']]]) {
        await ev(`window.app.currentModel = null; await window.__send('xacro', m => { m.primary = '/expressions/${name}.urdf.xacro'; })`);
        await waitFor(`window.app.currentModel?.links?.has('checks')`, 15000);
        const values = await ev(`return Array.from(window.app.currentModel.expandedUrdf.matchAll(/<check name="\\w+" value="([^"]*)"/g), m => m[1])`);
        check(`expressions/${name} evaluates as xacro in Chrome`, expected.every(value => values?.includes(value)), JSON.stringify(values));
    }
    await ev(`window.__out.length = 0`);
    await finalDiagnostics(15000);
    await ev(`window.__out.length = 0; await window.__send('xacro', m => { const f = m.files.find(f => f.path === m.primary); f.data = btoa(atob(f.data).replace('<link name="\${namespace}base_footprint"/>', '<link name="\${[x for x in [1]] if 1 &lt;= 2 else 0}"/>')); })`);
    const xacroDiagnostics = await finalDiagnostics(15000);
    check('an unsupported expression points at its line, as written', xacroDiagnostics?.loadErrorLocation?.key === '/turtlebot3_description/urdf/turtlebot3_burger.urdf' && xacroDiagnostics.loadErrorLocation.line === 49
        && xacroDiagnostics.loadError.includes('${[x for x in [1]] if 1 <= 2 else 0}') && /comprehension/.test(xacroDiagnostics.loadError), JSON.stringify(xacroDiagnostics));

    await ev(`document.body.classList.add('vscode-light')`);
    check('theme follows VS Code', await waitFor(`document.documentElement.getAttribute('data-theme') === 'light'`, 3000));
    await ev(`document.body.classList.remove('vscode-light')`);

    await ev(`await window.__send('load', m => { m.files = m.files.filter(f => f.path.endsWith('arm.stl')).map(f => ({ path: '/mesh/arm.stl', data: window.__messages.onDemand[f.path] })); m.primary = '/mesh/arm.stl'; })`);
    check('mesh preview', await waitFor(`window.app.currentModel?.isMesh === true`, 10000));
    check('mesh preview follows the up menu', await ev(`return window.app.currentModel.threeObject.parent === window.app.sceneManager.world && document.getElementById('up-select').value === '+Z'`));

    // A triangle 1 tall along the file's Z: upright on screen unless the file declares Y_UP.
    const dae = up => `<?xml version="1.0"?><COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset>${up}</asset><library_geometries><geometry id="g"><mesh><source id="p"><float_array id="pa" count="9">0 0 0 0.1 0 0 0 0 1</float_array><technique_common><accessor source="#pa" count="3" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="v"><input semantic="POSITION" source="#p"/></vertices><triangles count="1"><input semantic="VERTEX" source="#v" offset="0"/><p>0 1 2</p></triangles></mesh></geometry></library_geometries><library_visual_scenes><visual_scene id="s"><node id="n"><instance_geometry url="#g"/></node></visual_scene></library_visual_scenes><scene><instance_visual_scene url="#s"/></scene></COLLADA>`;
    const heights = [];
    for (const [i, up] of ['<up_axis>Z_UP</up_axis>', '', '<up_axis>Y_UP</up_axis>'].entries()) {
        await ev(`window.postMessage({ type: 'load', files: [{ path: '/d/t${i}.dae', data: new TextEncoder().encode(${JSON.stringify(dae(up))}) }], primary: '/d/t${i}.dae' }, '*')`);
        await waitFor(`window.app.currentModel?.name === 't${i}.dae'`, 10000);
        heights.push(await ev(`return (o => { o.updateMatrixWorld(true); const b = window.app.sceneManager.getModelBoundingBox(o); return +(b.max.y - b.min.y).toFixed(2); })(window.app.currentModel.threeObject)`));
    }
    check('DAE up_axis is put in the Z-up frame', JSON.stringify(heights) === '[1,1,0]', JSON.stringify(heights));

    const mjcf = '<mujoco model="t"><worldbody><light pos="0 0 3"/><geom type="plane" size="2 2 .1"/><body name="arm" pos="0 0 1"><joint name="hinge" type="hinge" axis="0 1 0"/><geom type="capsule" fromto="0 0 0 .5 0 0" size=".05"/></body></worldbody></mujoco>';
    await ev(`window.postMessage({ type: 'load', files: [{ path: '/t/t.xml', data: new TextEncoder().encode(${JSON.stringify(mjcf)}) }], primary: '/t/t.xml' }, '*')`);
    check('MJCF loads', await waitFor(`window.app.currentModel?.joints?.has('hinge')`, 15000));
    await sleep(500); // the bar slides in
    const bars = await ev(`const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
        return { toolbar: rect('top-control-bar'), sim: rect('mujoco-simulation-bar'), row: rect('top-bars') }`);
    check('the simulation bar sits beside the toolbar, not over the model, and panels stay below both', bars.sim.top === bars.toolbar.top && bars.sim.left > bars.toolbar.right && bars.row.bottom >= bars.sim.bottom, JSON.stringify(bars));
    const narrow = await ev(`const bar = document.getElementById('top-bars'); bar.style.right = (innerWidth - document.getElementById('top-control-bar').getBoundingClientRect().right - 10) + 'px';
        await new Promise(r => setTimeout(r, 300)); const sim = document.getElementById('mujoco-simulation-bar').getBoundingClientRect(), tb = document.getElementById('top-control-bar').getBoundingClientRect();
        const result = { simTop: sim.top, toolbarBottom: tb.bottom, panelTop: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--toolbar-bottom')) };
        bar.style.right = ''; return result;`);
    check('without room the simulation bar wraps below the toolbar and panels move below it', narrow.simTop >= narrow.toolbarBottom && narrow.panelTop >= narrow.simTop + 20, JSON.stringify(narrow));
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

    // The top-left pixel of the view, an empty corner above the framed box.
    const corner = async () => ev(`const sm = window.app.sceneManager, r = sm.renderer, gl = r.getContext(), px = new Uint8Array(4);
        r.render(sm.scene, sm.camera); gl.readPixels(0, gl.drawingBufferHeight - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return Array.from(px.slice(0, 3)).join()`);
    const cornerBecomes = async (expected, ms = 5000) => {
        const start = Date.now();
        let last;
        while ((last = await corner()) !== expected && Date.now() - start < ms) await sleep(100);
        return last;
    };
    await ev(`window.postMessage({ type: 'load', files: [{ path: '/b/b.urdf', data: new TextEncoder().encode(${JSON.stringify(box)}) }], primary: '/b/b.urdf', background: '#204060' }, '*')`);
    const fixed = await cornerBecomes('32,64,96');
    await ev(`document.body.classList.add('vscode-light')`);
    await waitFor(`document.documentElement.getAttribute('data-theme') === 'light'`, 3000);
    const fixedLight = await corner();
    check('a background color from the load is drawn and kept through a theme change', fixed === '32,64,96' && fixedLight === '32,64,96', JSON.stringify({ fixed, fixedLight }));
    await ev(`window.__out.length = 0; document.getElementById('screenshot-btn').click()`);
    await waitFor(`window.__out.some(m => m.type === 'screenshot')`, 5000);
    const shotCorner = await ev(`const image = new Image(); image.src = 'data:image/png;base64,' + window.__out.find(m => m.type === 'screenshot').data; await image.decode();
        const context = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height }).getContext('2d'); context.drawImage(image, 0, 0);
        return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3)).join()`);
    check('the screenshot has the background color', shotCorner === '32,64,96', shotCorner);
    await ev(`window.postMessage({ type: 'background', background: 'theme' }, '*')`);
    const themeLight = await cornerBecomes('255,255,255');
    await ev(`document.body.classList.remove('vscode-light')`);
    const themeDark = await cornerBecomes('80,80,80');
    check('a background change back to theme follows the theme again', themeLight === '255,255,255' && themeDark === '80,80,80', JSON.stringify({ themeLight, themeDark }));

    const flawed = '<robot name="f"><link name="base"/><link name="arm"><visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual></link><joint name="j" type="revolute"><parent link="base"/><child link="arm"/><axis xyz="0 0 1"/></joint></robot>';
    await ev(`window.__out.length = 0; window.postMessage({ type: 'load', files: [{ path: '/f/f.urdf', data: new TextEncoder().encode(${JSON.stringify(flawed)}) }], primary: '/f/f.urdf' }, '*')`);
    const checks = (await finalDiagnostics()).checks.map(c => c.rule + ':' + c.name).sort();
    check('a later load sends one report, no partial one first', await ev(`return !window.__out.some(m => m.type === 'diagnostics' && m.partial)`));
    check('model checks run on the loaded robot', JSON.stringify(checks) === JSON.stringify(['missing-inertial:arm', 'missing-limit:j']), JSON.stringify(checks));

    // SketchUp-exported DAE such as RealSense d435.dae carry no normals and render black under lit materials.
    const noNormalsDae = dae('');
    const daeUrdf = '<robot name="n"><link name="l"><visual><geometry><mesh filename="package://n/m.dae"/></geometry></visual></link></robot>';
    await ev(`window.postMessage({ type: 'load', files: [{ path: '/n/n.urdf', data: new TextEncoder().encode(${JSON.stringify(daeUrdf)}) }, { path: '/n/m.dae', data: new TextEncoder().encode(${JSON.stringify(noNormalsDae)}) }], primary: '/n/n.urdf' }, '*')`);
    check('a DAE without normals gets them', await waitFor(`(() => { let ok = false; window.app.currentModel?.threeObject?.traverse(o => { if (o.isMesh && o.geometry.attributes.normal) ok = true; }); return ok; })()`, 5000));

    // Only what is on screen answers the pointer. The collision box reaches past the end of the visual box; `tip` is
    // a point there, on collision geometry only, with no visual behind it.
    const arm = '<robot name="h"><link name="base"/><link name="arm"><visual><origin xyz="0.25 0 0"/><geometry><box size="0.3 0.1 0.1"/></geometry></visual><collision><origin xyz="0.25 0 0"/><geometry><box size="0.4 0.2 0.2"/></geometry></collision></link><joint name="j" type="revolute"><parent link="base"/><child link="arm"/><origin xyz="0 0 0.3"/><axis xyz="0 0 1"/><limit lower="-3" upper="3" effort="1" velocity="1"/></joint></robot>';
    await ev(`window.postMessage({ type: 'load', files: [{ path: '/h/h.urdf', data: new TextEncoder().encode(${JSON.stringify(arm)}) }], primary: '/h/h.urdf' }, '*')`);
    await waitFor(`window.app.currentModel?.joints?.has('j')`, 10000);
    await sleep(500);
    // A press that grabs nothing orbits the camera, so every hover and drag starts from the same view.
    const view = () => ev(`const sm = window.app.sceneManager; sm.camera.position.set(0.25, -0.8, 0.9); sm.controls.target.set(0.25, 0, 0.3); sm.controls.update(); sm.camera.updateMatrixWorld();`);
    await view();
    const [middle, tip] = await ev(`
        const sm = window.app.sceneManager, link = window.app.currentModel.links.get('arm').threeObject, r = sm.renderer.domElement.getBoundingClientRect();
        window.app.currentModel.threeObject.updateMatrixWorld(true);
        return [0.25, 0.43].map(along => {
            const v = link.localToWorld(sm.camera.position.clone().set(along, 0, 0)).project(sm.camera);
            const x = Math.round(r.left + (v.x + 1) / 2 * r.width), y = Math.round(r.top + (1 - v.y) / 2 * r.height);
            return { x, y, onCanvas: document.elementFromPoint(x, y) === sm.renderer.domElement };
        });`);
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? (buttons ? 'left' : 'none') : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const hover = async at => {
        await view();
        await mouse('mouseMoved', 5, 5);
        await mouse('mouseMoved', at.x, at.y);
        await sleep(100);
        return ev(`return window.app.sceneManager.highlightManager.currentHighlightedLink?.name || null`);
    };
    const drag = async at => {
        await ev(`window.app.poseController.setJointValue('j', 0)`);
        await view();
        await mouse('mouseMoved', at.x, at.y);
        await mouse('mousePressed', at.x, at.y, 1);
        for (let i = 1; i <= 6; i++) await mouse('mouseMoved', at.x, at.y - i * 10, 1);
        await mouse('mouseReleased', at.x, at.y - 60);
        await sleep(100);
        const moved = await ev(`return window.app.poseController.getJointValue('j')`);
        await ev(`window.app.poseController.setJointValue('j', 0)`);
        return moved;
    };
    const display = (id, on) => ev(`const b = document.getElementById('${id}'); if (b.classList.contains('active') !== ${on}) b.click();`);
    await display('show-visual', true);
    await display('show-collision', false);
    check('the pointer targets are on the canvas and the shown visual is hovered', middle.onCanvas && tip.onCanvas && await hover(middle) === 'arm', JSON.stringify({ middle, tip }));
    await display('show-visual', false);
    check('a hidden visual is not hovered', await hover(middle) === null);
    await display('show-collision', true);
    const collision = { hover: await hover(tip), drag: await drag(tip) };
    check('with only collision shown, hovering it highlights its link and a drag moves its joint', collision.hover === 'arm' && Math.abs(collision.drag) > 0.05, JSON.stringify(collision));
    await display('show-visual', true);
    await hover(middle);
    const picked = await ev(`
        const r = window.app.sceneManager.renderer.domElement.getBoundingClientRect();
        const hit = window.app.pickMesh({ x: (${middle.x} - r.left) / r.width * 2 - 1, y: 1 - (${middle.y} - r.top) / r.height * 2 });
        let collision = false;
        for (let o = hit?.object; o; o = o.parent) collision ||= Boolean(o.isURDFCollider);
        return { hit: !!hit, collision };`);
    check('with both shown, the visual seen through the collision shell is what is picked', picked.hit && !picked.collision, JSON.stringify(picked));
    await display('show-visual', false);
    await display('show-collision', false);
    const none = { hover: await hover(middle), drag: await drag(middle) };
    check('with visual and collision hidden, nothing is hovered or dragged', none.hover === null && none.drag === 0, JSON.stringify(none));
    await display('show-visual', true);

    // The info card sits beside the pointer, flipped near the window's edges. The arrow button turns picking off
    // altogether, as in the USD viewer, and is kept.
    const card = () => ev(`const el = document.getElementById('hover-info'), r = el.getBoundingClientRect();
        return { visible: el.classList.contains('visible'), left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };`);
    // The card waits for the pointer to rest 500 ms; moving on the link keeps restarting the wait.
    await hover(middle);
    const early = (await card()).visible;
    for (let i = 0; i < 8; i++) {
        await mouse('mouseMoved', middle.x + (i % 2 ? 2 : -2), middle.y);
        await sleep(100);
    }
    const moving = (await card()).visible;
    await mouse('mouseMoved', middle.x, middle.y);
    await sleep(650);
    const beside = await card();
    check('the hover info stays closed while the pointer moves and opens once it rests', !early && !moving && beside.visible, JSON.stringify({ early, moving, rested: beside.visible }));
    check('the hover info opens below-right of the pointer, as a right-click menu does', beside.visible && beside.left === middle.x + 4 && beside.top === middle.y + 4, JSON.stringify({ beside, middle }));
    await mouse('mouseMoved', middle.x + 8, middle.y + 3);
    await sleep(100);
    const stayed = await card();
    check('moving on the same link leaves the card where it opened', stayed.visible && stayed.left === beside.left && stayed.top === beside.top, JSON.stringify({ beside, stayed }));
    const flipped = await ev(`const hm = window.app.sceneManager.highlightManager, el = document.getElementById('hover-info');
        hm.pointer = { x: innerWidth - 10, y: innerHeight - 10 }; hm.placeHoverInfo(el);
        const r = el.getBoundingClientRect(); return { right: Math.round(r.right), bottom: Math.round(r.bottom), x: innerWidth - 10, y: innerHeight - 10 };`);
    check('near the bottom-right corner it flips above-left of the pointer', flipped.right === flipped.x - 4 && flipped.bottom === flipped.y - 4, JSON.stringify(flipped));
    // Right after one closes the next opens at once; after a pause the wait is back.
    await mouse('mouseMoved', 5, 5);
    await mouse('mouseMoved', middle.x, middle.y);
    await sleep(100);
    const warm = (await card()).visible;
    await mouse('mouseMoved', 5, 5);
    await sleep(500);
    await mouse('mouseMoved', middle.x, middle.y);
    await sleep(100);
    const cold = (await card()).visible;
    check('within 300 ms of the info closing the next opens at once, later it waits again', warm && !cold, JSON.stringify({ warm, cold }));
    await ev(`window.__out.length = 0; document.getElementById('pick-btn').click()`);
    const cleared = await ev(`return window.app.sceneManager.highlightManager.currentHighlightedLink === null && !document.getElementById('hover-info').classList.contains('visible')`);
    const off = { cleared, hover: await hover(middle), card: (await card()).visible, drag: await drag(middle) };
    await mouse('mousePressed', middle.x, middle.y, 1);
    await mouse('mouseReleased', middle.x, middle.y);
    await sleep(100);
    off.revealed = await ev(`return window.__out.some(m => m.type === 'reveal')`);
    check('with picking off, nothing is hovered, dragged or revealed by a click', off.cleared && off.hover === null && !off.card && off.drag === 0 && !off.revealed, JSON.stringify(off));
    await sleep(400);
    check('the picking choice is saved', await ev(`return window.__out.findLast(m => m.type === 'settings')?.settings['pick-btn'] === false`));
    await ev(`document.getElementById('pick-btn').click()`);
    const back = await hover(middle);
    await sleep(600);
    check('turned back on, hovering shows the card again', back === 'arm' && (await card()).visible);

    // A MuJoCo floor is not hovered or clicked, but double-click can still put the orbit pivot on it.
    const floorScene = '<mujoco model="fl"><asset><texture name="grid" type="2d" builtin="checker" rgb1=".1 .2 .3" rgb2=".2 .3 .4" width="64" height="64"/><material name="grid" texture="grid" texrepeat="4 4"/></asset><worldbody><light pos="0 0 3"/><geom name="floor" type="plane" size="2 2 .1" material="grid"/><body name="arm" pos="0 0 .5"><joint name="hinge" type="hinge" axis="0 1 0"/><geom type="box" pos=".3 0 0" size=".1 .1 .1"/></body></worldbody></mujoco>';
    await ev(`window.postMessage({ type: 'load', files: [{ path: '/fl/fl.xml', data: new TextEncoder().encode(${JSON.stringify(floorScene)}) }], primary: '/fl/fl.xml' }, '*')`);
    await waitFor(`window.app.currentModel?.joints?.has('hinge')`, 15000);
    await sleep(500);
    // The view is Y-up; the floor's own frame gives a point on it, seen from above.
    const floorAt = await ev(`const sm = window.app.sceneManager, r = sm.renderer.domElement.getBoundingClientRect();
        let floor; window.app.currentModel.threeObject.traverse(o => { if (o.userData.isGroundPlane) floor = o; });
        sm.camera.position.set(0, 2.5, 3); sm.controls.target.set(0, 0, 0); sm.controls.update(); sm.camera.updateMatrixWorld();
        window.app.currentModel.threeObject.updateMatrixWorld(true);
        const v = floor.localToWorld(new sm.camera.position.constructor(1.2, -0.8, 0)).project(sm.camera);
        return { x: Math.round(r.left + (v.x + 1) / 2 * r.width), y: Math.round(r.top + (1 - v.y) / 2 * r.height) };`);
    await mouse('mouseMoved', 5, 5);
    await mouse('mouseMoved', floorAt.x, floorAt.y);
    await sleep(100);
    const floorLit = await ev(`let floor; window.app.currentModel.threeObject.traverse(o => { if (o.userData.isGroundPlane) floor = o; });
        const m = floor.material, hm = window.app.sceneManager.highlightManager;
        const r = window.app.sceneManager.renderer.domElement.getBoundingClientRect();
        const hit = window.app.pickMesh({ x: (${floorAt.x} - r.left) / r.width * 2 - 1, y: 1 - (${floorAt.y} - r.top) / r.height * 2 });
        return { link: hm.currentHighlightedLink?.name, hitGround: Boolean(hit?.object.userData.isGroundPlane), at: ${JSON.stringify(floorAt)}, white: m === hm.highlightMaterial, map: Boolean(m.map), glow: m.emissiveIntensity };`);
    await ev(`window.__out.length = 0`);
    await mouse('mousePressed', floorAt.x, floorAt.y, 1);
    await mouse('mouseReleased', floorAt.x, floorAt.y);
    await sleep(100);
    floorLit.revealed = await ev(`return window.__out.some(m => m.type === 'reveal')`);
    check('the MJCF floor is not hovered or clicked, but stays a pivot target', !floorLit.link && !floorLit.white && !floorLit.revealed && floorLit.hitGround, JSON.stringify(floorLit));

    // Simulating draws the floor with its texture, Pause keeps the simulated pose, Reset returns to the model.
    await mouse('mouseMoved', 5, 5);
    await ev(`document.getElementById('mujoco-simulate-btn-bar').click()`);
    await waitFor(`window.app.mujocoSimulationManager.isSimulationRunning()`, 30000);
    await sleep(800);
    const simulated = await ev(`const sim = window.app.mujocoSimulationManager, planes = [];
        sim.mujocoRoot.traverse(o => { if (o.isMesh && o.geometry.type === 'PlaneGeometry') planes.push(o); });
        const p = planes[0], box = p && new p.geometry.boundingBox.constructor().setFromObject(p);
        return { planes: planes.length, map: Boolean(p?.material.map), flat: box ? +(box.max.y - box.min.y).toFixed(3) : null, width: box ? +(box.max.x - box.min.x).toFixed(2) : null };`);
    check('a simulated MJCF floor is a flat plane with its texture', simulated.planes === 1 && simulated.map && simulated.flat === 0 && simulated.width === 4, JSON.stringify(simulated));
    const simPose = () => ev(`const q = window.app.mujocoSimulationManager.bodies[1].quaternion; return [q.x, q.y, q.z, q.w].map(v => +v.toFixed(4)).join(',')`);
    await ev(`document.getElementById('mujoco-simulate-btn-bar').click()`);
    const paused = await ev(`const sim = window.app.mujocoSimulationManager; return { root: sim.mujocoRoot.visible, model: window.app.currentModel.threeObject.visible, running: sim.isSimulationRunning() }`);
    const frozen = [await simPose()];
    await sleep(300);
    frozen.push(await simPose());
    // The arm starts level (identity) and swings down under gravity, so a frozen pose has turned away from identity.
    const swung = Math.abs(Number(frozen[0].split(',')[3])) < 0.999;
    check('Pause keeps the simulated pose on screen, frozen', paused.root && !paused.model && !paused.running && frozen[0] === frozen[1] && swung, JSON.stringify({ paused, frozen }));
    await ev(`document.getElementById('mujoco-reset-btn-bar').click()`);
    const reset = await ev(`const sim = window.app.mujocoSimulationManager; return { root: sim.mujocoRoot.visible, model: window.app.currentModel.threeObject.visible, time: sim.isOldAPI ? sim.data.time : sim.simulation.time }`);
    check('Reset while paused shows the model again and rewinds the physics', !reset.root && reset.model && reset.time === 0, JSON.stringify(reset));

    // #24: a lost context says so in the view, and a restored one draws the same picture again.
    {
        await ev(`window.postMessage({ type: 'load', files: [{ path: '/b/b.urdf', data: new TextEncoder().encode(${JSON.stringify(box)}) }], primary: '/b/b.urdf' }, '*')`);
        await waitFor(`window.app.currentModel?.links?.has('base') && !window.app.mujocoSimulationManager.isSimulationRunning()`, 10000);
        const pixels = `const sm = window.app.sceneManager, gl = sm.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4);
            sm.render(); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf); return Array.from(buf.filter((v, i) => i % 64 === 0));`;
        const before = await ev(pixels);
        const message = () => ev(`const box = document.getElementById('load-error'); return box?.checkVisibility() ? box.textContent : ''`);
        await ev(`window.__lose = window.app.sceneManager.renderer.getContext().getExtension('WEBGL_lose_context'); window.__lose.loseContext()`);
        await sleep(500);
        // A load while the context is lost, as after a save, must not clear the message.
        await ev(`window.postMessage({ type: 'load', files: [{ path: '/b/b.urdf', data: new TextEncoder().encode(${JSON.stringify(box)}) }], primary: '/b/b.urdf' }, '*')`);
        await sleep(1500);
        const lost = await message();
        await ev(`window.__lose.restoreContext()`);
        await sleep(1000);
        const after = await ev(pixels);
        const restored = await message();
        const changed = before.filter((v, i) => Math.abs(v - after[i]) > 8).length / before.length;
        check('a lost context says so, and a restored one draws the model again', /GPU/.test(lost) && !restored && changed < 0.01, JSON.stringify({ lost, restored, changed }));
    }

    // #28: the RViz parity fixture in Chrome; SHOTS=<dir> keeps rviz-parity.png to compare by eye with its comments.
    {
        const dir = fileURLToPath(new URL('../fixtures/rviz-parity/', import.meta.url));
        const files = ['robot.urdf', 'meshes/Wedge.STL', 'meshes/wedge.gltf'].map(rel => ({ path: `/rviz_parity/${rel}`, data: fs.readFileSync(path.join(dir, rel)).toString('base64') }));
        await ev(`window.postMessage({ type: 'load', files: ${JSON.stringify(files)}.map(f => ({ path: f.path, data: Uint8Array.from(atob(f.data), c => c.charCodeAt(0)) })), primary: '/rviz_parity/robot.urdf' }, '*')`);
        await waitFor(`window.app.currentModel?.links?.has('wheel_with_effort')`, 10000);
        const parity = await ev(`const model = window.app.currentModel;
            await model.meshesReady;
            const colors = {};
            model.threeObject.traverse(o => {
                let link = o.parent;
                while (link && !link.isURDFLink) link = link.parent;
                let visual = o.parent;
                while (visual && !visual.isURDFVisual) visual = visual.parent;
                if (o.isMesh && visual && link) (colors[link.name] ||= []).push(o.material.color.getHexString());
            });
            return { missing: model.missingMeshes.length, colors };`);
        const { colors } = parity;
        const count = Object.values(colors).flat().length;
        check('the RViz parity fixture draws every visual with RViz\'s colors', parity.missing === 0 && count === 13 && colors.local_reference?.[0] === colors.local_definition?.[0]
            && colors.gltf_urdf_material?.[0] === colors.stl_right?.[0] && colors.gltf_own_material?.[0] !== colors.gltf_urdf_material?.[0], JSON.stringify(parity));
        if (process.env.SHOTS) {
            await sleep(500);
            fs.mkdirSync(process.env.SHOTS, { recursive: true });
            fs.writeFileSync(path.join(process.env.SHOTS, 'rviz-parity.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        }
    }

    const violations = await ev(`return window.__csp`);
    check('no CSP violations', violations.length === 0, JSON.stringify(violations));

    await floatingPanels();
} finally {
    await page.close();
    server.close();
}

// #24: without WebGL the view says why it is empty instead of staying blank.
{
    const bareServer = await serve(messages);
    const bare = await connect(bareServer.address().port, ['--disable-3d-apis']);
    try {
        const shown = await bare.waitFor(`document.getElementById('load-error')?.checkVisibility() && /WebGL/.test(document.getElementById('load-error').textContent)`, 10000);
        const text = await bare.ev(`return document.getElementById('load-error')?.textContent`);
        check('without WebGL the view says so, with no uncaught error', shown && bare.exceptions.length === 0, JSON.stringify({ text, exceptions: bare.exceptions }));
        // A triple click selects the message, so it can be copied into a bug report.
        const at = await bare.ev(`const r = document.getElementById('load-error').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 12 }`);
        for (const type of ['mousePressed', 'mouseReleased']) await bare.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 3 });
        const selected = await bare.ev(`return getSelection().toString()`);
        check('the WebGL message can be selected and copied', /WebGL/.test(selected), JSON.stringify(selected.slice(0, 40)));
        // Any throw before the view is up shows too: here the very first line of the page's script.
        await bare.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(window, 'acquireVsCodeApi', { get: () => () => { throw new Error('startup boom'); }, set() {} });" });
        await bare.send('Page.reload');
        const broke = await bare.waitFor(`document.getElementById('load-error')?.checkVisibility() && /startup boom/.test(document.getElementById('load-error').textContent)`, 10000);
        check('a throw while the page starts shows in the view', broke);
    } finally {
        await bare.close();
        bareServer.close();
    }
}

const failed = results.filter(ok => !ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
