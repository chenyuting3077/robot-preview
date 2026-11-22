import Module, { createRequire } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const extensionPath = fileURLToPath(new URL('../../packages/urdf-mjcf/extension.js', import.meta.url));
export const fixtureWorkspace = fileURLToPath(new URL('../fixtures/ros_ws', import.meta.url));
// The e2e servers serve a file at its URL path, which on Windows is /C:/...; webviewFile reads one back.
const webviewPath = uri => pathToFileURL(uri.fsPath).pathname;
export const webviewFile = urlPath => fileURLToPath(new URL(urlPath, 'file:'));

export function chromePath() {
    if (process.env.CHROME) return process.env.CHROME;
    if (process.platform !== 'win32') return 'google-chrome';
    const installs = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
        .map(dir => path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    return installs.find(file => fs.existsSync(file)) ?? 'chrome.exe';
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A custom editor's panel; it keeps the message listener and dispose callback the extension registers.
export function fakePanel(postMessage = () => {}) {
    const panel = {
        webview: { options: {}, cspSource: 'vscode-webview:', asWebviewUri: webviewPath, html: '', postMessage, onDidReceiveMessage: listener => { panel.listener = listener; } },
        onDidDispose: callback => { panel.dispose = callback; },
        onDidChangeViewState: callback => { panel.viewState = callback; },
        reveal() { panel.revealed = (panel.revealed ?? 0) + 1; }
    };
    return panel;
}

const meshSplatPath = fileURLToPath(new URL('../../packages/mesh-splat/extension.js', import.meta.url));

// Activates the mesh-splat extension (or a copy of it at `extension`) and opens `file` in its viewer.
export async function openMeshSplat(root, file, { postMessage, storage = path.join(root, 'storage'), extension = meshSplatPath } = {}) {
    const env = loadExtension({ workspace: root, extension, globalStorage: storage });
    env.activate();
    const panel = fakePanel(postMessage);
    await env.state.customEditors['robotPreviewMeshSplat.viewer'].resolveCustomEditor({ uri: env.vscode.Uri.file(file) }, panel);
    return { env, panel };
}

class Range {
    constructor(a, b, c, d) {
        Object.assign(this, typeof a === 'number'
            ? { start: { line: a, character: b }, end: { line: c, character: d } }
            : { start: a, end: b });
    }
}

function makeDocument(fsPath) {
    let text = fs.readFileSync(fsPath, 'utf8');
    const lines = () => text.split('\n');
    const doc = {
        uri: { fsPath, scheme: 'file' },
        fileName: fsPath,
        version: 1,
        isDirty: false,
        getText: range => (range ? lines().slice(range.start.line, range.end.line).join('\n') : text),
        offsetAt: pos => lines().slice(0, pos.line).join('\n').length + (pos.line ? 1 : 0) + pos.character,
        positionAt: offset => {
            const before = text.slice(0, offset).split('\n');
            return { line: before.length - 1, character: before.at(-1).length };
        },
        edit(next) {
            text = next;
            doc.version++;
            doc.isDirty = true;
        },
        save() {
            fs.writeFileSync(fsPath, text);
            doc.isDirty = false;
        }
    };
    return doc;
}

export async function copyFixture() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'robot-preview-'));
    await fsp.cp(fixtureWorkspace, dir, { recursive: true });
    return dir;
}

