const vscode = require('vscode');
const path = require('path');
const fs = require('fs/promises');

const ASSET_RE = /\.(urdf|xacro|xml|stl|dae|obj|mtl|png|jpe?g|msh|ya?ml)$/i;
const MODEL_RE = /\.(urdf|xacro|xml)$/i;
const REF_RE = /package:\/\/([^/\s"'<>]+)|\$\(find\s+([^)\s]+)\)/g;
const INCLUDE_RE = /<(?:xacro:include|include)\b[^>]*?\b(?:filename|file)\s*=\s*["']([^"']+)["']/g;
const ELEMENT_RE = /<(link|joint|body)\b[^>]*?\bname\s*=\s*["']([^"']+)["'][^>]*?(\/?)>/g;
const PROPERTY_RE = /<xacro:property\s+name\s*=\s*["']([\w-]+)["']\s+value\s*=\s*["']([^"']*)["']/g;
const SKIP_DIRS = new Set(['node_modules', 'build', 'install', 'log']);
const UPDATE_DELAY_MS = 300;
const CURSOR_DELAY_MS = 100;

function updateLimitBlock(block, limits) {
    const values = Object.entries(limits)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, Number(Number(value).toFixed(6))]);
    const limitTag = block.match(/<limit\b[^>]*?\/?>/)?.[0];
    if (limitTag) {
        let tag = limitTag;
        for (const [key, value] of values) {
            const attr = new RegExp(`\\b${key}\\s*=\\s*["'][^"']*["']`);
            tag = attr.test(tag) ? tag.replace(attr, `${key}="${value}"`) : tag.replace(/\s*(\/?)>$/, ` ${key}="${value}"$1>`);
        }
        return block.replace(limitTag, tag);
    }
    const indent = block.match(/\n([ \t]*)<(?!\/joint)/)?.[1] ?? '    ';
    const attrs = values.map(([key, value]) => `${key}="${value}"`).join(' ');
    return block.replace(/(\s*)<\/joint>$/, `\n${indent}<limit ${attrs}/>$1</joint>`);
}

function renderHtml(html, webview, distUri) {
    const source = webview.cspSource;
    const csp = [
        "default-src 'none'",
        `script-src ${source} 'unsafe-eval' 'wasm-unsafe-eval'`,
        `style-src ${source} 'unsafe-inline'`,
        `img-src ${source} blob: data:`,
        `connect-src ${source} blob: data:`,
        `font-src ${source} data:`,
        'media-src blob: data:',
        'worker-src blob:'
    ].join('; ');
    return html
        .replace(/<html lang="[^"]*">/, `<html lang="${vscode.env.language}">`)
        .replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}"><base href="${webview.asWebviewUri(distUri)}/">`);
}

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PLACEHOLDER_RE = /(\$\{[^}]*\}|\$\([^)]*\))/;
const namePattern = name => name.split(PLACEHOLDER_RE).map((part, i) => (i % 2 ? '.+?' : escapeRegex(part))).join('');
const literalLength = name => name.split(PLACEHOLDER_RE).filter((_, i) => i % 2 === 0).join('').length;

function expandProperties(text, name) {
    if (!name.includes('${')) return name;
    const properties = new Map(Array.from(text.matchAll(PROPERTY_RE), m => [m[1], m[2]]));
    for (let i = 0; i < 5 && /\$\{[\w-]+\}/.test(name); i++) {
        name = name.replace(/\$\{([\w-]+)\}/g, (match, key) => properties.get(key) ?? match);
    }
    return name;
}

async function readPackageName(dir) {
    try {
        const xml = await fs.readFile(path.join(dir, 'package.xml'), 'utf8');
        return xml.match(/<name>\s*([^<\s]+)\s*<\/name>/)?.[1] ?? null;
    } catch {
        return null;
    }
}

