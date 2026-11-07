const vscode = require('vscode');
const path = require('path');
const url = require('url');
const os = require('os');
const fs = require('fs/promises');

const ASSET_RE = /\.(urdf|xacro|xml|stl|dae|obj|mtl|gltf|glb|bin|png|jpe?g|bmp|tga|tiff?|webp|msh|ya?ml)$/i;
// Files a mesh names internally, where the URDF cannot see them.
const SIDECAR_REFS = {
    obj: /^\s*mtllib\s+(.+?)\s*$/gm,
    mtl: /^\s*(?:map_\w+|bump|disp|decal|refl)\s+(?:.*\s)?(\S+)\s*$/gm,
    dae: /<init_from>\s*([^<]+?)\s*<\/init_from>/g
};
const MODEL_RE = /\.(urdf|xacro|xml)$/i;
const REF_RE = /(package|model):\/\/([^/\s"'<>]+)|\$\(find\s+([^)\s]+)\)/g;
const FILE_REF_RE = /\b(?:filename|file)\s*=\s*["']([^"']+)["']/g;
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

// ${workspaceFolder}, ${workspaceFolder:name}, ${env:VAR} and ~ as in VS Code's
// own settings; a relative path is taken from the first workspace folder.
function settingPath(value) {
    const folders = vscode.workspace.workspaceFolders || [];
    const first = folders[0]?.uri.fsPath ?? '';
    const expanded = String(value)
        .replace(/\$\{workspaceFolder:([^}]+)\}/g, (match, name) => folders.find(folder => folder.name === name)?.uri.fsPath ?? match)
        .replace(/\$\{workspaceFolder\}/g, first)
        .replace(/\$\{env:([^}]+)\}/g, (match, name) => process.env[name] ?? '')
        .replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(first, expanded);
}

async function buildPackageIndex() {
    const index = new Map();
    const configured = vscode.workspace.getConfiguration('robotPreviewUrdf').get('packages') || {};
    for (const [name, dir] of Object.entries(configured)) index.set(name, settingPath(dir));
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

// Gazebo looks up model://NAME as NAME/ under each of these, Harmonic first.
async function findModel(name) {
    const dirs = ['GZ_SIM_RESOURCE_PATH', 'IGN_GAZEBO_RESOURCE_PATH', 'GAZEBO_MODEL_PATH']
        .flatMap(variable => (process.env[variable] || '').split(path.delimiter).filter(Boolean));
    dirs.push(path.join(os.homedir(), '.gazebo', 'models'));
    for (const dir of dirs) {
        const candidate = path.join(dir, name);
        if ((await fs.stat(candidate).catch(() => null))?.isDirectory()) return candidate;
    }
    return null;
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

const liveEditing = () => vscode.workspace.getConfiguration('robotPreviewUrdf').get('updateOn') === 'type';

async function versionOf(fsPath, live = true) {
    const doc = live && openDocument(fsPath);
    if (doc) return `doc:${doc.version}`;
    const stat = await fs.stat(fsPath).catch(() => null);
    return stat ? `disk:${stat.mtimeMs}:${stat.size}` : null;
}

async function readData(fsPath, live = true) {
    const doc = live && openDocument(fsPath);
    return doc ? new TextEncoder().encode(doc.getText()) : new Uint8Array(await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath)));
}

const modelCache = new Map();

async function modelInfo(fsPath, version, live = true) {
    const cacheKey = `${live}:${fsPath}`;
    const cached = modelCache.get(cacheKey);
    if (cached?.version === version) return cached;
    const text = new TextDecoder().decode(await readData(fsPath, live));
    const info = {
        version,
        text,
        refs: Array.from(text.matchAll(REF_RE), m => ({ name: m[2] || m[3], isModel: m[1] === 'model' })),
        files: Array.from(text.matchAll(FILE_REF_RE), m => m[1]),
        includes: Array.from(text.matchAll(INCLUDE_RE), m => path.basename(m[1]))
    };
    modelCache.set(cacheKey, info);
    return info;
}

