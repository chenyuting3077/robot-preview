import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openMeshSplat, loadExtension, fakePanel } from './vscode-mock.mjs';

const unescape = text => text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
// The files the page is told to load, in order.
const listed = panel => JSON.parse(unescape(panel.webview.html.match(/data-files="([^"]*)"/)[1]));
const names = panel => listed(panel).map(file => file.name);

function workspace(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-files-'));
    for (const [name, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
        fs.writeFileSync(path.join(root, name), text);
    }
    return root;
}

async function open(files, { opened = Object.keys(files)[0], postMessage } = {}) {
    const root = workspace(files);
    const { env, panel } = await openMeshSplat(root, path.join(root, opened), { postMessage });
    const at = name => path.join(root, name);
    return { root, env, panel, at, url: name => pathToFileURL(at(name)).href };
}

test('a view opens with its own file listed, and dropped files are appended in order', async () => {
    const { panel, at } = await open({ 'map.pcd': 'map', 'scan1.pcd': 'scan one', 'scan2.ply': 'ply' });
    assert.deepEqual(names(panel), ['map.pcd']);
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(at('scan1.pcd')).href, pathToFileURL(at('scan2.ply')).href] });
    assert.deepEqual(names(panel), ['map.pcd', 'scan1.pcd', 'scan2.ply']);
    const [, scan1] = listed(panel);
    assert.equal(scan1.bytes, 'scan one'.length);
    assert.match(scan1.src, /scan1\.pcd\?v=/);
    assert.equal(new Set(listed(panel).map(file => file.id)).size, 3, 'each file has its own id');
});

test('Add file… picks from the opened file\'s folder, several at a time, only types the view shows', async () => {
    const { env, panel, at } = await open({ 'map.pcd': 'map', 'a.ply': 'a', 'b.xyz': 'b' });
    env.state.openDialogResult = [env.vscode.Uri.file(at('a.ply')), env.vscode.Uri.file(at('b.xyz'))];
    await panel.listener({ type: 'addFiles' });
    const { canSelectMany, defaultUri, filters } = env.state.openDialogOptions;
    assert.equal(canSelectMany, true);
    assert.equal(defaultUri.fsPath, path.dirname(at('map.pcd')));
    const types = Object.values(filters).flat();
    assert.ok(types.includes('pcd') && types.includes('ply') && types.includes('glb'));
    // The optional editors' types too: a KITTI scan (#9) and a ROS map (#8) go over a map or under a scan.
    assert.ok(types.includes('bin') && types.includes('pgm') && types.includes('yaml'));
    assert.ok(!types.some(type => /^(ste?p|ige?s|png)$/.test(type)), 'no STEP, IGES or other types');
    assert.deepEqual(names(panel), ['map.pcd', 'a.ply', 'b.xyz']);
});

test('a cancelled pick, a file already in the view and a type the view cannot show add nothing', async () => {
    const { env, panel, at } = await open({ 'map.pcd': 'map', 'notes.txt': 'x' });
    const html = panel.webview.html;
    await panel.listener({ type: 'addFiles' });
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(at('map.pcd')).href, pathToFileURL(at('notes.txt')).href] });
    assert.equal(panel.webview.html, html);
    assert.equal(env.state.watchers.length, 1);
});

test('removeFile drops an added file, and the opened file cannot be removed', async () => {
    const { panel, url } = await open({ 'map.pcd': 'map', 'a.ply': 'a', 'b.ply': 'b' });
    await panel.listener({ type: 'addPaths', uris: [url('a.ply'), url('b.ply')] });
    const [opened, a] = listed(panel);
    await panel.listener({ type: 'removeFile', file: a.id });
    assert.deepEqual(names(panel), ['map.pcd', 'b.ply']);
    await panel.listener({ type: 'removeFile', file: opened.id });
    assert.deepEqual(names(panel), ['map.pcd', 'b.ply']);
});

test('a change to an added file re-renders with every file still listed', async () => {
    const { env, panel, at, url } = await open({ 'map.pcd': 'map', 'scan.pcd': 'scan' });
    await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
    const watcher = env.state.watchers.find(({ pattern }) => pattern.pattern === 'scan.pcd');
    assert.ok(watcher, 'the added file is watched');
    fs.writeFileSync(at('scan.pcd'), 'a longer scan');
    await watcher.change({ fsPath: at('scan.pcd') });
    assert.deepEqual(names(panel), ['map.pcd', 'scan.pcd']);
    assert.equal(listed(panel)[1].bytes, 'a longer scan'.length);
    // A render for a change is not one that keeps the camera; one for an added file is.
    assert.match(panel.webview.html, /data-keep=""/);
    fs.writeFileSync(at('scan.pcd'), 'saved by rename');
    await watcher.create({ fsPath: at('scan.pcd') });
    assert.equal(listed(panel)[1].bytes, 'saved by rename'.length);
});