async function findPackageRoot(fileUri) {
    let dir = path.dirname(fileUri.fsPath);
    while (true) {
        const name = await readPackageName(dir);
        if (name) return { dir, name };
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

async function listDir(dir) {
    try {
        return await fs.readdir(dir);
    } catch {
        return [];
    }
}

async function buildPackageIndex() {
    const index = new Map();
    const add = async dir => {
        const name = await readPackageName(dir);
        if (name && !index.has(name)) index.set(name, dir);
    };
    for (const uri of await vscode.workspace.findFiles('**/package.xml', '**/{.git,node_modules,build,install,log}/**')) {
        await add(path.dirname(uri.fsPath));
    }
    for (const dir of (process.env.ROS_PACKAGE_PATH || '').split(path.delimiter).filter(Boolean)) {
        await add(dir);
        for (const name of await listDir(dir)) await add(path.join(dir, name));
    }
    const prefixes = (process.env.AMENT_PREFIX_PATH || '').split(path.delimiter).filter(Boolean);
    for (const distro of await listDir('/opt/ros')) prefixes.push(path.join('/opt/ros', distro));
    for (const prefix of prefixes) {
        const share = path.join(prefix, 'share');
        for (const name of await listDir(share)) await add(path.join(share, name));
    }
    return index;
}

let packageIndex = null;
const getPackageIndex = () => (packageIndex ??= buildPackageIndex());

async function walk(dir, out = [], visited = new Set()) {
    const real = await fs.realpath(dir).catch(() => null);
    if (!real || visited.has(real)) return out;
    visited.add(real);
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const isDir = entry.isSymbolicLink()
            ? (await fs.stat(full).catch(() => null))?.isDirectory() ?? false
            : entry.isDirectory();
        if (isDir) {
            if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(full, out, visited);
        } else if (ASSET_RE.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

const openDocument = fsPath => vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === fsPath);

async function versionOf(fsPath) {
    const doc = openDocument(fsPath);
    if (doc) return `doc:${doc.version}`;
    const stat = await fs.stat(fsPath).catch(() => null);
    return stat ? `disk:${stat.mtimeMs}:${stat.size}` : null;
}

async function readData(fsPath) {
    const doc = openDocument(fsPath);
    return doc ? new TextEncoder().encode(doc.getText()) : new Uint8Array(await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath)));
}

const modelCache = new Map();

async function modelInfo(fsPath, version) {
    const cached = modelCache.get(fsPath);
    if (cached?.version === version) return cached;
    const text = new TextDecoder().decode(await readData(fsPath));
    const info = {
        version,
        text,
        refs: Array.from(text.matchAll(REF_RE), m => m[1] || m[2]),
        includes: Array.from(text.matchAll(INCLUDE_RE), m => path.basename(m[1]))
    };
    modelCache.set(fsPath, info);
    return info;
}

async function listFiles(fileUri) {
    const start = await findPackageRoot(fileUri);
    const workspace = vscode.workspace.getWorkspaceFolder(fileUri);
    const rootDir = start?.dir ?? workspace?.uri.fsPath ?? path.dirname(fileUri.fsPath);
    const rootName = start?.name ?? path.basename(rootDir);
    const toKey = (name, dir, file) => `/${name}/` + path.relative(dir, file).split(path.sep).join('/');

    const entries = new Map();
    const roots = [];
    const missing = [];
    const includes = new Set();
    const seen = new Set([rootName]);
    const queue = [[rootName, rootDir]];
    while (queue.length) {
        const [name, dir] = queue.shift();
        roots.push(dir);
        for (const fsPath of await walk(dir)) {
            const version = await versionOf(fsPath);
            if (!version) continue;
            entries.set(toKey(name, dir, fsPath), { fsPath, version });
            if (!MODEL_RE.test(fsPath)) continue;
            const info = await modelInfo(fsPath, version);
            info.includes.forEach(include => includes.add(include));
            for (const ref of info.refs) {
                if (seen.has(ref)) continue;
                seen.add(ref);
                const refDir = (await getPackageIndex()).get(ref);
                if (refDir) queue.push([ref, refDir]);
                else missing.push(ref);
            }
        }
    }
    const paths = new Set(Array.from(entries.values(), entry => entry.fsPath));
    return { entries, paths, primary: toKey(rootName, rootDir, fileUri.fsPath), roots, missing, includes };
}

function closingEnd(text, tag, from) {
    const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'g');
    re.lastIndex = from;
    let depth = 1;
    let match;
    while ((match = re.exec(text))) {
        if (match[1]) {
            if (--depth === 0) return match.index + match[0].length;
        } else if (!match[2]) {
            depth++;
        }
    }
    return text.length;
}

function elementAt(text, offset) {
    const opens = Array.from(text.matchAll(ELEMENT_RE)).filter(match => match.index <= offset);
    for (let i = opens.length - 1; i >= 0; i--) {
        const [tag, tagName, name, selfClosing] = opens[i];
        const tagEnd = opens[i].index + tag.length;
        const end = selfClosing ? tagEnd : closingEnd(text, tagName, tagEnd);
        if (offset <= end) return { kind: tagName === 'joint' ? 'joint' : 'link', name };
    }
    return null;
}

