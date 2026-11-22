const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cacheWriter, fileReader, READ_PIECE } = require('./io');

const escapeAttr = text => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const CAD = /\.(ste?p|ige?s)$/i;
const IMAGE = /\.(pgm|png|jpe?g|bmp|gif|webp)$/i;
const extensionOf = file => path.extname(file).slice(1).toLowerCase();
const inside = (dir, file) => {
    const relative = path.relative(dir, file);
    return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
// macOS and Windows disks ignore case by default, so map.pcd and MAP.PCD are one file there.
const samePath = (a, b) => (['darwin', 'win32'].includes(process.platform) ? a.toLowerCase() === b.toLowerCase() : a === b);
// A link to a file in the view is that file too. Some file systems report no inode (0); then only the path tells.
// NTFS file ids are 64-bit and pass 2^53, so as Numbers two files could compare equal: they are read as bigints.
const sameFile = (a, b) => {
    if (samePath(a, b)) return true;
    const [x, y] = [a, b].map(file => fs.statSync(file, { throwIfNoEntry: false, bigint: true }));
    return Boolean(x?.ino && x.ino === y?.ino && x.dev === y.dev);
};
// VS Code's glob cannot escape ']' (it always ends a range), so glob characters match any one character and the
// event's path decides.
const globSafe = name => name.replace(/[[\]{}*?]/g, '?');

// Tessellating a STEP assembly takes seconds (foxtrot) to minutes (OpenCascade), so the webview sends back
// its tessellation (meshopt-encoded, see webview/step-cache.mjs) and later opens of the same file (path, mtime,
// size, `build`) load that instead. `build` names the extension version and the tessellators' WASM, so a
// rebuilt foxtrot or OpenCascade drops old entries even without a version bump.
function stepCache(cacheDir, fileUri, stat, build) {
    if (!cacheDir || !CAD.test(fileUri.path)) return null;
    const prefix = crypto.createHash('sha1').update(fileUri.path).digest('hex').slice(0, 16);
    return { prefix, uri: vscode.Uri.joinPath(cacheDir, `${prefix}-${stat.mtime}-${stat.size}-${build}.meshopt`) };
}

// The Display menu's grid / axes / bounds, as last left for each kind of model, open the next file.
const HELPERS_KEY = 'displayHelpers';
const HELPER_NAMES = ['grid', 'axes', 'bounds'];
// Whether a USD view picks parts under the pointer, as last left.
const PICK_KEY = 'pickParts';
// Point size and Original / Height colouring are kept for every file; the up axis is the file's own convention, so
// it is kept per file, the 500 last chosen.
const SETTINGS_KEY = 'viewSettings';
const UP_AXES = ['+Z', '-Z', '+Y', '-Y', '+X', '-X'];
const MAX_UP_FILES = 500;
function mergeSettings(saved = {}, message, file) {
    const next = { ...saved, upByFile: { ...saved.upByFile } };
    if ([1, 2, 4].includes(message.pointSize)) next.pointSize = message.pointSize;
    if (['rgb', 'height'].includes(message.colorMode)) next.colorMode = message.colorMode;
    if (UP_AXES.includes(message.up)) {
        delete next.upByFile[file];
        next.upByFile[file] = message.up;
        for (const old of Object.keys(next.upByFile).slice(0, -MAX_UP_FILES)) delete next.upByFile[old];
    }
    return next;
}
// retainContextWhenHidden keeps a hidden tab's page, so switching back is instant, but a GB point cloud then holds
// its memory (+1.2–1.5 GB for the 1.2 GB Livox map) until the tab closes. A view whose files add up to RELEASE_BYTES
// drops its page once hidden for RELEASE_AFTER_MS and loads again, the camera kept, when shown: reopening costs
// seconds (5 s for that map), so a quick look at another tab keeps it, and smaller files always do. A page still
// loading (OpenCascade can take 25 minutes) is left alone until it says it is done.
const RELEASE_BYTES = 100 * 1024 * 1024;
const RELEASE_AFTER_MS = 5 * 60 * 1000;
const RELEASED_HTML = '<!DOCTYPE html><html><body style="background: var(--vscode-editor-background)"></body></html>';
const validHelpers = helpers => Object.fromEntries(['cloud', 'map', 'model'].filter(kind => Array.isArray(helpers?.[kind]))
    .map(kind => [kind, helpers[kind].filter(name => HELPER_NAMES.includes(name))]));

// A file that is gone stays listed (with no stat), so its row can say so. `keep` is only for a render after a file
// was added or removed: a changed file resets the view, as it did before views held several files.
async function renderHtml(template, webview, distUri, files, cache, turn, keep, helpers, pick, settings) {
    const source = webview.cspSource;
    const csp = [
        "default-src 'none'",
        `script-src ${source} 'wasm-unsafe-eval'`,
        `style-src ${source} 'unsafe-inline'`,
        `img-src ${source} blob: data:`,
        `connect-src ${source} blob: data:`,
        'worker-src blob: data:'
    ].join('; ');
    const list = files.map(({ id, uri, stat }) => ({
        id,
        src: `${webview.asWebviewUri(uri)}?v=${stat?.mtime}`,
        name: path.basename(uri.path),
        bytes: stat?.size ?? 0,
        mtime: stat?.mtime ?? 0,
        ...(stat ? {} : { missing: true })
    }));
    const [opened] = list;
    const data = {
        src: opened.src,
        name: opened.name,
        bytes: opened.bytes,
        mtime: opened.mtime,
        file: opened.id,
        files: JSON.stringify(list),
        adds: files[0].takesFiles ? 1 : '',
        keep: keep ? 1 : '',
        key: cache ? path.basename(cache.uri.fsPath) : '',
        piece: READ_PIECE,
        render: turn,
        cached: cache ? await vscode.workspace.fs.stat(cache.uri).then(() => webview.asWebviewUri(cache.uri), () => '') : '',
        helpers: JSON.stringify(helpers),
        pick: String(pick),
        settings: JSON.stringify({ pointSize: settings.pointSize, colorMode: settings.colorMode, up: settings.upByFile?.[files[0].uri.fsPath] })
    };
    return template
        .replace(/<html lang="[^"]*">/, `<html lang="${vscode.env.language}">`)
        .replace('<head>', () => `<head><meta http-equiv="Content-Security-Policy" content="${csp}"><base href="${webview.asWebviewUri(distUri)}/">`)
        // A function, so a `$'` or `$&` in a file name is not read as a replacement pattern.
        .replace('<body>', () => `<body ${Object.entries(data).map(([key, value]) => `data-${key}="${escapeAttr(value)}"`).join(' ')}>`);
}

async function saveScreenshot(fileUri, data) {
    if (typeof data !== 'string' || !data) return;
    const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(fileUri, '..', `${path.parse(fileUri.path).name}.png`),
        filters: { 'PNG image': ['png'] }
    });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, Buffer.from(data, 'base64'));
    vscode.window.setStatusBarMessage(`Robot Preview: saved ${vscode.workspace.asRelativePath(target.fsPath)}`, 4000);
}