// Files outside every sent package are keyed by their absolute path, which is
// also what the webview's resolver gets from an absolute or file:// reference.
const absoluteKey = fsPath => '/' + fsPath.split(path.sep).join('/').replace(/^\/+/, '');

// Candidate paths for a local reference, literal first: a name may contain a
// real '%', so the URL-decoded form is only a fallback.
function localCandidates(ref, fromFiles) {
    if (/^(package|model):\/\//.test(ref)) return [];
    const expanded = ref
        .replace(/\$\(optenv\s+([\w]+)(?:\s+([^)]*))?\)/g, (match, name, fallback = '') => process.env[name] ?? fallback)
        .replace(/\$\(env\s+([\w]+)\)/g, (match, name) => process.env[name] ?? match);
    if (/\$[({]/.test(expanded)) return [];
    const forms = [];
    if (expanded.startsWith('file://')) {
        try { forms.push(url.fileURLToPath(expanded)); } catch { return []; }
    } else {
        forms.push(expanded);
        try { forms.push(decodeURIComponent(expanded)); } catch {}
    }
    return [...new Set(fromFiles.flatMap(file => forms.map(form => path.resolve(path.dirname(file), form))))];
}

async function listFiles(fileUri, live) {
    const start = await findPackageRoot(fileUri);
    const workspace = vscode.workspace.getWorkspaceFolder(fileUri);
    const rootDir = start?.dir ?? workspace?.uri.fsPath ?? path.dirname(fileUri.fsPath);
    const rootName = start?.name ?? path.basename(rootDir);
    const toKey = (name, dir, file) => `/${name}/` + path.relative(dir, file).split(path.sep).join('/');

    const entries = new Map();
    const paths = new Set();
    const packages = new Map();
    const models = new Map();
    const roots = [];
    const missing = [];
    const includes = new Set();
    const seen = new Set([rootName]);
    const queue = [[rootName, rootDir, false]];

    const followRefs = async info => {
        for (const { name, isModel } of info.refs) {
            const id = isModel ? `model://${name}` : name;
            if (seen.has(id)) continue;
            seen.add(id);
            const dir = isModel ? await findModel(name) : (await getPackageIndex()).get(name);
            if (dir) queue.push([name, dir, isModel]);
            else missing.push({ name, isModel });
        }
    };
    const add = (key, fsPath, version) => {
        entries.set(key, { fsPath, version });
        paths.add(fsPath);
    };
    // docs/vscode-extension.md: why outside files go one by one.
    const addOutside = async fsPath => {
        if (paths.has(fsPath)) return true;
        if (!ASSET_RE.test(fsPath) || !(await fs.stat(fsPath).catch(() => null))?.isFile()) return false;
        const version = await versionOf(fsPath, live);
        if (!version) return false;
        add(absoluteKey(fsPath), fsPath, version);
        const sidecar = SIDECAR_REFS[path.extname(fsPath).slice(1).toLowerCase()];
        if (sidecar) {
            const text = new TextDecoder().decode(await readData(fsPath, live));
            for (const [, ref] of text.matchAll(sidecar)) {
                for (const candidate of localCandidates(ref, [fsPath])) {
                    if (await addOutside(candidate)) break;
                }
            }
        }
        return true;
    };

    // Packages and outside files alternate until neither adds anything: an
    // included file outside every package can still name further packages.
    const scanned = new Set();
    for (let progress = true; progress;) {
        progress = false;
        while (queue.length) {
            const [name, dir, isModel] = queue.shift();
            roots.push(dir);
            (isModel ? models : packages).set(name, dir);
            for (const fsPath of await walk(dir)) {
                const version = await versionOf(fsPath, live);
                if (version) add(toKey(name, dir, fsPath), fsPath, version);
            }
        }
        for (const entry of Array.from(entries.values())) {
            if (!MODEL_RE.test(entry.fsPath) || scanned.has(entry.fsPath)) continue;
            scanned.add(entry.fsPath);
            progress = true;
            const info = await modelInfo(entry.fsPath, entry.version, live);
            info.includes.forEach(include => includes.add(include));
            await followRefs(info);
            // An include is relative to its own file (xacro); a mesh to the
            // opened file, because the webview resolves the expanded URDF there.
            for (const ref of info.files) {
                for (const fsPath of localCandidates(ref, [entry.fsPath, fileUri.fsPath])) await addOutside(fsPath);
            }
        }
    }
    return { entries, paths, packages, models, primary: toKey(rootName, rootDir, fileUri.fsPath), roots, missing, includes };
}

const fixKey = (fsPath, range) => `${fsPath}:${range.start.line}:${range.start.character}`;

// Rewrites the trailing segments of a reference that equal the resolved file's
// ignoring case, keeping the reference's own prefix (package://, ../, ...).
function withCaseOf(reference, resolved) {
    const parts = reference.split('/');
    const actual = resolved.split('/');
    for (let i = parts.length - 1, j = actual.length - 1; i >= 0 && j >= 0 && parts[i].toLowerCase() === actual[j].toLowerCase(); i--, j--) {
        parts[i] = actual[j];
    }
    return parts.join('/');
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
        this.diagnostics = vscode.languages.createDiagnosticCollection('robot-preview');
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
        this.attachPanel(vscode.window.createWebviewPanel('robotPreviewUrdf.preview', 'Robot Preview',
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
            this.pendingExport?.resolve(null);
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

    async onDiagnostics({ syntax, loadError, missingMeshes, guessedMeshes }) {
        const token = this.diagnosticsToken = (this.diagnosticsToken || 0) + 1;
        const make = (range, message, severity) => {
            const diagnostic = new vscode.Diagnostic(range, message, severity);
            diagnostic.source = 'Robot Preview';
            return diagnostic;
        };
        for (const [key, errors] of Object.entries(syntax || {})) {
            const fsPath = this.listing?.entries.get(key)?.fsPath;
            if (!fsPath) continue;
            this.syntaxDiagnostics.set(fsPath, errors.map(error => make(
                new vscode.Range(error.line, error.column, error.line, error.column + 1),
                error.message,
                vscode.DiagnosticSeverity.Error
            )));
        }

        const byFile = new Map();
        const add = (fsPath, diagnostic) => byFile.set(fsPath, [...(byFile.get(fsPath) || []), diagnostic]);
        let hasSyntaxError = false;
        for (const [fsPath, diagnostics] of this.syntaxDiagnostics) {
            diagnostics.forEach(diagnostic => add(fsPath, diagnostic));
            hasSyntaxError ||= diagnostics.length > 0;
        }
        if (loadError && !hasSyntaxError && this.primary) {
            add(this.primary.fsPath, make(new vscode.Range(0, 0, 0, 0), loadError, vscode.DiagnosticSeverity.Error));
        }
        for (const meshPath of new Set(missingMeshes || [])) {
            const references = await this.findMeshReferences(meshPath);
            for (const reference of references) {
                add(reference.fsPath, make(reference.range, `Mesh not found: ${reference.value}`, vscode.DiagnosticSeverity.Warning));
            }
            if (!references.length && this.primary) {
                add(this.primary.fsPath, make(new vscode.Range(0, 0, 0, 0), `Mesh not found: ${meshPath}`, vscode.DiagnosticSeverity.Warning));
            }
        }

        const fixes = new Map();

        // The webview still shows a guessed mesh, but ROS will not: case only
        // matters on Linux, so a model that looks fine on macOS breaks on the robot.
        // A mesh used by both visual and collision is reported once per load.
        const guesses = new Map((guessedMeshes || []).map(guess => [guess.path, guess]));
        for (const guess of guesses.values()) {
            const fsPath = this.listing?.entries.get(guess.resolved)?.fsPath;
            const shown = fsPath ? vscode.workspace.asRelativePath(fsPath) : guess.resolved;
            for (const reference of await this.findMeshReferences(guess.path)) {
                if (guess.match === 'case') {
                    add(reference.fsPath, make(reference.range, `"${reference.value}" matches ${shown} only when ignoring case; ROS on Linux will not find it.`, vscode.DiagnosticSeverity.Warning));
                    fixes.set(fixKey(reference.fsPath, reference.range), { title: `Change to the file's actual case`, text: withCaseOf(reference.value, guess.resolved) });
                } else {
                    add(reference.fsPath, make(reference.range, `"${reference.value}" was not found; the preview shows ${shown}, the only file with that name. ROS will not find it.`, vscode.DiagnosticSeverity.Warning));
                }
            }
        }

        if (token !== this.diagnosticsToken) return;
        this.fixes = fixes;
        this.diagnostics.clear();
        for (const [fsPath, diagnostics] of byFile) this.diagnostics.set(vscode.Uri.file(fsPath), diagnostics);
    }

    provideCodeActions(document, range, context) {
        return context.diagnostics.flatMap(diagnostic => {
            const fix = this.fixes?.get(fixKey(document.uri.fsPath, diagnostic.range));
            if (!fix) return [];
            const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
            action.edit = new vscode.WorkspaceEdit();
            action.edit.replace(document.uri, diagnostic.range, fix.text);
            action.diagnostics = [diagnostic];
            action.isPreferred = true;
            return [action];
        });
    }

    // Where a reference points on disk, or null when only xacro can tell
    // (an expression) or its package / model is unknown.




    async findMeshReferences(meshPath) {
        if (!this.listing) return [];
        const found = [];
        const normalize = value => value.replace(/^package:\/\//, '').replace(/^(\.\/|\/)+/, '');
        const target = normalize(meshPath);
        for (const fsPath of this.listing.paths) {
            if (!MODEL_RE.test(fsPath)) continue;
            const version = await versionOf(fsPath);
            if (!version) continue;
            const { text } = await modelInfo(fsPath, version);
            for (const match of text.matchAll(/\bfilename\s*=\s*["']([^"']+)["']/g)) {
                const value = normalize(match[1]);
                if (value !== target && !target.endsWith(`/${value}`) && !value.endsWith(`/${target}`)) continue;
                const doc = await vscode.workspace.openTextDocument(fsPath);
                const start = match.index + match[0].indexOf(match[1]);
                found.push({ fsPath, value: match[1], range: new vscode.Range(doc.positionAt(start), doc.positionAt(start + match[1].length)) });
            }
        }
        return found;
    }

    xacroArgsFor(fsPath) {
        const text = this.context.workspaceState.get('xacroArgs', {})[fsPath] || '';
        return Object.fromEntries(text.split(/\s+/).filter(Boolean).map(pair => {
            const separator = pair.indexOf(':=');
            return [pair.slice(0, separator), pair.slice(separator + 2)];
        }));
    }

    async setXacroArgs(uri) {
        const all = this.context.workspaceState.get('xacroArgs', {});
        const value = await vscode.window.showInputBox({
            title: `Xacro arguments for ${path.basename(uri.fsPath)}`,
            prompt: 'Space-separated name:=value pairs, as in a ROS launch file',
            placeHolder: 'prefix:=left_ use_gazebo:=false',
            value: all[uri.fsPath] || '',
            validateInput: text => text.split(/\s+/).filter(Boolean).every(pair => /^[^:=\s]+:=\S*$/.test(pair)) ? null : 'Use name:=value pairs separated by spaces'
        });
        if (value === undefined) return;
        await this.context.workspaceState.update('xacroArgs', { ...all, [uri.fsPath]: value.trim() });
        if (this.primary?.fsPath === uri.fsPath) await this.sync(true);
    }

    async exportUrdf() {
        if (!this.panel || !this.ready || !this.primary) {
            vscode.window.showInformationMessage('Robot Preview: open the preview of a xacro file first.');
            return;
        }
        const requestId = Date.now();
        this.pendingExport?.resolve(null);
        let text = await new Promise(resolve => {
            this.pendingExport = { requestId, resolve };
            setTimeout(() => resolve(null), 5000);
            this.panel.webview.postMessage({ type: 'exportUrdf', requestId });
        });
        this.pendingExport = null;
        if (!text) {
            vscode.window.showErrorMessage('Robot Preview: the current model has no expanded URDF (fix load errors first).');
            return;
        }
        for (const [name, dir] of this.listing.packages) {
            text = text.replace(new RegExp(`(["'\\s>])/${escapeRegex(name)}/`, 'g'), (match, before) => `${before}${dir}/`);
        }
        const defaultUri = vscode.Uri.file(this.primary.fsPath.replace(/(\.urdf)?\.xacro$/i, '') + '.urdf');
        const target = await vscode.window.showSaveDialog({ defaultUri, filters: { URDF: ['urdf'] } });
        if (!target) return;
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
        await vscode.window.showTextDocument(target);
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
            await this.onDiagnostics(msg);
        } else if (msg?.type === 'urdf') {
            if (this.pendingExport?.requestId === msg.requestId) this.pendingExport.resolve(msg.text);
        } else if (msg?.type === 'error') {
            vscode.window.showErrorMessage(`Robot Preview: ${msg.message}`);
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
            const live = liveEditing();
            const listing = await listFiles(primary, live);
            if (primary !== this.primary || !this.panel) return;
            this.listing = listing;
            this.watchRoots(listing.roots);

            const newMissing = listing.missing
                .map(({ name, isModel }) => (isModel ? `model://${name}` : name))
                .filter(name => !this.warned.has(name));
            if (newMissing.length) {
                newMissing.forEach(name => this.warned.add(name));
                vscode.window.showWarningMessage(`Robot Preview: ROS package or Gazebo model not found: ${newMissing.join(', ')}`);
            }

            const changed = Array.from(listing.entries).filter(([key, entry]) => full || this.sent.get(key) !== entry.version);
            const removed = full ? [] : Array.from(this.sent.keys()).filter(key => !listing.entries.has(key));
            if (!full && changed.length === 0 && removed.length === 0) return;

            const files = await Promise.all(changed.map(async ([key, entry]) => ({ path: key, data: await readData(entry.fsPath, live) })));
            this.sent = new Map(Array.from(listing.entries, ([key, entry]) => [key, entry.version]));
            if (full) this.syntaxDiagnostics.clear();
            for (const fsPath of this.syntaxDiagnostics.keys()) {
                if (!listing.paths.has(fsPath)) this.syntaxDiagnostics.delete(fsPath);
            }
            this.panel.webview.postMessage(full
                ? { type: 'load', files, primary: listing.primary, sourcePath: primary.fsPath, settings: this.context.globalState.get('settings'), xacroArgs: this.xacroArgsFor(primary.fsPath) }
                : { type: 'update', files, removed, primary: listing.primary });
            const editor = vscode.window.activeTextEditor;
            if (full && editor) this.onSelectionChanged({ textEditor: editor, selections: editor.selections });
        } catch (error) {
            vscode.window.showErrorMessage(`Robot Preview: ${error.message}`);
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
        if (liveEditing() && this.panel && event.contentChanges.length && this.listing?.paths.has(event.document.uri.fsPath)) {
            this.scheduleUpdate();
        }
    }

    onDocumentSaved(doc) {
        if (this.panel && this.listing?.paths.has(doc.uri.fsPath)) this.scheduleUpdate();
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
            vscode.window.setStatusBarMessage(`Robot Preview: cannot write limits of "${jointName}" (not a literal URDF joint in source)`, 5000);
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
            vscode.window.setStatusBarMessage(`Robot Preview: "${name}" not found in source`, 4000);
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
        if (this.panel || (vscode.workspace.getConfiguration('robotPreviewUrdf').get('autoOpen') && !this.dismissed.has(doc.uri.fsPath))) {
            this.show(doc.uri);
        }
    }
}

class MeshEditorProvider {
    constructor(context) {
        this.context = context;
    }

    openCustomDocument(uri) {
        return { uri, dispose() {} };
    }

    async resolveCustomEditor(document, panel) {
        const distUri = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
        const fsPath = document.uri.fsPath;
        const dir = path.dirname(fsPath);
        const name = path.basename(fsPath);
        panel.webview.options = { enableScripts: true, localResourceRoots: [distUri] };

        let loaded = false;
        let sending = Promise.resolve();
        const read = async () => {
            const names = (await listDir(dir)).filter(entry => entry === name || /\.(mtl|png|jpe?g)$/i.test(entry));
            const files = await Promise.all(names.map(async entry => ({
                path: `/mesh/${entry}`,
                data: new Uint8Array(await fs.readFile(path.join(dir, entry)))
            })));
            panel.webview.postMessage({ type: loaded ? 'update' : 'load', files, removed: [], primary: `/mesh/${name}` });
            loaded = true;
        };
        const send = () => {
            sending = sending.then(read).catch(error => vscode.window.showErrorMessage(`Robot Preview: ${error.message}`));
        };

        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dir), '*'));
        const onEvent = uri => (uri.fsPath === fsPath || /\.(mtl|png|jpe?g)$/i.test(uri.fsPath)) && send();
        watcher.onDidChange(onEvent);
        watcher.onDidCreate(onEvent);
        const subscription = panel.webview.onDidReceiveMessage(msg => {
            if (msg?.type === 'ready') send();
            if (msg?.type === 'error') vscode.window.showErrorMessage(`Robot Preview: ${msg.message}`);
        });
        panel.onDidDispose(() => {
            watcher.dispose();
            subscription.dispose();
        });

        const html = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(distUri, 'index.html')));
        panel.webview.html = renderHtml(html, panel.webview, distUri);
    }
}

