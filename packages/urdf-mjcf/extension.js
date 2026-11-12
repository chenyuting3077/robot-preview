const vscode = require('vscode');
const path = require('path');
const url = require('url');
const os = require('os');
const fs = require('fs/promises');

// .gazebo and .trans are xacro fragments fusion2urdf writes and includes.
const ASSET_RE = /\.(urdf|xacro|xml|gazebo|trans|stl|dae|obj|mtl|gltf|glb|bin|png|jpe?g|bmp|tga|tiff?|webp|msh|ya?ml)$/i;
// Files a mesh names internally, where the URDF cannot see them.
const SIDECAR_REFS = {
    obj: /^\s*mtllib\s+(.+?)\s*$/gm,
    mtl: /^\s*(?:map_\w+|bump|disp|decal|refl)\s+(?:.*\s)?(\S+)\s*$/gm,
    dae: /<init_from>\s*([^<]+?)\s*<\/init_from>/g
};
const MODEL_RE = /\.(urdf|xacro|xml|gazebo|trans)$/i;
const REF_RE = /(package|model):\/\/([^/\s"'<>]+)|\$\(find\s+([^)\s]+)\)/g;
const ENV_REF_RE = /\$\((?:env|optenv)\s+(\w+)/g;
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
// A placeholder may expand to nothing: tf_prefix and prefix usually default to ''.
const namePattern = name => name.split(PLACEHOLDER_RE).map((part, i) => (i % 2 ? '.*?' : escapeRegex(part))).join('');
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

// Without the package, the preview gets what the web viewer got from a dragged
// folder: the nearest folder holding a referenced file at any depth, then the
// webview matches paths in it the same way. Covers folders copied without
// package.xml, renamed, or reduced to the URDF and its meshes.
// ponytail: two folders up and GUESS_SCAN_LIMIT entries, so a stray
// base_link.STL in $HOME or a full Desktop is never walked; beyond that, set
// robotPreviewUrdf.packages.
const GUESS_SCAN_LIMIT = 5000;

// How many of `names` the folder holds at any depth; 0 past GUESS_SCAN_LIMIT.
async function countHeld(root, names) {
    const found = new Set();
    const queue = [root];
    for (let seen = 0; queue.length && found.size < names.size;) {
        const dir = queue.shift();
        for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
            if (++seen > GUESS_SCAN_LIMIT) return 0;
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) queue.push(path.join(dir, entry.name));
            } else if (names.has(entry.name.toLowerCase())) {
                found.add(entry.name.toLowerCase());
            }
        }
    }
    return found.size;
}

// The nearest folder holding the most referenced files: the URDF folder can
// hold an included .trans while the meshes sit one level up.
async function guessPackageDir(name, info, fromFile) {
    const prefixes = [`package://${name}/`, `$(find ${name})/`];
    const names = new Set(info.files.flatMap(ref => prefixes.filter(prefix => ref.startsWith(prefix)).map(() => path.posix.basename(ref).toLowerCase())));
    let best = null;
    let bestCount = 0;
    let dir = path.dirname(fromFile);
    for (let up = 0; up <= 2 && bestCount < names.size; up++, dir = path.dirname(dir)) {
        const count = await countHeld(dir, names);
        if (count > bestCount) [best, bestCount] = [dir, count];
        if (path.dirname(dir) === dir) break;
    }
    return best;
}

async function listDir(dir) {
    try {
        return await fs.readdir(dir);
    } catch {
        return [];
    }
}

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

// Candidate folders in priority order (first one naming a package wins), read
// in parallel: /opt/ros/<distro> is usually also AMENT_PREFIX_PATH, and its
// ~400 package.xml files read one by one took 150-270 ms.
async function buildPackageIndex() {
    const index = new Map();
    const configured = vscode.workspace.getConfiguration('robotPreviewUrdf').get('packages') || {};
    for (const [name, dir] of Object.entries(configured)) index.set(name, settingPath(dir));
    const dirs = (await vscode.workspace.findFiles('**/package.xml', '**/{.git,node_modules,build,install,log}/**'))
        .map(uri => path.dirname(uri.fsPath));
    for (const dir of (process.env.ROS_PACKAGE_PATH || '').split(path.delimiter).filter(Boolean)) {
        dirs.push(dir, ...(await listDir(dir)).map(name => path.join(dir, name)));
    }
    const prefixes = (process.env.AMENT_PREFIX_PATH || '').split(path.delimiter).filter(Boolean);
    for (const distro of await listDir('/opt/ros')) prefixes.push(path.join('/opt/ros', distro));
    for (const prefix of new Set(prefixes.map(prefix => path.resolve(prefix)))) {
        const share = path.join(prefix, 'share');
        dirs.push(...(await listDir(share)).map(name => path.join(share, name)));
    }
    const unique = [...new Set(dirs)];
    const names = await Promise.all(unique.map(readPackageName));
    unique.forEach((dir, i) => {
        if (names[i] && !index.has(names[i])) index.set(names[i], dir);
    });
    return index;
}