test('a change and an add that render at once keep nothing, whichever starts first', async () => {
    for (const changeFirst of [true, false]) {
        const { env, panel, at, url } = await open({ 'map.pcd': 'map', 'scan.pcd': 'scan' });
        const watcher = env.state.watchers.find(({ pattern }) => pattern.pattern === 'map.pcd');
        fs.writeFileSync(at('map.pcd'), 'a new map');
        const change = () => watcher.change({ fsPath: at('map.pcd') });
        const add = () => panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
        await Promise.all(changeFirst ? [change(), add()] : [add(), change()]);
        assert.deepEqual(names(panel), ['map.pcd', 'scan.pcd']);
        assert.match(panel.webview.html, /data-keep=""/, `the map changed (${changeFirst ? 'change' : 'add'} first)`);
        // The next render for an add alone keeps again.
        await panel.listener({ type: 'removeFile', file: listed(panel)[1].id });
        assert.match(panel.webview.html, /data-keep="1"/);
    }
});

test('reads by file id return that file\'s bytes, and an unknown id gets an error reply', async () => {
    const replies = [];
    const { panel, url } = await open({ 'map.pcd': 'the map', 'scan.pcd': 'the scan' }, { postMessage: m => replies.push(m) });
    await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
    const [map, scan] = listed(panel);
    await panel.listener({ type: 'read', file: scan.id, id: 1, at: 0, mtime: scan.mtime });
    await panel.listener({ type: 'read', file: map.id, id: 1, at: 0, mtime: map.mtime });
    await panel.listener({ type: 'read', file: 'nope', id: 1, at: 0 });
    assert.deepEqual(replies.map(({ file, chunk, error }) => [file, chunk && new TextDecoder().decode(chunk), !!error]),
        [[scan.id, 'the scan', false], [map.id, 'the map', false], ['nope', undefined, true]]);
});

test('readers are closed when their file is removed and when the view closes', async () => {
    const replies = [];
    const { panel, url } = await open({ 'map.pcd': 'the map', 'a.pcd': 'a', 'b.pcd': 'b' }, { postMessage: m => replies.push(m) });
    await panel.listener({ type: 'addPaths', uris: [url('a.pcd'), url('b.pcd')] });
    const [map, a, b] = listed(panel);
    const openFile = fs.promises.open;
    const handles = new Set();
    fs.promises.open = async (...args) => {
        const handle = await openFile(...args);
        handles.add(handle);
        const close = handle.close.bind(handle);
        handle.close = () => (handles.delete(handle), close());
        return handle;
    };
    try {
        for (const file of [map, a, b]) await panel.listener({ type: 'read', file: file.id, id: 7, at: 0, mtime: file.mtime });
        assert.equal(handles.size, 3);
        await panel.listener({ type: 'removeFile', file: a.id });
        await new Promise(resolve => setTimeout(resolve, 20));
        // The removal re-renders, and the page it replaces takes every read of its files along.
        assert.equal(handles.size, 0);
        for (const file of [map, b]) await panel.listener({ type: 'read', file: file.id, id: 7, at: 0, mtime: file.mtime });
        assert.equal(handles.size, 2);
        await panel.listener({ type: 'read', file: a.id, id: 7, at: 0 });
        assert.ok(replies.at(-1).error, 'a removed file is no longer read');
        panel.dispose();
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(handles.size, 0);
    } finally {
        fs.promises.open = openFile;
    }
});

test('a file outside the panel\'s roots puts its folder into them', async () => {
    const { panel } = await open({ 'map.pcd': 'map' });
    const elsewhere = workspace({ 'maps/big.pcd': 'far away' });
    const roots = () => panel.webview.options.localResourceRoots.map(root => root.fsPath);
    assert.ok(!roots().some(root => root.startsWith(elsewhere)));
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(path.join(elsewhere, 'maps/big.pcd')).href] });
    assert.ok(roots().includes(path.join(elsewhere, 'maps')));
    assert.equal(panel.webview.options.enableScripts, true);
    assert.deepEqual(names(panel), ['map.pcd', 'big.pcd']);
});

