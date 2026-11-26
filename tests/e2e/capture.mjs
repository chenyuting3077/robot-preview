// Records the README captures in a real VS Code, with a drawn pointer, into packages/*/images/readme/.
// usage: node tests/e2e/capture.mjs <urdf|mesh-splat|usd|stills>   (samples from scripts/capture-samples.py; EXT_DIR as in vscode.mjs)
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SAMPLES = `${ROOT}test-files/capture`;
const OUT = name => `${ROOT}packages/${name}/images/readme`;
const PORT = 9340, W = 1280, H = 800;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const udir = fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-capture-'));
const procs = () => execSync('ps -eo pid=,args=').toString().split('\n').filter(l => l.includes(udir) && !l.includes('capture.mjs')).map(l => +l.trim().split(/\s+/)[0]);
async function killAll() {
    for (let i = 0; procs().length; i++) { for (const pid of procs()) try { process.kill(pid, i < 25 ? 'SIGTERM' : 'SIGKILL'); } catch {} await sleep(200); }
}

const connect = url => new Promise(resolve => {
    const ws = new WebSocket(url);
    let id = 0; const pending = new Map(), on = {};
    ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id) { pending.get(m.id)?.(m.result ?? m.error); pending.delete(m.id); } else on[m.method]?.(m.params); };
    ws.onopen = () => resolve(Object.assign((method, params) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); }), { on }));
});
async function evaluate(send, expression) {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
    return r?.result?.value;
}
const targets = async () => { try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(3000) })).json(); } catch { return []; } };