exports.activate = context => {
    const preview = new Preview(context);
    context.subscriptions.push(preview.diagnostics);
    context.subscriptions.push(vscode.window.registerCustomEditorProvider('robotPreviewUrdf.mesh', new MeshEditorProvider(context), {
        webviewOptions: { retainContextWhenHidden: true }
    }));
    context.subscriptions.push(vscode.window.registerWebviewPanelSerializer('robotPreviewUrdf.preview', {
        deserializeWebviewPanel: (panel, state) => preview.restore(panel, state)
    }));
    const packageWatcher = vscode.workspace.createFileSystemWatcher('**/package.xml');
    const resetIndex = () => { packageIndex = null; };
    packageWatcher.onDidChange(resetIndex);
    packageWatcher.onDidCreate(resetIndex);
    packageWatcher.onDidDelete(resetIndex);

    context.subscriptions.push(
        packageWatcher,
        vscode.languages.registerCodeActionsProvider(
            [{ scheme: 'file', pattern: '**/*.{urdf,xacro,xml}' }],
            { provideCodeActions: (document, range, context) => preview.provideCodeActions(document, range, context) },
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        ),
        vscode.commands.registerCommand('robotPreviewUrdf.setXacroArgs', uri => {
            uri = uri || vscode.window.activeTextEditor?.document.uri;
            return uri && preview.setXacroArgs(uri);
        }),
        vscode.commands.registerCommand('robotPreviewUrdf.exportUrdf', () => preview.exportUrdf()),
        vscode.commands.registerCommand('robotPreviewUrdf.open', uri => {
            uri = uri || vscode.window.activeTextEditor?.document.uri;
            if (!uri) return;
            preview.dismissed.delete(uri.fsPath);
            preview.show(uri);
            preview.panel?.reveal(undefined, true);
        }),
        vscode.window.onDidChangeActiveTextEditor(editor => preview.onActiveEditorChanged(editor)),
        vscode.workspace.onDidChangeTextDocument(event => preview.onDocumentChanged(event)),
        vscode.workspace.onDidSaveTextDocument(doc => preview.onDocumentSaved(doc)),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('robotPreviewUrdf.packages')) packageIndex = null;
            if (event.affectsConfiguration('robotPreviewUrdf.updateOn') || event.affectsConfiguration('robotPreviewUrdf.packages')) preview.scheduleUpdate();
        }),
        vscode.window.onDidChangeTextEditorSelection(event => preview.onSelectionChanged(event))
    );
    preview.onActiveEditorChanged(vscode.window.activeTextEditor);
};