test('a map image named by absolute path is read for the page, only an image and only inside the workspace', async () => {
    const replies = [];
    const { panel, at } = await open({ 'maps/map.yaml': 'image: map.pgm', 'maps/map.pgm': 'P5 cells', 'maps/notes.txt': 'no' }, { postMessage: m => replies.push(m) });
    const [yaml] = listed(panel);
    const elsewhere = workspace({ 'maps/map.pgm': 'P5 far away' });
    const ask = async (id, file) => {
        await panel.listener({ type: 'readImage', id, file: yaml.id, path: file });
        await new Promise(resolve => setTimeout(resolve, 20));
        return replies.find(reply => reply.type === 'imageReply' && reply.id === id);
    };
    assert.equal(new TextDecoder().decode((await ask(1, at('maps/map.pgm'))).bytes), 'P5 cells');
    assert.ok((await ask(2, at('maps/notes.txt'))).error, 'not an image type');
    assert.ok((await ask(3, at('maps/gone.pgm'))).error, 'missing');
    const outside = await ask(4, path.join(elsewhere, 'maps/map.pgm'));
    assert.equal(outside.bytes, undefined);
    assert.ok(outside.error.includes(path.join(elsewhere, 'maps/map.pgm')), 'the refusal names the path');
    await panel.listener({ type: 'readImage', id: 5, path: at('maps/map.pgm') });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(replies.find(reply => reply.id === 5).error, 'a read names its YAML');
});

test('a map image named relative to its YAML is read from the YAML\'s folder, even outside the roots', async () => {
    const replies = [];
    const root = workspace({ 'maps/yaml/map.yaml': 'image: ../pgm/map.pgm', 'maps/pgm/map.pgm': 'P5 relative' });
    const { panel } = await openMeshSplat(root, path.join(root, 'maps/yaml/map.yaml'), { postMessage: m => replies.push(m) });
    const [yaml] = listed(panel);
    await panel.listener({ type: 'readImage', id: 1, file: yaml.id, path: '../pgm/map.pgm' });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(new TextDecoder().decode(replies.find(reply => reply.id === 1).bytes), 'P5 relative');
});

test('a $ pattern in a file name reaches the page as written', async () => {
    const { panel } = await open({ "it$'s $& $$.pcd": 'x' });
    assert.deepEqual(names(panel), ["it$'s $& $$.pcd"]);
    assert.equal((panel.webview.html.match(/<body /g) ?? []).length, 1);
});

test('the USD extension, which ships this file, takes no added files', async () => {
    const usd = fileURLToPath(new URL('../../packages/usd', import.meta.url));
    const root = workspace({ 'scene.usda': '#usda 1.0', 'scan.pcd': 'scan' });
    const env = loadExtension({ workspace: root, extension: fileURLToPath(new URL('../../packages/mesh-splat/extension.js', import.meta.url)), root: usd, globalStorage: path.join(root, 'storage') });
    env.activate();
    const panel = fakePanel();
    await env.state.customEditors['robotPreviewUsd.text'].resolveCustomEditor({ uri: env.vscode.Uri.file(path.join(root, 'scene.usda')) }, panel);
    assert.match(panel.webview.html, /data-adds=""/);
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(path.join(root, 'scan.pcd')).href] });
    assert.deepEqual(names(panel), ['scene.usda']);
});

test('Open as points reopens a .bin in the point editor, from the title button or the active editor', async () => {
    const root = workspace({ '000000.bin': 'scan' });
    const env = loadExtension({ workspace: root, extension: fileURLToPath(new URL('../../packages/mesh-splat/extension.js', import.meta.url)), globalStorage: path.join(root, 'storage') });
    env.activate();
    const scan = env.vscode.Uri.file(path.join(root, '000000.bin'));
    await env.state.commands['robotPreviewMeshSplat.openAsPoints'](scan);
    assert.deepEqual(env.state.executed.at(-1), ['vscode.openWith', scan, 'robotPreviewMeshSplat.textPoints']);
});

test('Add to Point Cloud View adds the Explorer selection to the open view, which comes to the front', async () => {
    const { env, panel, at } = await open({ 'map.pcd': 'map', 'a.pcd': 'a', 'b.ply': 'b', 'notes.txt': 'x' });
    const uri = name => env.vscode.Uri.file(at(name));
    await env.state.commands['robotPreviewMeshSplat.addToView'](uri('a.pcd'), [uri('a.pcd'), uri('b.ply'), uri('notes.txt')]);
    assert.deepEqual(names(panel), ['map.pcd', 'a.pcd', 'b.ply']);
    assert.equal(panel.revealed, 1);
});