function isRobotModel(doc) {
    if (doc.uri.scheme !== 'file') return false;
    if (/\.(urdf|xacro)$/i.test(doc.fileName)) return true;
    return /\.xml$/i.test(doc.fileName) && /<(mujoco|robot)\b/.test(doc.getText(new vscode.Range(0, 0, 50, 0)));
}

class Preview {
    constructor(context) {
        this.context = context;
        this.panel = null;
        this.primary = null;
        this.listing = null;
        this.sent = new Map();
        this.ready = false;
        this.dismissed = new Set();
        this.warned = new Set();
        this.watchers = [];
        this.watchedRoots = '';
        this.updateTimer = null;
        this.cursorTimer = null;
        this.lastHighlight = null;
        this.diagnostics = vscode.languages.createDiagnosticCollection('robot-viewer');
        this.syntaxDiagnostics = new Map();
    }

    contains(fsPath) {
        return fsPath === this.primary?.fsPath ||
            (this.listing?.paths.has(fsPath) && this.listing.includes.has(path.basename(fsPath)));
    }

    async show(uri) {
        if (!this.panel) this.createPanel();
        if (this.primary?.fsPath === uri.fsPath) return;
        this.primary = uri;
        this.panel.title = path.basename(uri.fsPath);
        this.sent = new Map();
        this.lastHighlight = null;
        this.clearDiagnostics();
        if (this.ready) await this.sync(true);
    }

    createPanel() {
        this.attachPanel(vscode.window.createWebviewPanel('robotViewer', 'Robot Viewer',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            { enableScripts: true, retainContextWhenHidden: true }));
    }

    async restore(panel, state) {
        const exists = state?.sourcePath && await fs.stat(state.sourcePath).then(() => true, () => false);
        if (!exists || this.panel) {
            panel.dispose();
            return;
        }
        this.attachPanel(panel);
        await this.show(vscode.Uri.file(state.sourcePath));
    }

    attachPanel(panel) {
        const distUri = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
        panel.webview.options = { enableScripts: true, localResourceRoots: [distUri] };
        this.panel = panel;
        this.ready = false;

        const subscription = panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
        panel.onDidDispose(() => {
            subscription.dispose();
            this.watchers.forEach(watcher => watcher.dispose());
            this.watchers = [];
            this.watchedRoots = '';
            if (this.primary) this.dismissed.add(this.primary.fsPath);
            this.clearDiagnostics();
            Object.assign(this, { panel: null, primary: null, listing: null, sent: new Map(), ready: false });
        });

        vscode.workspace.fs.readFile(vscode.Uri.joinPath(distUri, 'index.html')).then(buf => {
            panel.webview.html = renderHtml(new TextDecoder().decode(buf), panel.webview, distUri);
        });
    }

    clearDiagnostics() {
        this.syntaxDiagnostics.clear();
        this.diagnostics.clear();
    }

