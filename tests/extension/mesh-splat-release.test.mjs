import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openMeshSplat } from './vscode-mock.mjs';

const MINUTE = 60 * 1000;
const renderOf = panel => panel.webview.html.match(/data-render="(\d+)"/)?.[1];
const kept = panel => panel.webview.html.match(/data-keep="([^"]*)"/)[1] === '1';
const released = panel => !panel.webview.html.includes('data-render=');
const settle = () => new Promise(resolve => setImmediate(resolve));

async function view(bytes) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-release-'));
    const file = path.join(root, 'map.pcd');
    // Sparse: the size is what counts, not the disk it takes.
    fs.writeFileSync(file, '');
    fs.truncateSync(file, bytes);
    const { env, panel } = await openMeshSplat(root, file);
    // Shown again, the page renders after a stat (on the thread pool, so a few turns of the loop may not do).
    const show = async on => {
        const html = panel.webview.html;
        panel.viewState({ webviewPanel: { visible: on, active: on } });
        for (let i = 0; on && released(panel) && panel.webview.html === html && i < 10000; i++) await settle();
    };
    const done = () => panel.listener({ type: 'loaded', render: renderOf(panel) });
    return { root, file, env, panel, show, done };
}

test('a large view hidden for 5 minutes drops its page, and shown again loads it with the view kept', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { root, panel, show, done } = await view(100 * 1024 * 1024);
    done();
    await show(false);
    t.mock.timers.tick(5 * MINUTE - 1);
    assert.ok(!released(panel), 'kept for a quick look at another tab');
    t.mock.timers.tick(1);
    assert.ok(released(panel));
    await show(true);
    assert.ok(!released(panel));
    assert.ok(kept(panel), 'the camera comes back');
    fs.rmSync(root, { recursive: true, force: true });
});

test('a page still loading, a small view and a tab shown again in time keep their page', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const large = await view(100 * 1024 * 1024);
    await large.show(false);
    t.mock.timers.tick(30 * MINUTE);
    assert.ok(!released(large.panel), 'never told it loaded');
    large.done();
    t.mock.timers.tick(5 * MINUTE);
    assert.ok(released(large.panel), 'released once loaded');

    const small = await view(100 * 1024 * 1024 - 1);
    small.done();
    await small.show(false);
    t.mock.timers.tick(60 * MINUTE);
    assert.ok(!released(small.panel));

    const back = await view(100 * 1024 * 1024);
    back.done();
    await back.show(false);
    t.mock.timers.tick(4 * MINUTE);
    await back.show(true);
    await back.show(false);
    t.mock.timers.tick(4 * MINUTE);
    assert.ok(!released(back.panel), 'the timer starts over');
    for (const { root } of [large, small, back]) fs.rmSync(root, { recursive: true, force: true });
});

test('a file changed while its page is dropped loads afresh when shown, not before', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { root, file, env, panel, show, done } = await view(100 * 1024 * 1024);
    done();
    await show(false);
    t.mock.timers.tick(5 * MINUTE);
    assert.ok(released(panel));
    fs.truncateSync(file, 200 * 1024 * 1024);
    await env.state.watched.change({ fsPath: file });
    assert.ok(released(panel), 'a hidden tab does not read the file again');
    await show(true);
    assert.ok(!released(panel));
    assert.ok(!kept(panel), 'a changed file resets the view');
    assert.equal(panel.webview.html.match(/data-bytes="(\d+)"/)[1], String(200 * 1024 * 1024));
    fs.rmSync(root, { recursive: true, force: true });
});