test('Add to Point Cloud View goes to the view used last, and opens a new one when none is open', async () => {
    const root = workspace({ 'one.pcd': '1', 'two.pcd': '2', 'scan.bin': 's', 'x.pcd': 'x' });
    const env = loadExtension({ workspace: root, extension: fileURLToPath(new URL('../../packages/mesh-splat/extension.js', import.meta.url)), globalStorage: path.join(root, 'storage') });
    env.activate();
    const uri = name => env.vscode.Uri.file(path.join(root, name));
    const panels = [];
    env.state.onExecute = async (command, target, viewType) => {
        if (command !== 'vscode.openWith') return;
        const panel = fakePanel();
        panels.push({ panel, viewType });
        await env.state.customEditors[viewType].resolveCustomEditor({ uri: target }, panel);
    };
    const add = (...names) => env.state.commands['robotPreviewMeshSplat.addToView'](uri(names[0]), names.map(uri));
    await add('scan.bin', 'one.pcd');
    assert.equal(panels.length, 1);
    assert.equal(panels[0].viewType, 'robotPreviewMeshSplat.textPoints', 'a .bin opens in the editor that reads it');
    assert.deepEqual(names(panels[0].panel), ['scan.bin', 'one.pcd']);
    await env.vscode.commands.executeCommand('vscode.openWith', uri('two.pcd'), 'robotPreviewMeshSplat.viewer');
    panels[1].panel.viewState({ webviewPanel: { active: true } });
    await add('x.pcd');
    assert.deepEqual(names(panels[1].panel), ['two.pcd', 'x.pcd'], 'the view focused last takes it');
    panels[1].panel.dispose();
    await add('two.pcd');
    assert.deepEqual(names(panels[0].panel), ['scan.bin', 'one.pcd', 'two.pcd'], 'a closed view is forgotten');
});

test('Add to Point Cloud View waits out a late delete of the opened file and skips a link to a listed file', async () => {
    const { env, panel, root, at } = await open({ 'map.pcd': 'map', 'a.pcd': 'a' });
    fs.symlinkSync(at('map.pcd'), path.join(root, 'link.pcd'));
    const uri = file => env.vscode.Uri.file(file);
    // A rename-style save whose delete event comes after the create: the file is there.
    const deleting = env.state.watchers[0].delete({ fsPath: at('map.pcd') });
    await env.state.commands['robotPreviewMeshSplat.addToView'](uri(at('a.pcd')), [uri(at('a.pcd')), uri(path.join(root, 'link.pcd'))]);
    await deleting;
    assert.deepEqual(names(panel), ['map.pcd', 'a.pcd']);
});

test('the USD extension, which ships this file, registers no Open as points command', () => {
    const usd = fileURLToPath(new URL('../../packages/usd', import.meta.url));
    const root = workspace({ 'scene.usda': '#usda 1.0' });
    const env = loadExtension({ workspace: root, extension: fileURLToPath(new URL('../../packages/mesh-splat/extension.js', import.meta.url)), root: usd, globalStorage: path.join(root, 'storage') });
    env.activate();
    assert.equal(env.state.commands?.['robotPreviewMeshSplat.openAsPoints'], undefined);
    assert.equal(env.state.commands?.['robotPreviewMeshSplat.addToView'], undefined);
});

test('a drop adds only URIs of the opened file\'s scheme, not bare paths or other schemes', async () => {
    const { panel, at, url } = await open({ 'map.pcd': 'map', 'a.pcd': 'a', 'b.pcd': 'b', 'c.pcd': 'c' });
    await panel.listener({ type: 'addPaths', uris: [at('a.pcd'), `untitled:${at('b.pcd')}`, `https://example.com${pathToFileURL(at('c.pcd')).pathname}`] });
    assert.deepEqual(names(panel), ['map.pcd']);
    await panel.listener({ type: 'addPaths', uris: [url('a.pcd')] });
    assert.deepEqual(names(panel), ['map.pcd', 'a.pcd']);
});

test('a file whose name has glob characters is watched, and a sibling\'s change does not re-render', async () => {
    const { env, panel, at } = await open({ 'lidar[0].pcd': 'scan', 'lidar[1].pcd': 'other' });
    const [watcher] = env.state.watchers;
    const before = panel.webview.html;
    await watcher.change({ fsPath: at('lidar[1].pcd') });
    assert.equal(panel.webview.html, before, 'a sibling matched by the pattern is not this file');
    fs.writeFileSync(at('lidar[0].pcd'), 'a new scan');
    await watcher.change({ fsPath: at('lidar[0].pcd') });
    assert.equal(listed(panel)[0].bytes, 'a new scan'.length);
    // VS Code's glob cannot escape ']', so the pattern matches by '?' and the event is checked by path.
    assert.ok(!/[[\]{}*]/.test(watcher.pattern.pattern), watcher.pattern.pattern);
});

