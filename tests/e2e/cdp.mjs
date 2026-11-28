// Headless Chrome driven over the DevTools protocol, shared by the e2e scripts.
// Usage: const chrome = await launch(['--window-size=900,600']); await chrome.send('Page.navigate', { url }); await chrome.evaluate('document.title'); await chrome.close();
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromePath, sleep } from '../extension/vscode-mock.mjs';

export async function launch(flags = []) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-chrome-'));
    const chrome = spawn(chromePath(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', ...flags, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    // Port 0 lets Chrome pick a free port and print it; stderr keeps being read so Chrome never blocks on a full pipe.
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

    let nextId = 0;
    const pending = new Map();
    const listeners = new Set();
    const exceptions = [];
    ws.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        if (message.id) return pending.get(message.id)?.(message);
        if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
        for (const listener of listeners) listener(message);
    };
    // A reply that never comes (a screenshot or an awaited page promise) fails with what it waited for instead of
    // hanging the run: one mesh-splat run sat 63 minutes after cloud.ply with nothing logged.
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
    const evaluate = async (expression, timeout) => {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeout);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
    };
    const on = listener => listeners.add(listener);
    const close = async () => {
        const exited = new Promise(resolve => chrome.once('exit', resolve));
        chrome.kill();
        await exited;
        await sleep(1000);
        try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {}
    };
    await send('Runtime.enable');
    await send('Page.enable');
    return { send, evaluate, on, exceptions, close };
}