    onDiagnostics({ syntax, loadError }) {
        for (const [key, errors] of Object.entries(syntax || {})) {
            const fsPath = this.listing?.entries.get(key)?.fsPath;
            if (!fsPath) continue;
            this.syntaxDiagnostics.set(fsPath, errors.map(error => {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(error.line, error.column, error.line, error.column + 1),
                    error.message,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.source = 'Robot Viewer';
                return diagnostic;
            }));
        }
        this.diagnostics.clear();
        let hasSyntaxError = false;
        for (const [fsPath, diagnostics] of this.syntaxDiagnostics) {
            if (diagnostics.length === 0) continue;
            hasSyntaxError = true;
            this.diagnostics.set(vscode.Uri.file(fsPath), diagnostics);
        }
        if (loadError && !hasSyntaxError && this.primary) {
            const diagnostic = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), loadError, vscode.DiagnosticSeverity.Error);
            diagnostic.source = 'Robot Viewer';
            this.diagnostics.set(this.primary, [diagnostic]);
        }
    }

    async onMessage(msg) {
        if (msg?.type === 'ready') {
            this.ready = true;
            await this.sync(true);
        } else if (msg?.type === 'reveal') {
            await this.reveal(msg.kind, msg.name);
        } else if (msg?.type === 'editLimits') {
            await this.editLimits(msg.joint, msg.limits);
        } else if (msg?.type === 'settings') {
            await this.context.globalState.update('settings', msg.settings);
        } else if (msg?.type === 'diagnostics') {
            this.onDiagnostics(msg);
        } else if (msg?.type === 'error') {
            vscode.window.showErrorMessage(`Robot Viewer: ${msg.message}`);
        }
    }

    scheduleUpdate() {
        clearTimeout(this.updateTimer);
        this.updateTimer = setTimeout(() => this.sync(false), UPDATE_DELAY_MS);
    }

    async sync(full) {
        const primary = this.primary;
        if (!primary || !this.panel || !this.ready) return;
        try {
            const listing = await listFiles(primary);
            if (primary !== this.primary || !this.panel) return;
            this.listing = listing;
            this.watchRoots(listing.roots);

            const newMissing = listing.missing.filter(name => !this.warned.has(name));
            if (newMissing.length) {
                newMissing.forEach(name => this.warned.add(name));
                vscode.window.showWarningMessage(`Robot Viewer: ROS package not found: ${newMissing.join(', ')}`);
            }

            const changed = Array.from(listing.entries).filter(([key, entry]) => full || this.sent.get(key) !== entry.version);
            const removed = full ? [] : Array.from(this.sent.keys()).filter(key => !listing.entries.has(key));
            if (!full && changed.length === 0 && removed.length === 0) return;

            const files = await Promise.all(changed.map(async ([key, entry]) => ({ path: key, data: await readData(entry.fsPath) })));
            this.sent = new Map(Array.from(listing.entries, ([key, entry]) => [key, entry.version]));
            if (full) this.syntaxDiagnostics.clear();
            for (const fsPath of this.syntaxDiagnostics.keys()) {
                if (!listing.paths.has(fsPath)) this.syntaxDiagnostics.delete(fsPath);
            }
            this.panel.webview.postMessage(full
                ? { type: 'load', files, primary: listing.primary, sourcePath: primary.fsPath, settings: this.context.globalState.get('settings') }
                : { type: 'update', files, removed, primary: listing.primary });
        } catch (error) {
            vscode.window.showErrorMessage(`Robot Viewer: ${error.message}`);
        }
    }

    watchRoots(roots) {
        const key = roots.join('\n');
        if (key === this.watchedRoots) return;
        this.watchers.forEach(watcher => watcher.dispose());
        this.watchedRoots = key;
        this.watchers = roots.map(root => {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '**/*'));
            const onEvent = uri => ASSET_RE.test(uri.fsPath) && this.scheduleUpdate();
            watcher.onDidChange(onEvent);
            watcher.onDidCreate(onEvent);
            watcher.onDidDelete(onEvent);
            return watcher;
        });
    }

    onDocumentChanged(event) {
        if (this.panel && event.contentChanges.length && this.listing?.paths.has(event.document.uri.fsPath)) {
            this.scheduleUpdate();
        }
    }

    onSelectionChanged(event) {
        const doc = event.textEditor.document;
        if (!this.panel || !this.listing?.paths.has(doc.uri.fsPath)) return;
        clearTimeout(this.cursorTimer);
        this.cursorTimer = setTimeout(() => {
            const text = doc.getText();
            const element = elementAt(text, doc.offsetAt(event.selections[0].active));
            const highlight = element
                ? { kind: element.kind, pattern: namePattern(expandProperties(text, element.name)) }
                : { kind: null, pattern: null };
            const key = JSON.stringify(highlight);
            if (key === this.lastHighlight) return;
            this.lastHighlight = key;
            this.panel?.webview.postMessage({ type: 'highlight', ...highlight });
        }, CURSOR_DELAY_MS);
    }

    async findDefinitions(kind, name) {
        const tags = kind === 'joint' ? 'joint' : 'link|body';
        const re = new RegExp(`<(?:${tags})\\b[^>]*?\\bname\\s*=\\s*["']([^"']+)["'][^>]*>`, 'g');
        const files = [this.primary.fsPath, ...Array.from(this.listing.paths).filter(p => p !== this.primary.fsPath && MODEL_RE.test(p))];

        let exact = [];
        let fuzzy = [];
        for (const fsPath of files) {
            const version = await versionOf(fsPath);
            if (!version) continue;
            const { text } = await modelInfo(fsPath, version);
            for (const match of text.matchAll(re)) {
                const candidate = { fsPath, index: match.index, length: match[0].length, name: match[1], tag: match[0] };
                if (match[1] === name) {
                    exact.push(candidate);
                } else if (/\$[{(]/.test(match[1])) {
                    const expanded = expandProperties(text, match[1]);
                    if (new RegExp(`^(?:${namePattern(expanded)})$`).test(name)) fuzzy.push({ ...candidate, score: literalLength(expanded) });
                }
            }
        }
        const bestScore = Math.max(...fuzzy.map(c => c.score));
        fuzzy = fuzzy.filter(c => c.score === bestScore);
        if (kind === 'joint' && exact.length > 1 && exact.some(c => /\btype\s*=/.test(c.tag))) {
            exact = exact.filter(c => /\btype\s*=/.test(c.tag));
        }
        return { exact, fuzzy };
    }

    async editLimits(jointName, limits) {
        if (!this.listing) return;
        const target = (await this.findDefinitions('joint', jointName)).exact[0];
        if (!target || target.tag.endsWith('/>')) {
            vscode.window.setStatusBarMessage(`Robot Viewer: cannot write limits of "${jointName}" (not a literal URDF joint in source)`, 5000);
            return;
        }
        const doc = await vscode.workspace.openTextDocument(target.fsPath);
        const text = doc.getText();
        const close = text.indexOf('</joint>', target.index);
        if (close === -1) return;
        const end = close + '</joint>'.length;
        const block = text.slice(target.index, end);
        const updated = updateLimitBlock(block, limits);
        if (updated === block) return;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, new vscode.Range(doc.positionAt(target.index), doc.positionAt(end)), updated);
        await vscode.workspace.applyEdit(edit);
    }

    async reveal(kind, name) {
        if (!this.listing) return;
        const { exact, fuzzy } = await this.findDefinitions(kind, name);
        const candidates = exact.length ? exact : fuzzy;
        if (candidates.length === 0) {
            vscode.window.setStatusBarMessage(`Robot Viewer: "${name}" not found in source`, 4000);
            return;
        }

        let target = candidates[0];
        if (candidates.length > 1) {
            const items = await Promise.all(candidates.map(async candidate => {
                const doc = await vscode.workspace.openTextDocument(candidate.fsPath);
                const line = doc.positionAt(candidate.index).line + 1;
                const key = Array.from(this.listing.entries).find(([, entry]) => entry.fsPath === candidate.fsPath)?.[0].slice(1);
                return { label: candidate.name, description: `${key}:${line}`, candidate };
            }));
            target = (await vscode.window.showQuickPick(items, { placeHolder: name }))?.candidate;
            if (!target) return;
        }

        const doc = await vscode.workspace.openTextDocument(target.fsPath);
        const editors = vscode.window.visibleTextEditors;
        const viewColumn = editors.find(editor => editor.document === doc)?.viewColumn
            ?? editors.find(editor => editor.viewColumn !== this.panel?.viewColumn)?.viewColumn
            ?? vscode.ViewColumn.One;
        const selection = new vscode.Range(doc.positionAt(target.index), doc.positionAt(target.index + target.length));
        await vscode.window.showTextDocument(doc, { viewColumn, selection, preserveFocus: false });
    }

    onActiveEditorChanged(editor) {
        const doc = editor?.document;
        if (!doc || !isRobotModel(doc) || (this.panel && this.contains(doc.uri.fsPath))) return;
        if (this.panel || (vscode.workspace.getConfiguration('robotViewer').get('autoOpen') && !this.dismissed.has(doc.uri.fsPath))) {
            this.show(doc.uri);
        }
    }
}

