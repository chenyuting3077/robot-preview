// usage: node tests/e2e/vscode.mjs <user-data-dir> <file> [port]
// Opens <file> in a real VS Code (own user-data-dir, the installed extensions) after the window is up, and
// reports when the viewer finished loading, its info table, and how much each process grew over its
// RSS before the file was opened. A second run with the same user-data-dir hits the STEP cache.
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';

const [udir, file, port = '9339'] = process.argv.slice(2);
const stage = name => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${name}\n`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = () => new Map(execSync('ps -eo pid=,rss=,args=').toString().split('\n')
    .filter(l => l.includes(udir) && !l.includes('e2e/vscode.mjs')).map(l => l.trim().split(/\s+/))
    .map(([pid, rss, ...args]) => [+pid, { rss: +rss, type: (args.join(' ').match(/--type=(\S+)/) || [, 'main'])[1] }]));
// EXT_DIR (default ~/.vscode/extensions) lets a run use builds other than the installed ones.
const code = args => spawn('code', ['--user-data-dir', udir, '--extensions-dir', process.env.EXT_DIR || `${os.homedir()}/.vscode/extensions`, ...args], { stdio: 'ignore', detached: true }).unref();
// A new `code` that finds a still-exiting instance of the same user-data-dir hands the file to it and nothing opens.
const killAll = async () => {
    for (let i = 0; procs().size; i++) {
        for (const pid of procs().keys()) try { process.kill(pid, i < 25 ? 'SIGTERM' : 'SIGKILL'); } catch {}
        await sleep(200);
    }
};
// A systemd scope around this script also kills VS Code when the scope ends, so memory is capped here:
// past LIMIT_MB of growth over the pre-open RSS the instance is killed instead of the machine running out.
const LIMIT_MB = +(process.env.LIMIT_MB || 6000);
await killAll();
stage('launch');

code(['--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', `--remote-debugging-port=${port}`, '--new-window']);
const iframes = async () => { try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json()).filter(t => t.type === 'iframe'); } catch { return null; } };
// The window's renderer sometimes dies at launch and the debug port then stops answering.
for (let i = 0; !(await iframes()); i++) { if (i > 100) { console.log('VS Code did not start'); await killAll(); process.exit(2); } await sleep(300); }
await sleep(10000); // extensions load and their welcome webviews settle
stage('window up');
const before = new Set((await iframes()).map(t => t.id));
const base = procs();
const start = Date.now();
code(['-r', file]);

const growth = new Map();
const totalMB = () => [...growth.values()].reduce((sum, g) => sum + Math.max(0, g.grew), 0) / 1024;
let sampling = true;
(async () => {
    while (sampling) {
        for (const [pid, p] of procs()) {
            const grew = p.rss - (base.get(pid)?.rss ?? 0);
            if (grew > (growth.get(pid)?.grew ?? -Infinity)) growth.set(pid, { grew, type: p.type, at: (Date.now() - start) / 1000 });
        }
        if (totalMB() > LIMIT_MB) { console.log(`over ${LIMIT_MB} MB, killed`); await killAll(); process.exit(3); }
        await sleep(250);
    }
})();

const STATE = `(() => {
    const doc = document.getElementById('active-frame')?.contentDocument || document;
    const loading = doc.getElementById('loading-indicator');
    const error = doc.getElementById('load-error');
    // The URDF viewer hides its indicator with display: none and starts with it hidden, so it also waits for a model.
    const app = doc.defaultView.app;
    return { ready: !!loading && (!app || !!app.currentModel), loading: loading ? !(loading.hidden || loading.style.display === 'none') : true, error: error && !error.hidden ? error.textContent : '',
        info: [...(doc.getElementById('info-table')?.rows ?? [])].map(r => [...r.cells].map(c => c.textContent).join(' ')).join(' | ') };
})()`;
const connect = url => new Promise(resolve => {
    const ws = new WebSocket(url);
    let id = 0; const pending = new Map();
    ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id) pending.get(m.id)?.(m.result); };
    const send = (method, params) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
    ws.onopen = () => resolve(send);
});
const workbench = async () => connect((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && t.url.includes('workbench')).webSocketDebuggerUrl);
const evaluate = async (send, expression) => (await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }))?.result?.value;
let state;
while (!state && Date.now() - start < 60000) {
    const fresh = (await iframes()).find(t => !before.has(t.id));
    if (fresh) {
        const send = await connect(fresh.webSocketDebuggerUrl);
        state = () => evaluate(send, STATE);
        state.send = send;
    }
    else await sleep(100);
}
if (!state) { console.log('viewer webview did not appear'); await killAll(); process.exit(1); }
stage('viewer webview found');
// SPLIT=1 opens a second editor of the same file at once (Ctrl+\), so both tessellate and write the cache together.
if (process.env.SPLIT) {
    const send = await workbench();
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, modifiers: 2, key: '\\', code: 'Backslash', windowsVirtualKeyCode: 220 });
}
let s;
// WAIT_S (default 600) bounds the wait for the viewer; OpenCascade on a big assembly needs longer.
while (Date.now() - start < (+process.env.WAIT_S || 600) * 1000) {
    s = await Promise.race([state(), sleep(5000)]).catch(() => null);
    if (s?.ready && !s.loading) break;
    await sleep(200);
}
const shown = (Date.now() - start) / 1000;
stage('shown');
await sleep(6000); // the STEP cache export runs 500 ms after the first frame
// Frames per second while orbiting: real mouse input drags across the middle of the view for 3 s.
const send = state.send;
const [width, height] = await evaluate(send, `(() => { const w = document.getElementById('active-frame').contentWindow;
    w.__frames = 0; w.__stop = false; const tick = () => { w.__frames++; if (!w.__stop) w.requestAnimationFrame(tick); }; w.requestAnimationFrame(tick);
    return [innerWidth, innerHeight]; })()`) ?? [0, 0];
const mouse = (type, x) => send('Input.dispatchMouseEvent', { type, x, y: height / 2, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
await mouse('mousePressed', width / 3);
const dragStart = Date.now();
while (Date.now() - dragStart < 3000) { await mouse('mouseMoved', width / 3 + (Date.now() - dragStart) / 3000 * width / 3); await sleep(16); }
await mouse('mouseReleased', width * 2 / 3);
const fps = Math.round(await evaluate(send, `(() => { const w = document.getElementById('active-frame').contentWindow; w.__stop = true; return w.__frames; })()`) / ((Date.now() - dragStart) / 1000));
// SHOT=<png> saves the workbench window, to look at what the viewer drew.
async function screenshot(path) {
    const shot = await (await workbench())('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) (await import('node:fs')).writeFileSync(path, Buffer.from(shot.data, 'base64'));
    else console.error('screenshot failed');
}
// DETAIL=<prefix> zooms in on the middle of the view, then presses "Load detail in view" of a sampled
// point cloud and times it, with screenshots <prefix>-before.png and <prefix>-after.png.
let detailSeconds;
if (process.env.DETAIL) {
    for (let i = 0; i < +(process.env.ZOOM || 20); i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width / 2, y: height / 2, deltaX: 0, deltaY: -200 });
        await sleep(30);
    }
    await sleep(1000);
    await screenshot(`${process.env.DETAIL}-before.png`);
    const frame = `document.getElementById('active-frame').contentDocument`;
    const detailStart = Date.now();
    await evaluate(send, `${frame}.getElementById('detail-btn').click()`);
    await sleep(200);
    while (await evaluate(send, `!${frame}.getElementById('loading-indicator').hidden`)) await sleep(100);
    detailSeconds = (Date.now() - detailStart) / 1000;
    await sleep(1000);
    await screenshot(`${process.env.DETAIL}-after.png`);
}
sampling = false;
await sleep(300);
// CLICK=<id>,<id> clicks those elements of the viewer first, to shoot an open menu or panel.
for (const id of process.env.CLICK?.split(',') ?? []) {
    await evaluate(send, `document.getElementById('active-frame').contentDocument.getElementById('${id}').click()`);
    await sleep(300);
}
// HOVER=<id> rests the real pointer on that element, for :hover styles in the shot.
if (process.env.HOVER) {
    const [x, y] = await evaluate(send, `(() => { const b = document.getElementById('active-frame').contentDocument.getElementById('${process.env.HOVER}').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(500);
}
// EVAL=<expression> prints what it returns, evaluated in the viewer's document as `doc`, to measure the layout.
if (process.env.EVAL) console.log(JSON.stringify(await evaluate(send, `(() => { const doc = document.getElementById('active-frame').contentDocument; return ${process.env.EVAL}; })()`)));
if (process.env.SHOT) await screenshot(process.env.SHOT);
// With SPLIT, the cache the two editors wrote: one .meshopt for the file and no .part left over.
let cache;
if (process.env.SPLIT) {
    const fs = await import('node:fs');
    const dir = `${udir}/User/globalStorage/chenyuting3077.robot-preview-mesh-splat/step-cache`;
    const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    cache = { meshopt: names.filter(n => n.endsWith('.meshopt')).length, part: names.filter(n => n.endsWith('.part')).length };
}
const top = [...growth.values()].sort((a, b) => b.grew - a.grew).slice(0, +(process.env.TOP || 3)).map(g => `${g.type} +${Math.round(g.grew / 1024)} MB at ${g.at.toFixed(1)} s`);
console.log(JSON.stringify({ file: file.split('/').pop(), shown, fps, detailSeconds, cache, error: s?.error || undefined, info: s?.info, grewMostMB: top,
    totalGrowthMB: Math.round(totalMB()) }));
await killAll();
process.exit(0);