// `root` is the extension's folder when its main file is not at the top (the USD package's dist/extension.js).
export function loadExtension({ workspace, config = {}, extension: extensionFile = extensionPath, globalStorage, root = path.dirname(extensionFile) }) {
    const listeners = {};
    const on = name => callback => {
        (listeners[name] ||= []).push(callback);
        return { dispose() {} };
    };
    const fire = (name, event) => (listeners[name] || []).forEach(callback => callback(event));

    const state = {
        watched: {},
        docs: [],
        posted: [],
        panels: [],
        revealed: null,
        applied: [],
        status: [],
        diagnostics: new Map(),
        collections: {},
        globalState: new Map(),
        workspaceState: new Map(),
        serializer: null,
        customEditors: {},
        config: { autoOpen: true, updateOn: 'type', ...config }
    };

    const openDocument = fsPath => state.docs.find(doc => doc.uri.fsPath === fsPath)
        || (state.docs.push(makeDocument(fsPath)), state.docs.at(-1));

    const makePanel = () => {
        const panel = {
            title: '',
            viewColumn: 2,
            webview: {
                html: '',
                options: {},
                cspSource: 'vscode-webview:',
                asWebviewUri: webviewPath,
                onDidReceiveMessage: callback => {
                    panel.receive = callback;
                    return { dispose() {} };
                },
                postMessage: message => {
                    state.posted.push(message);
                    return Promise.resolve(true);
                }
            },
            onDidDispose: callback => {
                panel.disposeCallback = callback;
                return { dispose() {} };
            },
            dispose: () => panel.disposeCallback?.(),
            reveal() {}
        };
        state.panels.push(panel);
        return panel;
    };

    const vscode = {
        Uri: {
            file: fsPath => ({ fsPath, path: fsPath, scheme: 'file' }),
            parse: text => {
                const url = new URL(text);
                const scheme = url.protocol.slice(0, -1);
                // As VS Code's Uri, another scheme's fsPath is its path.
                const fsPath = scheme === 'file' ? fileURLToPath(text) : decodeURIComponent(url.pathname);
                return { fsPath, path: fsPath, scheme };
            },
            joinPath: (uri, ...parts) => ({ fsPath: path.join(uri.fsPath, ...parts), path: path.join(uri.fsPath, ...parts) })
        },
        Range,
        ViewColumn: { One: 1, Beside: -2 },
        EventEmitter: class {
            constructor() { this.listeners = []; this.event = listener => { this.listeners.push(listener); return { dispose() {} }; }; }
            fire(value) { this.listeners.forEach(listener => listener(value)); }
            dispose() { this.listeners = []; }
        },
        TreeItem: class { constructor(resourceUri, collapsibleState) { Object.assign(this, { resourceUri, collapsibleState }); } },
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        RelativePattern: class { constructor(base, pattern) { Object.assign(this, { base, pattern }); } },
        WorkspaceEdit: class {
            constructor() { this.edits = []; }
            replace(uri, range, text) { this.edits.push({ uri, range, text }); }
        },
        Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
        DiagnosticSeverity: { Error: 0, Warning: 1 },
        ConfigurationTarget: { Global: 1, Workspace: 2 },
        CodeAction: class { constructor(title, kind) { Object.assign(this, { title, kind }); } },
        Position: class { constructor(line, character) { Object.assign(this, { line, character }); } },
        Location: class { constructor(uri, rangeOrPosition) { Object.assign(this, { uri, range: rangeOrPosition }); } },
        Hover: class { constructor(contents, range) { Object.assign(this, { contents, range }); } },
        MarkdownString: class { constructor(value = '') { this.value = value; } appendCodeblock(code, lang) { this.value += `\n\`\`\`${lang}\n${code}\n\`\`\`\n`; return this; } appendMarkdown(text) { this.value += text; return this; } },
        CompletionItem: class { constructor(label, kind) { Object.assign(this, { label, kind }); } },
        CompletionItemKind: { Variable: 5, Function: 2, Field: 4, Property: 9, Keyword: 13, Reference: 17, EnumMember: 19, Constant: 20 },
        SnippetString: class { constructor(value) { this.value = value; } },
        DocumentLink: class { constructor(range, target) { Object.assign(this, { range, target }); } },
        CodeActionKind: { QuickFix: 'quickfix' },
        env: { language: 'zh-tw' },
        languages: {
            createDiagnosticCollection: name => {
                const target = name === 'robot-preview' ? state.diagnostics : (state.collections[name] = new Map());
                return {
                    clear: () => target.clear(),
                    set: (uri, list) => target.set(uri.fsPath, list),
                    delete: uri => target.delete(uri.fsPath),
                    dispose() {}
                };
            },
            registerCodeActionsProvider: (selector, provider) => {
                const providers = [...(state.codeActionProviders || []), provider];
                state.codeActionProviders = providers;
                state.codeActions = { provideCodeActions: (...args) => providers.flatMap(each => each.provideCodeActions(...args) || []) };
                return { dispose() {} };
            },
            registerDefinitionProvider: (selector, provider) => ((state.definitions = provider), { dispose() {} }),
            registerHoverProvider: (selector, provider) => ((state.hovers = provider), { dispose() {} }),
            registerCompletionItemProvider: (selector, provider) => ((state.completions = provider), { dispose() {} }),
            registerDocumentLinkProvider: (selector, provider) => ((state.links = provider), { dispose() {} })
        },
        workspace: {
            getWorkspaceFolder: () => ({ uri: { fsPath: workspace } }),
            workspaceFolders: [{ uri: { fsPath: workspace }, name: path.basename(workspace) }],
            findFiles: async () => (await fsp.readdir(workspace, { recursive: true }))
                .filter(file => file.endsWith('package.xml'))
                .map(file => ({ fsPath: path.join(workspace, file) })),
            textDocuments: state.docs,
            fs: {
                readFile: async uri => fsp.readFile(uri.fsPath),
                stat: async uri => { const s = await fsp.stat(uri.fsPath); return { size: s.size, mtime: s.mtimeMs }; },
                writeFile: async (uri, data) => fsp.writeFile(uri.fsPath, data),
                createDirectory: async uri => fsp.mkdir(uri.fsPath, { recursive: true }),
                readDirectory: async uri => (await fsp.readdir(uri.fsPath)).map(name => [name, 1]),
                delete: async uri => fsp.rm(uri.fsPath)
            },
            // `watched` holds the last watcher's callbacks; `watchers` every watcher, with what it watches.
            createFileSystemWatcher: pattern => {
                const watcher = { pattern, disposed: false };
                (state.watchers ||= []).push(watcher);
                return {
                    onDidChange: f => { state.watched.change = watcher.change = f; },
                    onDidCreate: f => { state.watched.create = watcher.create = f; },
                    onDidDelete: f => { watcher.delete = f; },
                    dispose() { watcher.disposed = true; }
                };
            },
            onDidChangeTextDocument: on('change'),
            onDidSaveTextDocument: on('save'),
            onDidOpenTextDocument: on('open'),
            onDidCloseTextDocument: on('close'),
            onDidChangeConfiguration: on('config'),
            getConfiguration: () => ({
                get: key => state.config[key],
                inspect: key => ({ globalValue: state.globalConfig?.[key], workspaceValue: state.workspaceConfig?.[key] }),
                update: async (key, value, target) => {
                    state.config[key] = value;
                    state.configWrites = [...(state.configWrites || []), { key, value, target }];
                    fire('config', { affectsConfiguration: name => name === `robotPreviewUrdf.${key}` });
                }
            }),
            openTextDocument: async fsPath => openDocument(fsPath),
            asRelativePath: target => path.relative(workspace, target.fsPath ?? target).split(path.sep).join('/'),
            // Like VS Code, every range refers to the text before the edit.
            applyEdit: async edit => {
                const located = edit.edits.map(({ uri, range, text }) => {
                    const doc = openDocument(uri.fsPath);
                    return { doc, start: doc.offsetAt(range.start), end: doc.offsetAt(range.end), text };
                });
                for (const { doc, start, end, text } of [...located].sort((a, b) => b.start - a.start)) {
                    const current = doc.getText();
                    doc.edit(current.slice(0, start) + text + current.slice(end));
                }
                for (const { doc, text } of located) {
                    state.applied.push(text);
                    fire('change', { document: doc, contentChanges: [{}] });
                }
                return true;
            }
        },
        window: {
            createWebviewPanel: () => makePanel(),
            registerWebviewPanelSerializer: (viewType, serializer) => {
                state.serializer = serializer;
                return { dispose() {} };
            },
            // `trees` holds each tree view's options and the view, whose description the extension sets.
            createTreeView: (id, options) => {
                const view = { options, description: '', dispose() {} };
                (state.trees ||= {})[id] = view;
                return view;
            },
            registerCustomEditorProvider: (viewType, provider) => {
                state.customEditors[viewType] = provider;
                return { dispose() {} };
            },
            onDidChangeActiveTextEditor: on('active'),
            onDidChangeTextEditorSelection: on('selection'),
            activeTextEditor: null,
            visibleTextEditors: [],
            showTextDocument: async (doc, options) => {
                if (!options) return;
                state.revealed = { fsPath: doc.uri.fsPath, line: options.selection.start.line, viewColumn: options.viewColumn, focus: !options.preserveFocus };
            },
            showWarningMessage: message => state.status.push(message),
            showErrorMessage: message => state.status.push(message),
            showInformationMessage: message => state.status.push(message),
            setStatusBarMessage: message => state.status.push(message),
            showQuickPick: async items => items[0],
            showInputBox: async () => state.inputBoxValue,
            showSaveDialog: async ({ defaultUri }) => defaultUri,
            showOpenDialog: async options => {
                state.openDialogOptions = options;
                return state.openDialogResult;
            }
        },
        commands: {
            registerCommand: (id, callback) => {
                (state.commands ||= {})[id] = callback;
                return { dispose() {} };
            },
            executeCommand: async (...args) => {
                (state.executed ||= []).push(args);
                return state.onExecute?.(...args);
            }
        }
    };

    const originalLoad = Module._load;
    Module._load = function (request, ...rest) {
        return request === 'vscode' ? vscode : originalLoad.call(this, request, ...rest);
    };
    // require caches by real path: os.tmpdir() is a symlink on macOS, so the path as given would miss a reload.
    delete require.cache[require.resolve(extensionFile)];
    const extension = require(extensionFile);
    Module._load = originalLoad;

    const context = {
        extensionUri: { fsPath: root },
        globalStorageUri: globalStorage && { fsPath: globalStorage, path: globalStorage },
        subscriptions: [],
        globalState: { get: key => state.globalState.get(key), keys: () => [...state.globalState.keys()], update: async (key, value) => state.globalState.set(key, value) },
        workspaceState: { get: (key, fallback) => state.workspaceState.get(key) ?? fallback, update: async (key, value) => state.workspaceState.set(key, value) }
    };

    const open = fsPath => {
        const doc = openDocument(fsPath);
        vscode.window.activeTextEditor = { document: doc, viewColumn: 1, selections: [{ active: { line: 0, character: 0 } }] };
        vscode.window.visibleTextEditors = [vscode.window.activeTextEditor];
        return doc;
    };

    return {
        vscode,
        state,
        fire,
        open,
        activate: () => extension.activate(context),
        lastOf: type => state.posted.filter(message => message.type === type).at(-1),
        allOf: type => state.posted.filter(message => message.type === type)
    };
}

export async function waitFor(predicate, ms = 5000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
        const value = predicate();
        if (value) return value;
        await sleep(20);
    }
    throw new Error('timed out');
}

// Opens `primary` in a mocked VS Code and returns once the webview got its first load.
export async function startPreview(workspace, primary, config = {}) {
    const env = loadExtension({ workspace, config });
    env.open(primary);
    env.activate();
    const panel = await waitFor(() => env.state.panels[0]?.webview.html && env.state.panels[0]);
    panel.receive({ type: 'ready' });
    return { env, panel, load: await waitFor(() => env.lastOf('load')) };
}