exports.activate = context => {
    const preview = new Preview(context);
    context.subscriptions.push(preview.diagnostics);
    context.subscriptions.push(vscode.window.registerWebviewPanelSerializer('robotViewer', {
        deserializeWebviewPanel: (panel, state) => preview.restore(panel, state)
    }));
    const packageWatcher = vscode.workspace.createFileSystemWatcher('**/package.xml');
    const resetIndex = () => { packageIndex = null; };
    packageWatcher.onDidChange(resetIndex);
    packageWatcher.onDidCreate(resetIndex);
    packageWatcher.onDidDelete(resetIndex);

    context.subscriptions.push(
        packageWatcher,
        vscode.commands.registerCommand('robotViewer.open', uri => {
            uri = uri || vscode.window.activeTextEditor?.document.uri;
            if (!uri) return;
            preview.dismissed.delete(uri.fsPath);
            preview.show(uri);
            preview.panel?.reveal(undefined, true);
        }),
        vscode.window.onDidChangeActiveTextEditor(editor => preview.onActiveEditorChanged(editor)),
        vscode.workspace.onDidChangeTextDocument(event => preview.onDocumentChanged(event)),
        vscode.window.onDidChangeTextEditorSelection(event => preview.onSelectionChanged(event))
    );
    preview.onActiveEditorChanged(vscode.window.activeTextEditor);
};