// Where Gazebo looks up model://NAME as NAME/, Harmonic first.
const GAZEBO_MODEL_VARIABLES = ['GZ_SIM_RESOURCE_PATH', 'IGN_GAZEBO_RESOURCE_PATH', 'GAZEBO_MODEL_PATH'];

async function findModel(name) {
    const dirs = GAZEBO_MODEL_VARIABLES
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
        env: Array.from(text.matchAll(ENV_REF_RE), m => m[1]),
        includes: Array.from(text.matchAll(INCLUDE_RE), m => path.basename(m[1]))
    };
    modelCache.set(cacheKey, info);
    return info;
}

// Files outside every sent package are keyed by their absolute path, which is
// also what the webview's resolver gets from an absolute or file:// reference.
const absoluteKey = fsPath => '/' + fsPath.split(path.sep).join('/').replace(/^\/+/, '');

const hasExpression = text => /\$[({]/.test(text);

function fromFileUrl(value) {
    try { return url.fileURLToPath(value); } catch { return null; }
}

// A literal '%' is legal in a file name, so the URL-decoded form comes second.
function localCandidates(ref, fromFiles) {
    if (/^(package|model):\/\//.test(ref)) return [];
    const expanded = ref
        .replace(/\$\(optenv\s+([\w]+)(?:\s+([^)]*))?\)/g, (match, name, fallback = '') => process.env[name] ?? fallback)
        .replace(/\$\(env\s+([\w]+)\)/g, (match, name) => process.env[name] ?? match);
    if (hasExpression(expanded)) return [];
    const forms = [];
    if (expanded.startsWith('file://')) {
        const file = fromFileUrl(expanded);
        if (!file) return [];
        forms.push(file);
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

    const followRefs = async (info, fromFile) => {
        for (const { name, isModel } of info.refs) {
            const id = isModel ? `model://${name}` : name;
            if (seen.has(id)) continue;
            seen.add(id);
            const dir = isModel ? await findModel(name) : (await getPackageIndex()).get(name);
            const guessedDir = dir ? null : !isModel && await guessPackageDir(name, info, fromFile);
            // A guessed folder already sent is not sent again: two copies of a
            // mesh would make its file-name match ambiguous in the webview.
            const sent = guessedDir && roots.some(root => guessedDir === root || guessedDir.startsWith(root + path.sep));
            if (dir || (guessedDir && !sent)) queue.push([name, dir || guessedDir, isModel]);
            if (!dir) missing.push({ name, isModel, guessedDir });
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
            await followRefs(info, entry.fsPath);
            // An include is relative to its own file (xacro); a mesh to the
            // opened file, because the webview resolves the expanded URDF there.
            for (const ref of info.files) {
                for (const fsPath of localCandidates(ref, [entry.fsPath, fileUri.fsPath])) await addOutside(fsPath);
            }
        }
    }
    // Only referenced variables reach the webview: the full environment can
    // hold tokens the preview has no use for.
    const env = {};
    for (const entry of entries.values()) {
        if (!MODEL_RE.test(entry.fsPath)) continue;
        for (const name of (await modelInfo(entry.fsPath, entry.version, live)).env) {
            if (process.env[name] != null) env[name] = process.env[name];
        }
    }
    return { entries, paths, packages, models, primary: toKey(rootName, rootDir, fileUri.fsPath), roots, missing, includes, env };
}

// VS Code started from the dock rather than a sourced shell sees no ROS
// environment, so unset variables are named.
function missingPackageMessage(name, isModel) {
    const variable = name => (process.env[name] ? name : `${name} (not set)`);
    if (isModel) {
        return `Gazebo model "${name}" not found. Searched: ${GAZEBO_MODEL_VARIABLES.map(variable).join(', ')}, ~/.gazebo/models.`;
    }
    const sourced = process.env.ROS_PACKAGE_PATH || process.env.AMENT_PREFIX_PATH;
    return `ROS package "${name}" not found. Searched: robotPreviewUrdf.packages, package.xml in the workspace, ${variable('ROS_PACKAGE_PATH')}, ${variable('AMENT_PREFIX_PATH')}, /opt/ros/*/share.`
        + (sourced ? '' : ' VS Code sees ROS variables only when started from a sourced shell.');
}

const modelStem = fsPath => fsPath.replace(/(\.urdf)?\.(xacro|urdf|xml)$/i, '');

const attributeOf = (tag, name) => attributeRange(tag, name)?.value;

function attributeRange(tag, name) {
    const match = new RegExp(`\\b${name}(\\s*=\\s*["'])([^"']*)["']`).exec(tag);
    return match ? { start: match.index + name.length + match[1].length, value: match[2] } : null;
}

function splitScheme(value) {
    const match = value.match(/^(package|model):\/\/([^/]+)\/(.*)$/);
    return match ? { isModel: match[1] === 'model', name: match[2], rest: match[3] } : null;
}

async function currentText(fsPath) {
    const version = await versionOf(fsPath);
    return version ? (await modelInfo(fsPath, version)).text : null;
}

const fixKey = (fsPath, range) => `${fsPath}:${range.start.line}:${range.start.character}`;

function insideMacro(text, index) {
    const before = text.slice(0, index);
    return (before.match(/<xacro:macro\b/g) || []).length > (before.match(/<\/xacro:macro\s*>/g) || []).length;
}

function jointParts(doc, target) {
    if (target.tag.endsWith('/>')) return null;
    const text = doc.getText();
    const bodyStart = target.index + target.tag.length;
    const close = text.indexOf('</joint>', bodyStart);
    if (close === -1) return null;
    const limit = /<limit\b[^>]*>/.exec(text.slice(bodyStart, close));
    const textEdit = (start, end, replacement) => ({ range: new vscode.Range(doc.positionAt(start), doc.positionAt(end)), text: replacement });
    const limitStart = limit && bodyStart + limit.index;
    return {
        text, bodyStart, close, limit: limit?.[0],
        limitAttribute: name => limit?.[0].match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`))?.[1],
        replaceLimit: replacement => textEdit(limitStart, limitStart + limit[0].length, replacement),
        textEdit
    };
}

const JOINT_FIXES = {
    'inverted-limit': (doc, target) => {
        const joint = jointParts(doc, target);
        if (!joint?.limit || joint.limitAttribute('lower') === undefined || joint.limitAttribute('upper') === undefined) return [];
        const swapped = joint.limit.replace(/\b(lower|upper)(\s*=\s*["'])([^"']*)(["'])/g,
            (whole, name, open, current, end) => `${name}${open}${joint.limitAttribute(name === 'lower' ? 'upper' : 'lower')}${end}`);
        return [{ title: 'Swap lower and upper', edits: [joint.replaceLimit(swapped)] }];
    },
    'continuous-with-limits': (doc, target) => {
        const joint = jointParts(doc, target);
        if (!joint?.limit) return [];
        const actions = [{ title: 'Drop lower and upper', edits: [joint.replaceLimit(joint.limit.replace(/\s+(lower|upper)\s*=\s*["'][^"']*["']/g, ''))] }];
        const type = /\btype\s*=\s*["']continuous["']/.exec(target.tag);
        if (type) actions.unshift({ title: 'Make it a revolute joint', edits: [joint.textEdit(target.index + type.index, target.index + type.index + type[0].length, 'type="revolute"')] });
        return actions;
    },
    // docs/vscode-extension.md, "Model checks": why placeholder values and the TODO.
    'missing-limit': (doc, target) => {
        const joint = jointParts(doc, target);
        if (!joint || joint.limit) return [];
        const placeholder = '<!-- TODO: set real limits --><limit lower="-3.14" upper="3.14" effort="1" velocity="1"/>';
        const lineStart = joint.text.lastIndexOf('\n', joint.close) + 1;
        if (lineStart <= joint.bodyStart) {
            return [{ title: 'Insert a placeholder <limit>', edits: [joint.textEdit(joint.close, joint.close, placeholder)] }];
        }
        const indent = /^\s*/.exec(joint.text.slice(joint.bodyStart, lineStart).trimEnd().split('\n').pop())[0];
        const lines = placeholder.replace('--><', `-->\n${indent}<`);
        return [{ title: 'Insert a placeholder <limit>', edits: [joint.textEdit(lineStart, lineStart, `${indent}${lines}\n`)] }];
    }
};

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

// docs/vscode-extension.md, "Text editor navigation": why the scope is the include
// chain, xacro scoping is not modelled and hover is not evaluated.

const NAVIGATION_KINDS = {
    property: { tag: /<xacro:property\b[^>]*>/g, completion: vscode.CompletionItemKind.Variable },
    macro: { tag: /<xacro:macro\b[^>]*>/g, completion: vscode.CompletionItemKind.Function },
    arg: { tag: /<xacro:arg\b[^>]*>/g, completion: vscode.CompletionItemKind.Constant },
    link: { tag: /<link\b[^>]*>/g }
};
const XACRO_DIRECTIVES = new Set(['property', 'macro', 'arg', 'include', 'if', 'unless', 'insert_block', 'element', 'attribute', 'call']);
const INCLUDE_FILE_RE = /<xacro:include\b[^>]*?\bfilename\s*=\s*["']([^"']+)["']/g;
const PATH_ATTRIBUTE_RE = /\bfilename\s*=\s*["']([^"']+)["']/g;
const groupStart = match => match.index + match[0].lastIndexOf(match[1]);
const isXacroModel = fsPath => /\.(urdf|xacro)$/i.test(fsPath);

const SYMBOL_PATTERNS = [
    { kind: 'macro', re: /<xacro:([\w.-]+)/g, skip: name => XACRO_DIRECTIVES.has(name) },
    { kind: 'link', re: /<(?:parent|child)\b[^>]*?\blink\s*=\s*["']([^"']+)["']/g },
    { kind: 'path', re: PATH_ATTRIBUTE_RE }
];

function propertyAt(text, offset) {
    const open = text.lastIndexOf('${', offset);
    const close = open === -1 ? -1 : text.indexOf('}', open);
    if (open === -1 || close < offset) return null;
    for (const match of text.slice(open + 2, close).matchAll(/[A-Za-z_]\w*/g)) {
        const start = open + 2 + match.index;
        if (offset >= start && offset <= start + match[0].length) return { kind: 'property', text: match[0], start };
    }
    return null;
}

function symbolAt(text, offset) {
    for (const match of text.matchAll(/\$\(arg\s+([\w-]+)\)/g)) {
        const start = groupStart(match);
        if (offset >= start && offset <= start + match[1].length) return { kind: 'arg', text: match[1], start };
    }
    const property = propertyAt(text, offset);
    if (property) return property;
    for (const { kind, re, skip } of SYMBOL_PATTERNS) {
        for (const match of text.matchAll(re)) {
            const start = groupStart(match);
            if (offset >= start && offset <= start + match[1].length && !skip?.(match[1])) return { kind, text: match[1], start };
        }
    }
    return null;
}

async function resolvePathReference(value, fromFile, args = {}) {
    const index = await getPackageIndex();
    let ref = value
        .replace(/\$\(arg\s+([\w-]+)\)/g, (match, name) => args[name] ?? match)
        .replace(/\$\(find\s+([^)\s]+)\)/g, (match, name) => index.get(name) ?? match);
    const scheme = splitScheme(ref);
    if (scheme) {
        const dir = scheme.isModel ? await findModel(scheme.name) : index.get(scheme.name);
        if (!dir) return null;
        ref = path.join(dir, scheme.rest);
    }
    for (const candidate of localCandidates(ref, [fromFile])) {
        if ((await fs.stat(candidate).catch(() => null))?.isFile()) return candidate;
    }
    return null;
}

class Navigator {
    constructor(preview) {
        this.preview = preview;
        this.listings = new Map();
    }

    invalidate() {
        this.listings.clear();
    }

    async packageFiles(doc) {
        const fsPath = doc.uri.fsPath;
        if (this.preview.listing?.paths.has(fsPath)) return this.preview.listing.paths;
        if (!this.listings.has(fsPath)) this.listings.set(fsPath, listFiles(doc.uri, true));
        return (await this.listings.get(fsPath)).paths;
    }

    textOf(fsPath, doc) {
        return fsPath === doc.uri.fsPath ? doc.getText() : currentText(fsPath);
    }

    // Files reachable through <xacro:include> from `start`, in breadth-first order.
    async includeClosure(start, doc, args) {
        const order = [start];
        for (let i = 0; i < order.length; i++) {
            const text = (await this.textOf(order[i], doc)) || '';
            for (const match of text.matchAll(INCLUDE_FILE_RE)) {
                const target = await resolvePathReference(match[1], order[i], args);
                if (target && !order.includes(target)) order.push(target);
            }
        }
        return order;
    }

    async scope(doc) {
        const fsPath = doc.uri.fsPath;
        const args = this.preview.xacroArgsFor(fsPath);
        const files = await this.includeClosure(fsPath, doc, args);
        const roots = [];
        for (const candidate of await this.packageFiles(doc)) {
            if (files.includes(candidate) || !isXacroModel(candidate)) continue;
            const closure = await this.includeClosure(candidate, doc, args);
            if (!closure.includes(fsPath)) continue;
            roots.push(candidate);
            for (const file of closure) if (!files.includes(file)) files.push(file);
        }
        return { files, roots };
    }

    async definitions(doc, kind, name, scope) {
        const found = [];
        for (const fsPath of scope.files) {
            const text = (await this.textOf(fsPath, doc)) || '';
            for (const match of text.matchAll(NAVIGATION_KINDS[kind].tag)) {
                if (name === undefined || attributeOf(match[0], 'name') === name) found.push({ fsPath, text, index: match.index, tag: match[0] });
            }
        }
        // A macro included with ns="x" is called as x.name but defined as name.
        if (!found.length && kind === 'macro' && name?.includes('.')) return this.definitions(doc, kind, name.split('.').pop(), scope);
        return found;
    }

    // Argument values for paths: declared defaults, then those set on the edited or including files.
    async argumentValues(doc, scope) {
        const values = {};
        for (const { tag } of await this.definitions(doc, 'arg', undefined, scope)) {
            const name = attributeOf(tag, 'name');
            if (name && values[name] === undefined && attributeOf(tag, 'default') !== undefined) values[name] = attributeOf(tag, 'default');
        }
        for (const file of [...scope.roots].reverse().concat(doc.uri.fsPath)) Object.assign(values, this.preview.xacroArgsFor(file));
        return values;
    }

    async location({ fsPath, index, tag }) {
        const doc = await vscode.workspace.openTextDocument(fsPath);
        const name = attributeRange(tag, 'name');
        const start = index + (name?.start ?? 0);
        return new vscode.Location(vscode.Uri.file(fsPath), new vscode.Range(doc.positionAt(start), doc.positionAt(start + (name?.value.length ?? 0))));
    }

    async resolvePath(doc, symbol, scope) {
        return resolvePathReference(symbol.text, doc.uri.fsPath, await this.argumentValues(doc, scope));
    }

    async provideDefinition(doc, position) {
        const symbol = symbolAt(doc.getText(), doc.offsetAt(position));
        if (!symbol) return undefined;
        const scope = await this.scope(doc);
        if (symbol.kind === 'path') {
            const target = await this.resolvePath(doc, symbol, scope);
            return target ? [new vscode.Location(vscode.Uri.file(target), new vscode.Position(0, 0))] : undefined;
        }
        return Promise.all((await this.definitions(doc, symbol.kind, symbol.text, scope)).map(definition => this.location(definition)));
    }

    async provideHover(doc, position) {
        const symbol = symbolAt(doc.getText(), doc.offsetAt(position));
        if (!symbol) return undefined;
        const scope = await this.scope(doc);
        const range = new vscode.Range(doc.positionAt(symbol.start), doc.positionAt(symbol.start + symbol.text.length));
        const markdown = new vscode.MarkdownString();
        if (symbol.kind === 'path') {
            const target = await this.resolvePath(doc, symbol, scope);
            markdown.appendMarkdown(target ? await fs.realpath(target) : 'Not found');
            return new vscode.Hover(markdown, range);
        }
        const definitions = await this.definitions(doc, symbol.kind, symbol.text, scope);
        if (!definitions.length) return undefined;
        for (const { fsPath, text, index, tag } of definitions.slice(0, 3)) {
            markdown.appendCodeblock(tag, 'xml');
            markdown.appendMarkdown(`${vscode.workspace.asRelativePath(fsPath)}:${text.slice(0, index).split('\n').length}\n\n`);
        }
        if (symbol.kind === 'arg') {
            const owner = [doc.uri.fsPath, ...scope.roots].find(file => this.preview.xacroArgsFor(file)[symbol.text] !== undefined);
            if (owner) markdown.appendMarkdown(`Current value: \`${this.preview.xacroArgsFor(owner)[symbol.text]}\` (Robot Preview: Set Xacro Arguments)`);
        }
        return new vscode.Hover(markdown, range);
    }

    async provideCompletionItems(doc, position) {
        const text = doc.getText();
        const offset = doc.offsetAt(position);
        const before = text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset);
        const open = before.lastIndexOf('${');
        const kind = /\$\(arg\s+[\w-]*$/.test(before) ? 'arg'
            : /<xacro:[\w.-]*$/.test(before) ? 'macro'
            : open !== -1 && !before.includes('}', open) && /(^|[^\w.'"])\w*$/.test(before.slice(open + 2)) ? 'property'
            : null;
        if (!kind) return undefined;
        const definitions = await this.definitions(doc, kind, undefined, await this.scope(doc));
        const names = new Set(definitions.map(definition => attributeOf(definition.tag, 'name')).filter(Boolean));
        return Array.from(names, name => new vscode.CompletionItem(name, NAVIGATION_KINDS[kind].completion));
    }

    async provideDocumentLinks(doc) {
        const scope = await this.scope(doc);
        const links = [];
        for (const match of doc.getText().matchAll(PATH_ATTRIBUTE_RE)) {
            const start = groupStart(match);
            const target = await this.resolvePath(doc, { text: match[1] }, scope);
            if (target) links.push(new vscode.DocumentLink(new vscode.Range(doc.positionAt(start), doc.positionAt(start + match[1].length)), vscode.Uri.file(target)));
        }
        return links;
    }
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

    async onDiagnostics({ syntax, loadError, loadErrorLocation, missingMeshes, guessedMeshes, checks }) {
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
            const located = loadErrorLocation?.key && this.listing?.entries.get(loadErrorLocation.key)?.fsPath;
            const { line = 0, column = 0 } = located ? loadErrorLocation : {};
            // The webview only knows its own keys; show a missing file where it would be on disk.
            const missingOnDisk = loadErrorLocation?.missing && this.diskPathOfKey(loadErrorLocation.missing);
            const message = missingOnDisk ? loadError.replace(loadErrorLocation.missing, vscode.workspace.asRelativePath(missingOnDisk)) : loadError;
            add(located || this.primary.fsPath, make(new vscode.Range(line, column, line, column + 1), message, vscode.DiagnosticSeverity.Error));
        }
        for (const meshPath of new Set(missingMeshes || [])) {
            const references = await this.findMeshReferences(meshPath);
            for (const reference of references) {
                const expected = this.expectedPath(reference);
                const where = expected ? ` (looked for ${vscode.workspace.asRelativePath(expected)})` : '';
                add(reference.fsPath, make(reference.range, `Mesh not found: ${reference.value}${where}`, vscode.DiagnosticSeverity.Warning));
            }
            if (!references.length && this.primary) {
                add(this.primary.fsPath, make(new vscode.Range(0, 0, 0, 0), `Mesh not found: ${meshPath}`, vscode.DiagnosticSeverity.Warning));
            }
        }

        const fixes = new Map();
        for (const { name: bare, isModel, guessedDir } of this.listing?.missing || []) {
            const message = missingPackageMessage(bare, isModel)
                + (guessedDir ? ` The preview uses ${vscode.workspace.asRelativePath(guessedDir)}, which holds the referenced files; ROS will not.` : '');
            for (const reference of await this.findPackageReferences(bare, isModel)) {
                add(reference.fsPath, make(reference.range, message, vscode.DiagnosticSeverity.Warning));
                if (!isModel) {
                    fixes.set(fixKey(reference.fsPath, reference.range), [{
                        title: `Choose the folder of package "${bare}"…`,
                        command: { title: 'Choose folder', command: 'robotPreviewUrdf.locatePackage', arguments: [bare] }
                    }]);
                }
            }
        }

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
                    fixes.set(fixKey(reference.fsPath, reference.range), [{ title: `Change to the file's actual case`, edits: [{ range: reference.range, text: withCaseOf(reference.value, guess.resolved) }] }]);
                } else {
                    add(reference.fsPath, make(reference.range, `"${reference.value}" was not found; the preview shows ${shown}, the only file with that name. ROS will not find it.`, vscode.DiagnosticSeverity.Warning));
                }
            }
        }

        await this.addCheckDiagnostics(checks || [], { make, add, fixes });

        if (token !== this.diagnosticsToken) return;
        this.fixes = fixes;
        this.diagnostics.clear();
        for (const [fsPath, diagnostics] of byFile) this.diagnostics.set(vscode.Uri.file(fsPath), diagnostics);
    }

    // docs/vscode-extension.md, "Model checks": why macro elements are reported once and get no fix.
    async addCheckDiagnostics(checks, report) {
        const disabled = new Set(vscode.workspace.getConfiguration('robotPreviewUrdf').get('checks.disabled') || []);
        const groups = new Map();
        for (const check of checks) {
            if (disabled.has(check.rule)) continue;
            const { exact, fuzzy } = await this.findDefinitions(check.kind, check.name);
            const inModel = candidates => candidates.filter(candidate => this.contains(candidate.fsPath));
            const exactInModel = inModel(exact);
            const targets = exactInModel.length
                ? (check.rule === 'duplicate-name' ? exactInModel : exactInModel.slice(0, 1))
                : inModel(fuzzy).slice(0, 1);
            for (const target of targets.length ? targets : [null]) {
                const key = target ? `${check.rule}:${target.fsPath}:${target.index}` : `${check.rule}:${check.name}`;
                const group = groups.get(key) || { check, target, names: [] };
                if (!group.names.includes(check.name)) group.names.push(check.name);
                groups.set(key, group);
            }
        }
        for (const { check, target, names } of groups.values()) {
            const severity = check.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
            const others = names.slice(1);
            const message = others.length ? `${check.message} (also ${others.join(', ')})` : check.message;
            let fsPath = this.primary?.fsPath;
            let range = new vscode.Range(0, 0, 0, 0);
            let doc = null;
            if (target) {
                doc = await vscode.workspace.openTextDocument(target.fsPath);
                const nameAt = target.index + attributeRange(target.tag, 'name').start;
                fsPath = target.fsPath;
                range = new vscode.Range(doc.positionAt(nameAt), doc.positionAt(nameAt + target.name.length));
            }
            if (!fsPath) continue;
            const diagnostic = report.make(range, message, severity);
            diagnostic.code = check.rule;
            report.add(fsPath, diagnostic);
            const editable = target && target.name === check.name && !insideMacro(doc.getText(), target.index);
            const actions = editable ? (JOINT_FIXES[check.rule]?.(doc, target) || []) : [];
            if (actions.length) report.fixes.set(fixKey(fsPath, range), actions);
        }
    }

    provideCodeActions(document, range, context) {
        return context.diagnostics.flatMap(diagnostic => {
            const actions = this.fixes?.get(fixKey(document.uri.fsPath, diagnostic.range)) || [];
            return actions.map(fix => {
                const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
                if (fix.command) {
                    action.command = fix.command;
                } else {
                    action.edit = new vscode.WorkspaceEdit();
                    for (const edit of fix.edits) action.edit.replace(document.uri, edit.range, edit.text);
                }
                action.diagnostics = [diagnostic];
                action.isPreferred = actions.length === 1;
                return action;
            });
        });
    }

    expectedPath({ value }) {
        if (hasExpression(value)) return null;
        const scheme = splitScheme(value);
        if (scheme) {
            const dir = (scheme.isModel ? this.listing.models : this.listing.packages).get(scheme.name);
            return dir ? path.join(dir, scheme.rest) : null;
        }
        if (value.startsWith('file://')) return fromFileUrl(value);
        // The webview resolves a relative mesh from the opened file, wherever it is written.
        return path.resolve(path.dirname(this.primary.fsPath), value);
    }

    diskPathOfKey(key) {
        const [, name, rest] = key.match(/^\/([^/]+)\/(.*)$/) || [];
        const dir = this.listing?.packages.get(name) ?? this.listing?.models.get(name);
        return dir ? path.join(dir, rest) : null;
    }

    async findPackageReferences(name, isModel) {
        const escaped = escapeRegex(name);
        const re = isModel ? new RegExp(`model://(${escaped})(?=/)`, 'g') : new RegExp(`package://(${escaped})(?=/)|\\$\\(find\\s+(${escaped})\\)`, 'g');
        const found = [];
        for (const fsPath of this.listing.paths) {
            if (!MODEL_RE.test(fsPath)) continue;
            const text = await currentText(fsPath);
            if (text === null) continue;
            const matches = Array.from(text.matchAll(re));
            if (!matches.length) continue;
            // Opening every file would turn its version from disk:* into doc:* and resend it.
            const doc = await vscode.workspace.openTextDocument(fsPath);
            for (const match of matches) {
                const start = match.index + match[0].lastIndexOf(name);
                found.push({ fsPath, range: new vscode.Range(doc.positionAt(start), doc.positionAt(start + name.length)) });
            }
        }
        return found;
    }

    async locatePackage(name) {
        const [folder] = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: `Use for ${name}` }) || [];
        if (!folder) return;
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const relative = root && path.relative(root, folder.fsPath);
        const value = relative && !relative.startsWith('..') && !path.isAbsolute(relative)
            ? `\${workspaceFolder}/${relative.split(path.sep).join('/')}`
            : folder.fsPath;
        // Merge into the one layer written; get() would copy user entries into the workspace.
        // Without a folder there are no workspace settings to write.
        const config = vscode.workspace.getConfiguration('robotPreviewUrdf');
        const layers = config.inspect('packages') || {};
        const [target, current] = root
            ? [vscode.ConfigurationTarget.Workspace, layers.workspaceValue]
            : [vscode.ConfigurationTarget.Global, layers.globalValue];
        await config.update('packages', { ...(current || {}), [name]: value }, target);
    }

    async findMeshReferences(meshPath) {
        if (!this.listing) return [];
        const found = [];
        const keyOf = new Map(Array.from(this.listing.entries, ([key, entry]) => [entry.fsPath, key]));
        const normalize = value => value.replace(/^package:\/\//, '').replace(/^(\.\/|\/)+/, '');
        const target = normalize(meshPath);
        for (const fsPath of this.listing.paths) {
            if (!MODEL_RE.test(fsPath)) continue;
            const text = await currentText(fsPath);
            if (text === null) continue;
            // A relative reference is compared as resolved from its file's key,
            // since the webview reports '../parts/a.stl' as 'pkg/parts/a.stl'.
            const key = keyOf.get(fsPath) ?? '';
            for (const match of text.matchAll(/\bfilename\s*=\s*["']([^"']+)["']/g)) {
                const forms = [normalize(match[1])];
                if (!/^[a-z]+:\/\/|^[/\\$]/i.test(match[1])) forms.push(normalize(path.posix.join(path.posix.dirname(key), match[1])));
                if (!forms.some(value => value === target || target.endsWith(`/${value}`) || value.endsWith(`/${target}`))) continue;
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

    // Unlike exportUrdf this is not a request/reply: the toolbar button starts a
    // screenshot in the webview on its own, so the host just saves what arrives.
    requestScreenshot() {
        if (!this.panel || !this.ready) {
            vscode.window.showInformationMessage('Robot Preview: open the preview first.');
            return;
        }
        this.panel.webview.postMessage({ type: 'captureScreenshot' });
    }

    async saveScreenshot({ name, data }) {
        if (!this.primary || !data) return;
        const fileName = `${(name || path.basename(modelStem(this.primary.fsPath))).replace(/[\\/:*?"<>|]/g, '_')}.png`;
        const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(path.dirname(this.primary.fsPath), fileName)),
            filters: { 'PNG image': ['png'] }
        });
        if (!target) return;
        await vscode.workspace.fs.writeFile(target, Buffer.from(data, 'base64'));
        vscode.window.setStatusBarMessage(`Robot Preview: saved ${vscode.workspace.asRelativePath(target.fsPath)}`, 4000);
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
        // Only .xacro is stripped: for a plain .urdf the default must not be the source itself.
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
        } else if (msg?.type === 'screenshot') {
            await this.saveScreenshot(msg);
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
                ? { type: 'load', files, primary: listing.primary, sourcePath: primary.fsPath, settings: this.context.globalState.get('settings'), xacroArgs: this.xacroArgsFor(primary.fsPath), env: listing.env }
                : { type: 'update', files, removed, primary: listing.primary, env: listing.env });
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
            const text = await currentText(fsPath);
            if (text === null) continue;
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
    const navigator = new Navigator(preview);
    const packageWatcher = vscode.workspace.createFileSystemWatcher('**/package.xml');
    const resetIndex = () => {
        packageIndex = null;
        navigator.invalidate();
    };
    packageWatcher.onDidChange(resetIndex);
    packageWatcher.onDidCreate(resetIndex);
    packageWatcher.onDidDelete(resetIndex);

    const xacroFiles = [{ scheme: 'file', pattern: '**/*.{urdf,xacro}' }];
    const modelWatcher = vscode.workspace.createFileSystemWatcher('**/*.{urdf,xacro,xml,gazebo,trans}');
    for (const event of ['onDidChange', 'onDidCreate', 'onDidDelete']) modelWatcher[event](() => navigator.invalidate());
    context.subscriptions.push(
        packageWatcher,
        modelWatcher,
        vscode.languages.registerDefinitionProvider(xacroFiles, { provideDefinition: (doc, position) => navigator.provideDefinition(doc, position) }),
        vscode.languages.registerHoverProvider(xacroFiles, { provideHover: (doc, position) => navigator.provideHover(doc, position) }),
        vscode.languages.registerCompletionItemProvider(xacroFiles, { provideCompletionItems: (doc, position) => navigator.provideCompletionItems(doc, position) }, '{', ':', ' '),
        vscode.languages.registerDocumentLinkProvider(xacroFiles, { provideDocumentLinks: doc => navigator.provideDocumentLinks(doc) }),
        vscode.languages.registerCodeActionsProvider(
            [{ scheme: 'file', pattern: '**/*.{urdf,xacro,xml}' }],
            { provideCodeActions: (document, range, context) => preview.provideCodeActions(document, range, context) },
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        ),
        vscode.commands.registerCommand('robotPreviewUrdf.locatePackage', name => preview.locatePackage(name)),
        vscode.commands.registerCommand('robotPreviewUrdf.setXacroArgs', uri => {
            uri = uri || vscode.window.activeTextEditor?.document.uri;
            return uri && preview.setXacroArgs(uri);
        }),
        vscode.commands.registerCommand('robotPreviewUrdf.exportUrdf', () => preview.exportUrdf()),
        vscode.commands.registerCommand('robotPreviewUrdf.saveScreenshot', () => preview.requestScreenshot()),
        vscode.commands.registerCommand('robotPreviewUrdf.open', uri => {
            uri = uri || vscode.window.activeTextEditor?.document.uri;
            if (!uri) return;
            preview.dismissed.delete(uri.fsPath);
            preview.show(uri);
            preview.panel?.reveal(undefined, true);
        }),
        vscode.window.onDidChangeActiveTextEditor(editor => preview.onActiveEditorChanged(editor)),
        vscode.workspace.onDidChangeTextDocument(event => preview.onDocumentChanged(event)),
        vscode.workspace.onDidSaveTextDocument(doc => {
            navigator.invalidate();
            preview.onDocumentSaved(doc);
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('robotPreviewUrdf.packages')) resetIndex();
            if (event.affectsConfiguration('robotPreviewUrdf.updateOn') || event.affectsConfiguration('robotPreviewUrdf.packages')) preview.scheduleUpdate();
        }),
        vscode.window.onDidChangeTextEditorSelection(event => preview.onSelectionChanged(event))
    );
    preview.onActiveEditorChanged(vscode.window.activeTextEditor);
};
