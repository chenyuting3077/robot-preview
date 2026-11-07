import Module, { createRequire } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const extensionPath = new URL('../../packages/urdf-mjcf/extension.js', import.meta.url).pathname;
export const fixtureWorkspace = new URL('../fixtures/ros_ws', import.meta.url).pathname;
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

export function loadExtension({ workspace, config = {}, extension: extensionFile = extensionPath }) {
    const listeners = {};
    const on = name => callback => {
        (listeners[name] ||= []).push(callback);
        return { dispose() {} };
    };
    const fire = (name, event) => (listeners[name] || []).forEach(callback => callback(event));

    const state = {
        docs: [],
        posted: [],
        panels: [],
        revealed: null,
        applied: [],
        status: [],
        diagnostics: new Map(),
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
                asWebviewUri: uri => uri.fsPath,
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
            joinPath: (uri, ...parts) => ({ fsPath: path.join(uri.fsPath, ...parts), path: path.join(uri.fsPath, ...parts) })
        },
        Range,
        ViewColumn: { One: 1, Beside: -2 },
        RelativePattern: class { constructor(base, pattern) { Object.assign(this, { base, pattern }); } },
        WorkspaceEdit: class {
            constructor() { this.edits = []; }
            replace(uri, range, text) { this.edits.push({ uri, range, text }); }
        },
        Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
        DiagnosticSeverity: { Error: 0, Warning: 1 },
        ConfigurationTarget: { Global: 1, Workspace: 2 },
        CodeAction: class { constructor(title, kind) { Object.assign(this, { title, kind }); } },
        CodeActionKind: { QuickFix: 'quickfix' },
        env: { language: 'zh-tw' },
        languages: {
            createDiagnosticCollection: () => ({
                clear: () => state.diagnostics.clear(),
                set: (uri, list) => state.diagnostics.set(uri.fsPath, list),
                dispose() {}
            }),
            registerCodeActionsProvider: (selector, provider) => {
                state.codeActions = provider;
                return { dispose() {} };
            }
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
                writeFile: async (uri, data) => fsp.writeFile(uri.fsPath, data)
            },
            createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} }),
            onDidChangeTextDocument: on('change'),
            onDidSaveTextDocument: on('save'),
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
            asRelativePath: fsPath => path.relative(workspace, fsPath),
            applyEdit: async edit => {
                for (const { uri, range, text } of edit.edits) {
                    const doc = openDocument(uri.fsPath);
                    const current = doc.getText();
                    doc.edit(current.slice(0, doc.offsetAt(range.start)) + text + current.slice(doc.offsetAt(range.end)));
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
            showOpenDialog: async () => state.openDialogResult
        },
        commands: {
            registerCommand: (id, callback) => {
                (state.commands ||= {})[id] = callback;
                return { dispose() {} };
            }
        }
    };

    const originalLoad = Module._load;
    Module._load = function (request, ...rest) {
        return request === 'vscode' ? vscode : originalLoad.call(this, request, ...rest);
    };
    delete require.cache[extensionFile];
    const extension = require(extensionFile);
    Module._load = originalLoad;

    const context = {
        extensionUri: { fsPath: path.dirname(extensionFile) },
        subscriptions: [],
        globalState: { get: key => state.globalState.get(key), update: async (key, value) => state.globalState.set(key, value) },
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