function activate(context) {
    const distUri = vscode.Uri.joinPath(context.extensionUri, 'dist');
    const cacheDir = context.globalStorageUri && vscode.Uri.joinPath(context.globalStorageUri, 'step-cache');
    const template = fs.readFileSync(path.join(distUri.fsPath, 'index.html'), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(context.extensionUri.fsPath, 'package.json'), 'utf8'));
    // The USD extension shares this file but ships no tessellators: it never opens STEP.
    const tessellators = crypto.createHash('sha1');
    for (const wasm of ['foxtrot_bg.wasm', 'occt-import-js.wasm']) {
        const file = path.join(distUri.fsPath, wasm);
        if (fs.existsSync(file)) tessellators.update(fs.readFileSync(file));
    }
    const build = `${manifest.version}-${tessellators.digest('hex').slice(0, 8)}`;
    const { customEditors } = manifest.contributes;
    // Files can be added from the types this extension opens, less STEP and IGES, which start +Y and keep
    // their own cache path; a STEP or IGES view takes no added files for the same reason.
    const extensions = [...new Set(customEditors.flatMap(editor => editor.selector)
        .map(({ filenamePattern }) => filenamePattern?.match(/^\*\.(\w+)$/)?.[1]?.toLowerCase())
        .filter(ext => ext && !CAD.test(`.${ext}`)))];
    // The USD extension ships this file too; its views take no added files until its docs say they do.
    const addsFiles = customEditors.some(({ viewType }) => viewType.startsWith('robotPreviewMeshSplat.'));
    // Open views, the one used last first, for Add to Point Cloud View and the Explorer's file list.
    const views = [];
    const viewWaiters = new Set();
    // Set once the file list is up: tells it a view opened, closed, came to the front or changed its files.
    let viewsChanged = () => {};
    const provider = {
        openCustomDocument: uri => ({ uri, dispose() {} }),
        async resolveCustomEditor(document, panel) {
            const dir = vscode.Uri.joinPath(document.uri, '..');
            const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
            const baseRoots = [distUri, dir, ...(folder ? [folder] : []), ...(cacheDir ? [cacheDir] : [])];
            panel.webview.options = { enableScripts: true, localResourceRoots: baseRoots };
            // A file outside the base roots brings its folder in for as long as it is in the view.
            const updateRoots = () => {
                const roots = [...baseRoots];
                for (const { uri } of files) if (!roots.some(root => inside(root.fsPath, uri.fsPath))) roots.push(vscode.Uri.joinPath(uri, '..'));
                panel.webview.options = { ...panel.webview.options, localResourceRoots: roots };
            };
            const takesFiles = addsFiles && !CAD.test(document.uri.path);
            // The page names the cache key it was rendered with: a save during tessellation re-renders with a
            // new key, and the old page's model must not be filed under it.
            const keys = new Map();
            const post = message => panel.webview.postMessage(message);
            const files = [];
            let nextId = 0;
            // A save can fire two events whose renders finish out of order; only the latest one writes the page.
            // It keeps the view only if no render since the last page was for a change.
            let renders = 0;
            let keeps = true;
            // While the opened file is gone no page can be rendered, so the list stays as the page shows it. A delete
            // marks it at once (an add while its stat is pending would pass); `deletes` tells a render whose stat
            // came before a delete that the file may be gone since.
            let openedGone = false;
            let deletes = 0;
            const exists = uri => vscode.workspace.fs.stat(uri).then(() => true, () => false);
            // A render still waiting on a stat when the tab closes would find no files (and a disposed webview).
            let disposed = false;
            // A released page renders again when shown; a change meanwhile only marks the view as not kept.
            let released = false;
            let visible = panel.visible !== false;
            let shownBytes = 0;
            let loadedRender = null;
            let releaseTimer = null;
            const render = async (keep = false) => {
                const turn = ++renders;
                const seen = deletes;
                keeps &&= keep;
                if (released) return;
                const stats = await Promise.all(files.map(file => vscode.workspace.fs.stat(file.uri).catch(() => null)));
                if (disposed) return;
                // A rename-style save removes the file for a moment; the create that follows renders again. A render
                // whose stat answered late must not mark the file gone after a newer one found it back.
                if (!stats[0]) {
                    if (turn === renders) openedGone = true;
                    return;
                }
                const cache = stepCache(cacheDir, document.uri, stats[0], build);
                const html = await renderHtml(template, panel.webview, distUri, files.map((file, i) => ({ ...file, stat: stats[i], takesFiles })), cache, turn, keeps,
                    context.globalState.get(HELPERS_KEY) ?? {}, context.globalState.get(PICK_KEY) ?? true, context.globalState.get(SETTINGS_KEY) ?? {});
                if (deletes !== seen && !(await exists(document.uri))) {
                    if (turn === renders) openedGone = true;
                    return;
                }
                if (turn !== renders || disposed || released) return;
                keeps = true;
                openedGone = false;
                if (cache) keys.set(path.basename(cache.uri.fsPath), cache.prefix);
                // The old page goes without saying its reads are done; their handles would stay open until the tab
                // closes. Its read ids restart at 1 on the new page, so a reply to it must not reach the new one: each
                // page gets fresh readers, and reads naming another render are dropped.
                files.forEach((file, i) => { file.shownMissing = !stats[i]; });
                for (const file of files) startReader(file);
                pageRender = String(turn);
                shownBytes = stats.reduce((sum, stat) => sum + (stat?.size ?? 0), 0);
                clearTimeout(releaseTimer);
                // Roots and page change together: roots changed first might reload the old page before the new
                // one lands (VS Code compares the options; not checked in a real window), and its reads are dropped.
                updateRoots();
                panel.webview.html = html;
                viewsChanged();
            };
            let pageRender = null;
            const release = () => {
                if (visible || disposed || loadedRender !== pageRender) return;
                released = true;
                for (const file of files) file.reader.dispose();
                pageRender = null;
                panel.webview.html = RELEASED_HTML;
            };
            const scheduleRelease = () => {
                clearTimeout(releaseTimer);
                if (!visible && !released && pageRender && loadedRender === pageRender && shownBytes >= RELEASE_BYTES) releaseTimer = setTimeout(release, RELEASE_AFTER_MS);
            };
            // A delete event can arrive after the create that follows it, so the file is looked at again; a render
            // started since decides instead. The opened file is marked gone until then.
            // An add or remove refused while that look is pending runs once the file is found there.
            let checking = 0;
            let refused = [];
            const openedDeleted = async () => {
                deletes++;
                openedGone = true;
                const turn = renders;
                checking++;
                const there = await exists(document.uri);
                checking--;
                if (there && turn === renders) openedGone = false;
                if (checking) return;
                const replay = refused;
                refused = [];
                if (!openedGone) for (const request of replay) await request();
            };
            const refuse = request => checking && refused.push(request);
            // A rename-style save of an added file is not a delete: re-rendering would read every file again.
            const addedDeleted = async file => {
                const turn = renders;
                if (await exists(file.uri) || turn !== renders || disposed || !files.includes(file)) return;
                await render(true);
            };
            const startReader = file => {
                file.reader?.dispose();
                const reader = fileReader(file.uri.fsPath, message => file.reader === reader && post({ ...message, file: file.id }));
                file.reader = reader;
            };
            const add = uri => {
                const id = String(nextId++);
                const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), globSafe(path.basename(uri.path))));
                const file = { id, uri, watcher, reader: null };
                // A file shown missing that is written again comes back like an added one, the view kept: a tool that
                // deletes a scan and writes it later would otherwise reset the view it kept over the delete.
                const changed = event => event && samePath(event.fsPath, uri.fsPath) && render(Boolean(file.shownMissing));
                // Editors that save by writing a new file and renaming it over the old one fire create, not change.
                watcher.onDidChange(changed);
                watcher.onDidCreate(changed);
                // An added file that is deleted shows as missing, the view kept as for a removed one. That page is
                // rendered by the extension, so it takes the view the page last saved, up to 300 ms old while the
                // camera moves (saveSoon in webview/main.js); an add or remove from the page saves first.
                const opened = !files.length;
                watcher.onDidDelete(event => event && samePath(event.fsPath, uri.fsPath) && (opened ? openedDeleted() : addedDeleted(file)));
                startReader(file);
                files.push(file);
            };
            const drop = file => {
                file.reader.dispose();
                file.watcher.dispose();
                files.splice(files.indexOf(file), 1);
            };
            add(document.uri);
            const addUris = async uris => {
                const fresh = uris.filter((uri, i) => takesFiles && extensions.includes(extensionOf(uri.path))
                    && !files.some(file => sameFile(file.uri.fsPath, uri.fsPath)) && uris.findIndex(other => sameFile(other.fsPath, uri.fsPath)) === i);
                if (!fresh.length || disposed) return;
                if (openedGone) return refuse(() => addUris(uris));
                fresh.forEach(add);
                await render(true);
            };
            // A read without a file id is for the opened file (a page rendered before files had ids).
            const fileOf = id => files.find(file => file.id === String(id ?? files[0].id));
            const handlers = {
                read: message => {
                    if (message.render !== undefined && String(message.render) !== pageRender) return;
                    const file = fileOf(message.file);
                    if (file) return file.reader.read(message.id, message.at, message.mtime);
                    post({ type: 'readReply', file: message.file, id: message.id, at: message.at, error: `no file ${message.file} in this view` });
                },
                // Sent once the page has loaded every file (or failed to).
                loaded: message => {
                    if (String(message.render) !== pageRender) return;
                    loadedRender = pageRender;
                    scheduleRelease();
                },
                readDone: message => (message.render === undefined || String(message.render) === pageRender) && fileOf(message.file)?.reader.done(message.id),
                stepCache: message => writer.receive(message),
                screenshot: message => saveScreenshot(document.uri, message.data),
                pick: message => context.globalState.update(PICK_KEY, message.on !== false),
                settings: message => context.globalState.update(SETTINGS_KEY, mergeSettings(context.globalState.get(SETTINGS_KEY), message, document.uri.fsPath)),
                helpers: message => context.globalState.update(HELPERS_KEY, { ...context.globalState.get(HELPERS_KEY), ...validHelpers(message.helpers) }),
                addFiles: async () => takesFiles && addUris(await vscode.window.showOpenDialog({
                    canSelectMany: true,
                    defaultUri: dir,
                    filters: { 'Mesh & Splat': extensions }
                }) ?? []),
                // Files are read by fsPath, which names a file on this extension host only for the opened file's
                // scheme; a bare path (Uri.parse would make it a file URI) or another scheme is skipped.
                addPaths: message => addUris((Array.isArray(message.uris) ? message.uris : [])
                    .filter(text => typeof text === 'string' && /^[a-z][\w+.-]+:/i.test(text))
                    .map(text => vscode.Uri.parse(text)).filter(uri => uri.scheme === document.uri.scheme)),
                // A map's image named by absolute path (Nav2's map_saver may write one) or relative to a YAML outside
                // the panel's roots cannot be fetched, so the page asks for its bytes, resolved against its YAML's
                // folder. A YAML is any text file, so only an image under the YAML's folder or a workspace folder is
                // read: a crafted YAML cannot pull other files off the disk.
                readImage: async message => {
                    // Image ids restart at 1 on every page too, so the reply names the page it is for.
                    if (message.render !== undefined && String(message.render) !== pageRender) return;
                    const reply = data => post({ type: 'imageReply', id: message.id, render: message.render, ...data });
                    try {
                        const yaml = message.file === undefined ? null : fileOf(message.file);
                        if (!yaml || typeof message.path !== 'string' || !IMAGE.test(message.path)) throw new Error('not a path to an image');
                        const named = path.resolve(path.dirname(yaml.uri.fsPath), message.path);
                        // Real paths, so a symlink inside cannot lead outside.
                        const real = file => fs.promises.realpath(file).catch(() => file);
                        const target = await real(named);
                        const folders = await Promise.all([path.dirname(yaml.uri.fsPath), ...(vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath)].map(real));
                        if (!folders.some(folder => inside(folder, target))) throw new Error(`${named} is outside the map's folder and the workspace`);
                        reply({ bytes: new Uint8Array(await fs.promises.readFile(target)) });
                    } catch (error) {
                        reply({ error: error.message });
                    }
                },
                removeFile: async message => {
                    const file = fileOf(message.file);
                    if (!file || file === files[0]) return;
                    if (openedGone) return refuse(() => handlers.removeFile(message));
                    drop(file);
                    await render(true);
                }
            };
            const writer = cacheWriter(cacheDir?.fsPath, keys, post);
            panel.webview.onDidReceiveMessage(message => Object.hasOwn(handlers, message?.type) && handlers[message.type](message));
            const view = {
                uri: document.uri,
                panel,
                takesFiles,
                addUris,
                files: () => files.map((file, i) => ({ id: file.id, uri: file.uri, opened: !i, missing: Boolean(file.shownMissing) })),
                remove: async ids => {
                    if (openedGone) return refuse(() => view.remove(ids));
                    const gone = files.filter((file, i) => i && ids.includes(file.id));
                    if (!gone.length) return;
                    gone.forEach(drop);
                    await render(true);
                }
            };
            views.unshift(view);
            viewWaiters.forEach(waiter => waiter(view));
            viewsChanged();
            panel.onDidChangeViewState(({ webviewPanel }) => {
                visible = webviewPanel.visible;
                if (!visible) scheduleRelease();
                else if (released) {
                    released = false;
                    render(true);
                } else clearTimeout(releaseTimer);
                if (!webviewPanel.active) return;
                views.splice(views.indexOf(view), 1);
                views.unshift(view);
                viewsChanged();
            });
            panel.onDidDispose(() => {
                disposed = true;
                clearTimeout(releaseTimer);
                views.splice(views.indexOf(view), 1);
                [...files].forEach(drop);
                writer.dispose();
                viewsChanged();
            });
            await render();
        }
    };
    const options = { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true };
    context.subscriptions.push(...customEditors.map(({ viewType }) => vscode.window.registerCustomEditorProvider(viewType, provider, options)));
    // Formats that are not opened by default open from a title button instead: .bin is too common a binary
    // extension (firmware, weights), and OBJ, glTF, DAE, VRML and XYZ are text people edit (XYZ is also a
    // molecule format). Only this package contributes the commands: the USD extension ships this file too.
    const contributes = id => manifest.contributes.commands?.some(({ command }) => command === id);
    for (const id of ['robotPreviewMeshSplat.openAsPoints', 'robotPreviewMeshSplat.open3D']) {
        if (!contributes(id)) continue;
        context.subscriptions.push(vscode.commands.registerCommand(id, uri => {
            uri ??= vscode.window.activeTextEditor?.document.uri ?? vscode.window.tabGroups?.activeTabGroup.activeTab?.input?.uri;
            if (uri) return vscode.commands.executeCommand('vscode.openWith', uri, 'robotPreviewMeshSplat.textPoints');
        }));
    }
    // Dragging files onto a webview reaches it only while Shift is held, else VS Code opens each in a tab; the
    // Explorer menu adds a selection to the view used last, or opens one for it.
    if (contributes('robotPreviewMeshSplat.addToView')) {
        const viewOf = uri => views.find(view => view.takesFiles && sameFile(view.uri.fsPath, uri.fsPath));
        // The view registers while its editor resolves, which may finish after openWith returns.
        const waitForView = uri => viewOf(uri) ? Promise.resolve(viewOf(uri)) : new Promise(resolve => {
            const waiter = view => sameFile(view.uri.fsPath, uri.fsPath) && done(view);
            const timer = setTimeout(() => done(null), 10000);
            const done = view => {
                clearTimeout(timer);
                viewWaiters.delete(waiter);
                resolve(view);
            };
            viewWaiters.add(waiter);
        });
        const addToView = async uris => {
            if (!uris.length) return;
            let view = views.find(candidate => candidate.takesFiles);
            if (view) {
                view.panel.reveal();
                return view.addUris(uris.filter(uri => uri.scheme === view.uri.scheme));
            }
            const [first, ...rest] = uris;
            // The first editor whose pattern names the file: the default one comes first, so a .pcd.bin is its.
            const name = path.basename(first.path).toLowerCase();
            const { viewType } = customEditors.find(editor => editor.selector.some(({ filenamePattern }) =>
                name.endsWith(filenamePattern.slice(1).toLowerCase()))) ?? { viewType: 'robotPreviewMeshSplat.viewer' };
            const opened = waitForView(first);
            await vscode.commands.executeCommand('vscode.openWith', first, viewType);
            view = await opened;
            if (view && rest.length) await view.addUris(rest);
        };
        context.subscriptions.push(vscode.commands.registerCommand('robotPreviewMeshSplat.addToView', (clicked, selected) =>
            addToView((Array.isArray(selected) && selected.length ? selected : [clicked]).filter(Boolean))));
        if (contributes('robotPreviewMeshSplat.removeFromView')) context.subscriptions.push(fileList(addToView));
    }

    // A drag from the Explorer never reaches a webview on macOS (docs/mesh-splat.md), but a tree view takes it:
    // this list in the Explorer shows the files of the view used last and adds what is dropped on it, opening a
    // view for the first file when none is open.
    function fileList(addToView) {
        const changed = new vscode.EventEmitter();
        const current = () => views.find(view => view.takesFiles);
        const tree = vscode.window.createTreeView('robotPreviewMeshSplat.files', {
            canSelectMany: true,
            treeDataProvider: {
                onDidChangeTreeData: changed.event,
                getChildren: element => (element ? [] : current()?.files() ?? []),
                getTreeItem: file => {
                    const item = new vscode.TreeItem(file.uri, vscode.TreeItemCollapsibleState.None);
                    // The folder relative to the workspace (none for its root), or the whole folder outside it.
                    const folder = path.dirname(vscode.workspace.asRelativePath(file.uri, false));
                    item.description = file.missing ? 'not found' : folder === '.' ? '' : folder;
                    item.tooltip = file.uri.fsPath;
                    item.contextValue = file.opened ? 'opened' : 'added';
                    return item;
                }
            },
            dragAndDropController: {
                dropMimeTypes: ['text/uri-list', 'files'],
                dragMimeTypes: [],
                async handleDrop(target, transfer) {
                    const uris = [];
                    const list = transfer.get('text/uri-list');
                    for (const line of list ? (await list.asString()).split(/\r?\n/) : []) {
                        const text = line.trim();
                        if (!text || text.startsWith('#')) continue;
                        try {
                            uris.push(vscode.Uri.parse(text, true));
                        } catch {
                            // Not a URI: skipped like any other file the view cannot show.
                        }
                    }
                    // Files from the operating system, where VS Code hands them over as files rather than a URI list.
                    transfer.forEach(item => {
                        const file = item.asFile?.();
                        if (file?.uri && !uris.some(uri => sameFile(uri.fsPath, file.uri.fsPath))) uris.push(file.uri);
                    });
                    await addToView(uris.filter(uri => extensions.includes(extensionOf(uri.path))));
                }
            }
        });
        viewsChanged = () => {
            const view = current();
            tree.description = view ? path.basename(view.uri.path) : '';
            vscode.commands.executeCommand('setContext', 'robotPreviewMeshSplat.hasView', Boolean(view));
            changed.fire();
        };
        viewsChanged();
        const remove = vscode.commands.registerCommand('robotPreviewMeshSplat.removeFromView', (clicked, selected) => {
            const chosen = (Array.isArray(selected) && selected.length ? selected : [clicked]).filter(Boolean);
            return current()?.remove(chosen.map(file => file.id));
        });
        return { dispose: () => [tree, remove, changed].forEach(item => item.dispose()) };
    }
}

module.exports = { activate, deactivate() {} };