test('a map image whose name starts with two dots is inside the YAML\'s folder', async () => {
    const replies = [];
    const { panel, at } = await open({ 'map.yaml': 'image: ..map.pgm', '..map.pgm': 'P5 dots' }, { postMessage: m => replies.push(m) });
    await panel.listener({ type: 'readImage', id: 1, file: listed(panel)[0].id, path: at('..map.pgm') });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(new TextDecoder().decode(replies.find(reply => reply.id === 1).bytes ?? new Uint8Array()), 'P5 dots');
});

test('a symlink out of the workspace is not followed for a map image', async () => {
    const replies = [];
    const elsewhere = workspace({ 'secret.png': 'not yours' });
    const { panel, at } = await open({ 'map.yaml': 'image: link.png' }, { postMessage: m => replies.push(m) });
    fs.symlinkSync(path.join(elsewhere, 'secret.png'), at('link.png'));
    await panel.listener({ type: 'readImage', id: 1, file: listed(panel)[0].id, path: at('link.png') });
    await new Promise(resolve => setTimeout(resolve, 20));
    const reply = replies.find(r => r.id === 1);
    assert.equal(reply.bytes, undefined);
    assert.match(reply.error, /outside/);
});

test('removing a file from elsewhere takes its folder out of the roots', async () => {
    const { panel } = await open({ 'map.pcd': 'map' });
    const elsewhere = workspace({ 'maps/big.pcd': 'far away' });
    const roots = () => panel.webview.options.localResourceRoots.map(root => root.fsPath);
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(path.join(elsewhere, 'maps/big.pcd')).href] });
    assert.ok(roots().includes(path.join(elsewhere, 'maps')));
    await panel.listener({ type: 'removeFile', file: listed(panel)[1].id });
    assert.ok(!roots().includes(path.join(elsewhere, 'maps')));
    assert.equal(panel.webview.options.enableScripts, true);
});

test('on a case-insensitive disk the same file in other case is not added twice', { skip: !['darwin', 'win32'].includes(process.platform) }, async () => {
    const { panel, at } = await open({ 'map.pcd': 'map' });
    await panel.listener({ type: 'addPaths', uris: [pathToFileURL(at('MAP.PCD')).href] });
    assert.deepEqual(names(panel), ['map.pcd']);
});

test('a re-render closes the old page\'s open reads, and the file still reads', async () => {
    const replies = [];
    const { panel, url } = await open({ 'map.pcd': 'the map', 'scan.pcd': 'scan' }, { postMessage: m => replies.push(m) });
    const openFile = fs.promises.open;
    const handles = new Set();
    fs.promises.open = async (...args) => {
        const handle = await openFile(...args);
        handles.add(handle);
        const close = handle.close.bind(handle);
        handle.close = () => (handles.delete(handle), close());
        return handle;
    };
    try {
        const [map] = listed(panel);
        // The page asked for a piece and never said it was done: it is replaced first.
        await panel.listener({ type: 'read', file: map.id, id: 1, at: 0, mtime: map.mtime });
        assert.equal(handles.size, 1);
        await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(handles.size, 0);
        await panel.listener({ type: 'read', file: map.id, id: 1, at: 0, mtime: listed(panel)[0].mtime });
        assert.equal(new TextDecoder().decode(replies.at(-1).chunk), 'the map');
    } finally {
        fs.promises.open = openFile;
    }
});

test('reads the old page left behind answer nothing once a re-render replaced it', async () => {
    const replies = [];
    const { panel, url } = await open({ 'map.pcd': 'the map', 'scan.pcd': 'scan' }, { postMessage: m => replies.push(m) });
    const [map] = listed(panel);
    const oldRender = panel.webview.html.match(/data-render="(\d+)"/)[1];
    const openFile = fs.promises.open;
    // A piece that takes a while, as a 16 MB one does on a slow disk.
    fs.promises.open = async (...args) => {
        const handle = await openFile(...args);
        const read = handle.read.bind(handle);
        handle.read = async (...rest) => (await new Promise(resolve => setTimeout(resolve, 50)), read(...rest));
        return handle;
    };
    try {
        const inFlight = panel.listener({ type: 'read', file: map.id, id: 1, at: 0, mtime: map.mtime, render: oldRender });
        await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
        const replaced = replies.length;
        // A piece the old page asked for before it went, and one whose message arrives after.
        await panel.listener({ type: 'read', file: map.id, id: 1, at: 16, mtime: map.mtime, render: oldRender });
        await inFlight;
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.deepEqual(replies.slice(replaced).filter(m => m.type === 'readReply'), []);
        // The new page reads as before.
        const newRender = panel.webview.html.match(/data-render="(\d+)"/)[1];
        await panel.listener({ type: 'read', file: map.id, id: 1, at: 0, mtime: listed(panel)[0].mtime, render: newRender });
        assert.equal(new TextDecoder().decode(replies.at(-1).chunk), 'the map');
    } finally {
        fs.promises.open = openFile;
    }
});