// One window on `folder`; `narrow` shrinks the Explorer so an editor and a preview fit side by side.
async function launch(folder, narrow = true) {
    await killAll();
    fs.rmSync(udir, { recursive: true, force: true });
    fs.mkdirSync(`${udir}/User`, { recursive: true });
    fs.writeFileSync(`${udir}/User/settings.json`, JSON.stringify({
        'workbench.startupEditor': 'none', 'workbench.colorTheme': 'Default Dark Modern', 'editor.minimap.enabled': false, 'window.titleBarStyle': 'custom',
        'window.commandCenter': false, 'workbench.layoutControl.enabled': false, 'telemetry.telemetryLevel': 'off', 'update.mode': 'none',
        'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false, 'extensions.ignoreRecommendations': true, 'chat.disableAIFeatures': true,
        'workbench.secondarySideBar.defaultVisibility': 'hidden', 'git.enabled': false, 'editor.fontSize': 14, 'breadcrumbs.enabled': false,
        'editor.stickyScroll.enabled': false, 'editor.cursorBlinking': 'solid' }));
    spawn('code', ['--user-data-dir', udir, '--extensions-dir', process.env.EXT_DIR || `${os.homedir()}/.vscode/extensions`, '--disable-workspace-trust',
        '--skip-welcome', '--skip-release-notes', `--remote-debugging-port=${PORT}`, '--new-window', folder], { stdio: 'ignore', detached: true }).unref();
    const workbench = async () => (await targets()).find(t => t.type === 'page' && t.url.includes('workbench'));
    for (let i = 0; !(await workbench()); i++) { if (i > 100) throw new Error('VS Code did not start'); await sleep(300); }
    const send = await connect((await workbench()).webSocketDebuggerUrl);
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await sleep(8000); // extensions load and the Explorer settles
    // CDP input moves no visible pointer, so one is drawn; innerHTML is refused by the workbench's Trusted Types.
    await evaluate(send, `(() => { const ns = 'http://www.w3.org/2000/svg', c = document.createElement('div'), svg = document.createElementNS(ns, 'svg'), p = document.createElementNS(ns, 'path');
        c.id = 'capture-pointer'; c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none';
        for (const [k, v] of [['width', 22], ['height', 22], ['viewBox', '0 0 22 22']]) svg.setAttribute(k, v);
        for (const [k, v] of [['d', 'M3 2v15l4.2-3.6 2.7 6 2.4-1.1-2.7-5.9H15z'], ['fill', '#fff'], ['stroke', '#000'], ['stroke-width', 1.2], ['stroke-linejoin', 'round']]) p.setAttribute(k, v);
        svg.appendChild(p); c.appendChild(svg); document.body.appendChild(c);
        const style = document.createElement('style'); style.textContent = '.monaco-sash:before{background:transparent!important}'; document.head.appendChild(style); })()`);
    let px = W / 2, py = H / 2, held = null;
    const mouse = (type, extra = {}) => send('Input.dispatchMouseEvent', { type, x: px, y: py, button: 'none', buttons: 0, ...extra });
    const viewers = new Map();
    const c = {
        ev: expression => evaluate(send, expression),
        async move(x, y, ms = 500) {
            const x0 = px, y0 = py, t0 = Date.now();
            for (let t = 0; t < 1;) {
                t = Math.min(1, (Date.now() - t0) / ms);
                const e = t * t * (3 - 2 * t);
                px = x0 + (x - x0) * e; py = y0 + (y - y0) * e;
                await Promise.all([evaluate(send, `document.getElementById('capture-pointer').style.transform = 'translate(${px - 3}px,${py - 2}px)'`),
                    mouse('mouseMoved', held ? { button: held, buttons: 1 } : {})]);
            }
        },
        async drag(x0, y0, x1, y1, ms) {
            await c.move(x0, y0, 400);
            held = 'left'; await mouse('mousePressed', { button: held, buttons: 1, clickCount: 1 });
            await c.move(x1, y1, ms);
            await mouse('mouseReleased', { button: held, clickCount: 1 }); held = null;
        },
        async click(x, y) {
            await c.move(x, y, 550); await sleep(120);
            await mouse('mousePressed', { button: 'left', buttons: 1, clickCount: 1 }); await sleep(60);
            await mouse('mouseReleased', { button: 'left', clickCount: 1 });
        },
        async wheel(notches, gap = 25) { for (let i = 0; i < notches; i++) { await mouse('mouseWheel', { deltaX: 0, deltaY: -120 }); await sleep(gap); } },
        // Opens a file by its Explorer row and returns `v`, which evaluates in the viewer's document once it has loaded.
        async open(name) {
            const b = await c.ev(`(() => { const r = [...document.querySelectorAll('.explorer-folders-view .monaco-list-row')].find(r => r.getAttribute('aria-label') === ${JSON.stringify(name)})?.getBoundingClientRect(); return r && [r.left + r.width / 2, r.top + r.height / 2]; })()`);
            await c.click(...b);
            const inViewer = send => e => evaluate(send, `(() => { const doc = document.getElementById('active-frame').contentDocument; return ${e}; })()`);
            const loading = `(l => !l || !(l.hidden || l.style.display === 'none'))(doc?.getElementById('loading-indicator'))`;
            for (let i = 0; i < 600; i++) {
                await sleep(100);
                for (const t of (await targets()).filter(t => t.type === 'iframe')) {
                    if (!viewers.has(t.id)) viewers.set(t.id, inViewer(await connect(t.webSocketDebuggerUrl)));
                    const v = viewers.get(t.id);
                    if (await v(`doc?.visibilityState === 'visible' && !${loading}`).catch(() => false)) return v;
                }
            }
            throw new Error(`${name} did not load`);
        },
        // The visible webview's box in the window; element boxes inside the viewer are relative to it.
        frame: () => c.ev(`(() => { const b = [...document.querySelectorAll('iframe.webview.ready')].map(f => f.getBoundingClientRect()).filter(b => b.width > 50).pop(); return { x: b.left, y: b.top, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; })()`),
        async shot(file, crop) {
            fs.writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
            if (crop) { execSync(`ffmpeg -y -loglevel error -i ${file} -vf "crop=${crop},scale=${crop.split(':')[0] > 1000 ? 880 : 760}:-1:flags=lanczos" ${file}.png`); fs.renameSync(`${file}.png`, file); }
        },
        // Frames come as the window draws them, with their own times, so the GIF plays at the speed it was recorded.
        record(out, { width = 800, colors = 96 } = {}) {
            const dir = `${udir}/frames`, times = [];
            fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
            send.on['Page.screencastFrame'] = ({ data, metadata, sessionId }) => {
                send('Page.screencastFrameAck', { sessionId });
                fs.writeFileSync(`${dir}/${times.length}.jpg`, Buffer.from(data, 'base64')); times.push(metadata.timestamp);
            };
            send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
            return async () => {
                await send('Page.stopScreencast'); await sleep(300);
                fs.writeFileSync(`${dir}/list.txt`, times.map((t, i) => `file '${dir}/${i}.jpg'\nduration ${((times[i + 1] ?? t + 1.5) - t).toFixed(3)}`).join('\n') + `\nfile '${dir}/${times.length - 1}.jpg'\n`);
                execSync(`ffmpeg -y -loglevel error -f concat -safe 0 -i ${dir}/list.txt -vf "fps=10,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" ${out}`);
                console.log(out, `${(times.at(-1) - times[0]).toFixed(1)} s`, `${(times.length / (times.at(-1) - times[0])).toFixed(0)} frames/s recorded`, `${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
            };
        }
    };
    if (narrow) await c.drag(349, 420, 236, 420, 300);
    await c.move(700, 420, 200);
    return c;
}

const SCENES = {
    async urdf() {
        const c = await launch(`${SAMPLES}/so101`);
        const stop = c.record(`${OUT('urdf-mjcf')}/open.gif`);
        await c.open('so101_new_calib.urdf');
        await sleep(500);
        const { cx, cy } = await c.frame();
        await c.drag(cx - 150, cy + 250, cx + 60, cy + 235, 1400);
        await sleep(300);
        await c.click(cx - 76, cy - 31); // the upper arm: the editor jumps to its <link>
        await sleep(1200);
        await c.drag(cx + 30, cy - 110, cx + 80, cy - 65, 1800); // the wrist, dragged about its joint
        await c.move(cx + 120, cy + 280, 500);
        await sleep(1000);
        await stop();
    },
    async 'mesh-splat'() {
        const c = await launch(`${SAMPLES}/perception`);
        const stop = c.record(`${OUT('mesh-splat')}/open.gif`, { width: 760, colors: 72 });
        await c.open('street_scan.pcd');
        await sleep(500);
        const { cx, cy } = await c.frame();
        await c.move(cx, cy + 40, 400);
        await c.wheel(22, 40);
        await sleep(300);
        await c.drag(cx - 50, cy + 40, cx + 50, cy + 40, 2600);
        await sleep(900);
        await stop();
    },
    async usd() {
        const c = await launch(`${SAMPLES}/isaac/G1`);
        const stop = c.record(`${OUT('usd')}/open.gif`, { width: 760, colors: 72 });
        await c.open('g1.usd');
        await sleep(500);
        const { cx, cy } = await c.frame();
        await c.drag(cx - 330, cy + 200, cx - 60, cy + 180, 1800);
        await sleep(300);
        await c.click(cx, cy - 70); // the torso: the Stage panel scrolls to its prim
        await sleep(1500);
        await c.drag(cx - 60, cy + 250, cx - 300, cy + 240, 1600);
        await sleep(900);
        await stop();
    },
    async stills() {
        const viewer = '922:704:353:63'; // the webview with the Explorer at its default width
        const still = async (folder, file, out, crop, drag, zoom = 0) => {
            const c = await launch(folder, crop !== viewer);
            await c.open(file);
            await sleep(2500);
            const { cx, cy } = await c.frame();
            await c.move(cx, cy, 200); await c.wheel(zoom);
            if (drag) await c.drag(cx + drag[0], cy + drag[1], cx + drag[2], cy + drag[3], 600);
            await c.move(cx + 200, cy + 300, 200);
            await sleep(1500);
            await c.shot(out, crop);
        };
        await still(`${SAMPLES}/perception`, 'marble_bust.ply', `${OUT('mesh-splat')}/splat.png`, viewer, [0, 0, 130, 10], 1);
        await still(`${SAMPLES}/perception`, 'so101_assembly.step', `${OUT('mesh-splat')}/step.png`, viewer, [0, 0, -60, 0], 1);
        await still(`${SAMPLES}/isaac/FrankaPanda`, 'franka.usd', `${OUT('usd')}/franka.png`, viewer);
        await still(`${SAMPLES}/so101`, 'scene.xml', `${OUT('urdf-mjcf')}/mujoco.png`, '1040:736:236:31', [-100, 280, -20, 250], 2);
    }
};

const scene = SCENES[process.argv[2]];
if (!scene) { console.log(`usage: node tests/e2e/capture.mjs <${Object.keys(SCENES).join('|')}>`); process.exit(2); }
try { await scene(); } finally { await killAll(); fs.rmSync(udir, { recursive: true, force: true }); }
process.exit(0);
