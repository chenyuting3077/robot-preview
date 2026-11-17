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
const code = args => spawn('code', ['--user-data-dir', udir, '--extensions-dir', `${os.homedir()}/.vscode/extensions`, ...args], { stdio: 'ignore', detached: true }).unref();
// A new `code` that finds a still-exiting instance of the same user-data-dir hands the file to it and nothing opens.
const killAll = async () => {
    for (let i = 0; procs().size; i++) {
        for (const pid of procs().keys()) try { process.kill(pid, i < 25 ? 'SIGTERM' : 'SIGKILL'); } catch {}
        await sleep(200);
    }
};
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
let sampling = true;
(async () => {
    while (sampling) {
        for (const [pid, p] of procs()) {
            const grew = p.rss - (base.get(pid)?.rss ?? 0);
            if (grew > (growth.get(pid)?.grew ?? -Infinity)) growth.set(pid, { grew, type: p.type });
        }
        await sleep(250);
    }
})();

const STATE = `(() => {
    const doc = document.getElementById('active-frame')?.contentDocument || document;
    const loading = doc.getElementById('loading-indicator');
    const error = doc.getElementById('load-error');
    return { ready: !!loading, loading: loading ? !loading.hidden : true, error: error && !error.hidden ? error.textContent : '',
        info: [...(doc.getElementById('info-table')?.rows ?? [])].map(r => [...r.cells].map(c => c.textContent).join(' ')).join(' | ') };
})()`;
const connect = url => new Promise(resolve => {
    const ws = new WebSocket(url);
    let id = 0; const pending = new Map();
    ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id) pending.get(m.id)?.(m.result); };
    ws.onopen = () => resolve(async () => (await new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { returnByValue: true, expression: STATE } })); })).result?.value);
});
let state;
while (!state && Date.now() - start < 60000) {
    const fresh = (await iframes()).find(t => !before.has(t.id));
    if (fresh) state = await connect(fresh.webSocketDebuggerUrl);
    else await sleep(100);
}
if (!state) { console.log('viewer webview did not appear'); await killAll(); process.exit(1); }
stage('viewer webview found');
let s;
while (Date.now() - start < 600000) {
    s = await Promise.race([state(), sleep(5000)]).catch(() => null);
    if (s?.ready && !s.loading) break;
    await sleep(200);
}
const shown = (Date.now() - start) / 1000;
stage('shown');
await sleep(6000); // the STEP cache export runs 500 ms after the first frame
sampling = false;
await sleep(300);
const top = [...growth.values()].sort((a, b) => b.grew - a.grew).slice(0, 3).map(g => `${g.type} +${Math.round(g.grew / 1024)} MB`);
console.log(JSON.stringify({ file: file.split('/').pop(), shown, error: s?.error || undefined, info: s?.info, grewMostMB: top,
    totalGrowthMB: Math.round([...growth.values()].reduce((sum, g) => sum + Math.max(0, g.grew), 0) / 1024) }));
await killAll();
process.exit(0);