test('a $ pattern in the extension\'s path reaches the page\'s base as written', async () => {
    const real = fileURLToPath(new URL('../../packages/mesh-splat', import.meta.url));
    const odd = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-splat-')), "ext$&$'x");
    fs.mkdirSync(odd);
    for (const name of ['dist', 'package.json']) fs.symlinkSync(path.join(real, name), path.join(odd, name));
    const root = workspace({ 'map.pcd': 'map' });
    const env = loadExtension({ workspace: root, extension: path.join(real, 'extension.js'), root: odd, globalStorage: path.join(root, 'storage') });
    env.activate();
    const panel = fakePanel();
    await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(path.join(root, 'map.pcd')) }, panel);
    assert.equal((panel.webview.html.match(/<head>/g) ?? []).length, 1);
    assert.match(panel.webview.html, /<base href="[^"]*ext\$&\$'x\/dist\/">/);
});

test('an image reply names its page\'s render, and an old page\'s image request gets none', async () => {
    const replies = [];
    const { panel, url } = await open({ 'maps/map.yaml': 'image: map.pgm', 'maps/map.pgm': 'P5 cells', 'scan.pcd': 'scan' }, { postMessage: m => replies.push(m) });
    const [yaml] = listed(panel);
    const renderOf = () => panel.webview.html.match(/data-render="(\d+)"/)[1];
    const oldRender = renderOf();
    await panel.listener({ type: 'readImage', id: 1, file: yaml.id, path: 'map.pgm', render: oldRender });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(replies.at(-1).render, oldRender);
    await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
    const before = replies.length;
    await panel.listener({ type: 'readImage', id: 1, file: yaml.id, path: 'map.pgm', render: oldRender });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(replies.slice(before), []);
});

test('the roots change with the page that needs them, not while the old page is still shown', async () => {
    const { env, panel } = await open({ 'map.pcd': 'map' });
    const elsewhere = workspace({ 'maps/big.pcd': 'far away' });
    const roots = () => panel.webview.options.localResourceRoots.map(root => root.fsPath);
    const stat = env.vscode.workspace.fs.stat;
    let release;
    const held = new Promise(resolve => { release = resolve; });
    env.vscode.workspace.fs.stat = async uri => (await held, stat(uri));
    const adding = panel.listener({ type: 'addPaths', uris: [pathToFileURL(path.join(elsewhere, 'maps/big.pcd')).href] });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(!roots().includes(path.join(elsewhere, 'maps')), 'the old page keeps its roots until it is replaced');
    release();
    await adding;
    assert.ok(roots().includes(path.join(elsewhere, 'maps')));
    assert.deepEqual(names(panel), ['map.pcd', 'big.pcd']);
});

test('an old page\'s late readDone does not close the new page\'s read of the same id', async () => {
    const replies = [];
    const { panel, url } = await open({ 'map.pcd': 'the map', 'scan.pcd': 'scan' }, { postMessage: m => replies.push(m) });
    const renderOf = () => panel.webview.html.match(/data-render="(\d+)"/)[1];
    const oldRender = renderOf();
    await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
    const [map] = listed(panel);
    await panel.listener({ type: 'read', file: map.id, id: 1, at: 0, mtime: map.mtime, render: renderOf() });
    await panel.listener({ type: 'readDone', file: map.id, id: 1, render: oldRender });
    await panel.listener({ type: 'read', file: map.id, id: 1, at: 3, mtime: map.mtime, render: renderOf() });
    const last = replies.at(-1);
    assert.equal(last.error, undefined, last.error);
    assert.equal(new TextDecoder().decode(last.chunk), ' map');
});

test('while the opened file is gone, the view\'s files do not change', async () => {
    const { env, panel, at, url } = await open({ 'map.pcd': 'map', 'scan.pcd': 'scan', 'more.pcd': 'more' });
    await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
    const watchers = env.state.watchers.length;
    fs.rmSync(at('map.pcd'));
    await env.state.watchers[0].delete({ fsPath: at('map.pcd') });
    await panel.listener({ type: 'removeFile', file: listed(panel)[1].id });
    await panel.listener({ type: 'addPaths', uris: [url('more.pcd')] });
    assert.equal(env.state.watchers.filter(w => !w.disposed).length, watchers, 'no watcher was dropped or added');
    fs.writeFileSync(at('map.pcd'), 'map again');
    await env.state.watchers[0].create({ fsPath: at('map.pcd') });
    assert.deepEqual(names(panel), ['map.pcd', 'scan.pcd']);
});

test('a STEP view takes no added files', async () => {
    const { env, panel, at, url } = await open({ 'part.stp': 'ISO-10303-21;', 'scan.pcd': 'scan' });
    assert.match(panel.webview.html, /data-adds=""/);
    await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
    env.state.openDialogResult = [env.vscode.Uri.file(at('scan.pcd'))];
    await panel.listener({ type: 'addFiles' });
    assert.deepEqual(names(panel), ['part.stp']);
});

test('the opened file under another spelling of its path is not added again', async () => {
    const { panel, root, at } = await open({ 'map.pcd': 'map' });
    fs.symlinkSync(at('map.pcd'), path.join(root, 'link.pcd'));
    const upper = at('MAP.PCD');
    const uris = [path.join(root, 'link.pcd'), ...(fs.existsSync(upper) ? [upper] : [])].map(file => pathToFileURL(file).href);
    await panel.listener({ type: 'addPaths', uris });
    assert.deepEqual(names(panel), ['map.pcd']);
});

test('a render that saw the opened file gone, finishing after a newer one, still lets files be added', async () => {
    const { env, panel, at, url } = await open({ 'map.pcd': 'map', 'scan.pcd': 'scan' });
    const [watcher] = env.state.watchers;
    const stat = env.vscode.workspace.fs.stat;
    // A rename-style save: the change's stat finds the file missing and answers late; the create's finds it back.
    let first = true;
    env.vscode.workspace.fs.stat = async uri => {
        if (first) {
            first = false;
            await new Promise(resolve => setTimeout(resolve, 50));
            throw new Error('ENOENT');
        }
        return stat(uri);
    };
    fs.writeFileSync(at('map.pcd'), 'saved map');
    await Promise.all([watcher.change({ fsPath: at('map.pcd') }), watcher.create({ fsPath: at('map.pcd') })]);
    await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
    assert.deepEqual(names(panel), ['map.pcd', 'scan.pcd']);
});

test('a delete event for the opened file that arrives after it is back does not lock the view\'s files', async () => {
    const { env, panel, at, url } = await open({ 'map.pcd': 'map', 'scan.pcd': 'scan' });
    const [watcher] = env.state.watchers;
    fs.writeFileSync(at('map.pcd'), 'saved map');
    await watcher.create({ fsPath: at('map.pcd') });
    await watcher.delete({ fsPath: at('map.pcd') });
    await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
    assert.deepEqual(names(panel), ['map.pcd', 'scan.pcd']);
});

test('closing the tab while a render waits on its stat ends that render quietly', async () => {
    const { env, panel, at } = await open({ 'map.pcd': 'map' });
    const [watcher] = env.state.watchers;
    const html = panel.webview.html;
    const stat = env.vscode.workspace.fs.stat;
    let release;
    const held = new Promise(resolve => { release = resolve; });
    env.vscode.workspace.fs.stat = async uri => (await held, stat(uri));
    fs.writeFileSync(at('map.pcd'), 'saved map');
    const rendering = watcher.change({ fsPath: at('map.pcd') });
    panel.dispose();
    release();
    await rendering;
    assert.equal(panel.webview.html, html, 'a closed tab gets no page');
});

test('a deleted added file re-renders the view with that file shown missing', async () => {
    const { env, panel, at, url } = await open({ 'map.pgm': 'P5', 'scan.pcd': 'scan' });
    await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
    const watcher = env.state.watchers.find(({ pattern }) => pattern.pattern === 'scan.pcd');
    fs.rmSync(at('scan.pcd'));
    await watcher.delete?.({ fsPath: at('scan.pcd') });
    assert.deepEqual(listed(panel).map(file => [file.name, !!file.missing]), [['map.pgm', false], ['scan.pcd', true]]);
    // A deleted file is like a removed one: the view stays.
    assert.match(panel.webview.html, /data-keep="1"/);
});

test('an added file deleted and later written again comes back with the view kept', async () => {
    const { env, panel, at, url } = await open({ 'map.pgm': 'P5', 'scan.pcd': 'scan' });
    await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
    const watcher = env.state.watchers.find(({ pattern }) => pattern.pattern === 'scan.pcd');
    fs.rmSync(at('scan.pcd'));
    await watcher.delete({ fsPath: at('scan.pcd') });
    fs.writeFileSync(at('scan.pcd'), 'new scan');
    await watcher.create({ fsPath: at('scan.pcd') });
    assert.deepEqual(listed(panel).map(file => [file.name, !!file.missing]), [['map.pgm', false], ['scan.pcd', false]]);
    assert.match(panel.webview.html, /data-keep="1"/, 'the page shown missing is replaced, not the view reset');
    // A change to the file once back resets the view as before.
    fs.writeFileSync(at('scan.pcd'), 'changed scan');
    await watcher.change({ fsPath: at('scan.pcd') });
    assert.match(panel.webview.html, /data-keep=""/);
});

test('a delete event for an added file that is already back (a rename-style save) does not re-render', async () => {
    const { env, panel, at, url } = await open({ 'map.pgm': 'P5', 'scan.pcd': 'scan' });
    await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
    const watcher = env.state.watchers.find(({ pattern }) => pattern.pattern === 'scan.pcd');
    fs.writeFileSync(at('scan.pcd'), 'saved scan');
    await watcher.create({ fsPath: at('scan.pcd') });
    const html = panel.webview.html;
    await watcher.delete({ fsPath: at('scan.pcd') });
    assert.equal(panel.webview.html, html, 'every file would be read again');
});

test('a render whose stat passed before the opened file was deleted does not unlock the view\'s files', async () => {
    const { env, panel, at, url } = await open({ 'map.pcd': 'map', 'scan.pcd': 'scan' });
    const [watcher] = env.state.watchers;
    const stat = env.vscode.workspace.fs.stat;
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let first = true;
    env.vscode.workspace.fs.stat = async uri => {
        if (!first) return stat(uri);
        first = false;
        const result = await stat(uri);
        await held;
        return result;
    };
    const rendering = watcher.change({ fsPath: at('map.pcd') });
    await new Promise(resolve => setTimeout(resolve, 20));
    fs.rmSync(at('map.pcd'));
    await watcher.delete({ fsPath: at('map.pcd') });
    release();
    await rendering;
    const watchers = env.state.watchers.length;
    await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
    assert.equal(env.state.watchers.length, watchers, 'nothing is added while the opened file is gone');
});

test('a file added while the opened file\'s delete is being checked is refused', async () => {
    const { env, panel, at, url } = await open({ 'map.pcd': 'map', 'scan.pcd': 'scan' });
    const [watcher] = env.state.watchers;
    fs.rmSync(at('map.pcd'));
    const deleting = watcher.delete({ fsPath: at('map.pcd') });
    const watchers = env.state.watchers.length;
    await panel.listener({ type: 'addPaths', uris: [url('scan.pcd')] });
    await deleting;
    assert.equal(env.state.watchers.length, watchers);
});

test('an add and a remove sent while a late delete of the opened file is checked run once it is found there', async () => {
    const { env, panel, at, url } = await open({ 'map.pcd': 'map', 'a.pcd': 'a', 'b.pcd': 'b' });
    await panel.listener({ type: 'addPaths', uris: [url('a.pcd')] });
    const [watcher] = env.state.watchers;
    // A rename-style save whose delete event comes after the create: the file is there.
    const deleting = watcher.delete({ fsPath: at('map.pcd') });
    const a = listed(panel)[1];
    await panel.listener({ type: 'addPaths', uris: [url('b.pcd')] });
    await panel.listener({ type: 'removeFile', file: a.id });
    await deleting;
    assert.deepEqual(names(panel), ['map.pcd', 'b.pcd']);
});

test('a file added after the tab closed starts no watcher or reader', async () => {
    const { env, panel, at, url } = await open({ 'map.pcd': 'map', 'a.pcd': 'a', 'b.pcd': 'b' });
    let pick;
    env.vscode.window.showOpenDialog = () => new Promise(resolve => { pick = resolve; });
    const adding = panel.listener({ type: 'addFiles' });
    panel.dispose();
    pick([env.vscode.Uri.file(at('a.pcd'))]);
    await adding;
    await panel.listener({ type: 'addPaths', uris: [url('b.pcd')] });
    assert.deepEqual(env.state.watchers.filter(w => !w.disposed), []);
});

test('two files whose 64-bit file ids differ only past 2^53 (NTFS) are two files', async () => {
    const { panel, at, url } = await open({ 'scan_a.pcd': 'a', 'scan_b.pcd': 'b' });
    // As Node on Windows: the file id is exact as a bigint, rounded as a Number.
    const ids = { [at('scan_a.pcd')]: 2n ** 60n + 1n, [at('scan_b.pcd')]: 2n ** 60n + 2n };
    const statSync = fs.statSync;
    fs.statSync = (file, options) => {
        const stats = statSync(file, options);
        if (!stats || !(file in ids)) return stats;
        return Object.assign(stats, options?.bigint ? { ino: ids[file], dev: 7n } : { ino: Number(ids[file]), dev: 7 });
    };
    try {
        await panel.listener({ type: 'addPaths', uris: [url('scan_b.pcd')] });
    } finally {
        fs.statSync = statSync;
    }
    assert.deepEqual(names(panel), ['scan_a.pcd', 'scan_b.pcd']);
});
