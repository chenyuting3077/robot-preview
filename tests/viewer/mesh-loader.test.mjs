import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedMeshParse, textureManager } from '../../src/utils/MeshLoader.js';
import { FileHandler } from '../../src/controllers/FileHandler.js';

test('texture references resolve from sent files under the vscode-webview blob scheme', () => {
    const texture = new File(['png'], 'tex.png');
    const manager = textureManager(new Map([['/mesh/tex.png', texture]]));
    assert.match(manager.resolveURL('blob:vscode-webview://abc/tex.png'), /^blob:/);
    assert.notEqual(manager.resolveURL('blob:vscode-webview://abc/tex.png'), 'blob:vscode-webview://abc/tex.png');
    assert.equal(manager.resolveURL('blob:vscode-webview://abc/1234-uuid'), 'blob:vscode-webview://abc/1234-uuid');
});

test('mesh parse is cached per file and invalidated when a material or texture changes', async () => {
    const mesh = new File(['solid'], 'part.obj');
    let parses = 0;
    const parse = async () => { parses++; return { isBufferGeometry: true, clone() { return this; } }; };
    await cachedMeshParse(mesh, parse);
    await cachedMeshParse(mesh, parse);
    assert.equal(parses, 1);
    new FileHandler().setFiles([{ path: '/mesh/part.mtl', data: new Uint8Array() }]);
    await cachedMeshParse(mesh, parse);
    assert.equal(parses, 2);
});

test('a full reload with unchanged files keeps the mesh cache; a changed or removed texture clears it', async () => {
    const handler = new FileHandler();
    const files = [{ path: '/m/part.obj', data: new TextEncoder().encode('v 0 0 0') }, { path: '/m/tex.webp', data: new Uint8Array([1]) }];
    handler.setFiles(files, [], true);
    const mesh = handler.fileMap.get('/m/part.obj');
    let parses = 0;
    const parse = async () => { parses++; return { isBufferGeometry: true, clone() { return this; } }; };
    await cachedMeshParse(mesh, parse);
    handler.setFiles(files, [], true);
    assert.equal(handler.fileMap.get('/m/part.obj'), mesh, 'unchanged file keeps its File');
    await cachedMeshParse(mesh, parse);
    assert.equal(parses, 1);
    handler.setFiles([{ path: '/m/tex.webp', data: new Uint8Array([2]) }]);
    await cachedMeshParse(mesh, parse);
    assert.equal(parses, 2);
    handler.setFiles([], ['/m/tex.webp']);
    await cachedMeshParse(mesh, parse);
    assert.equal(parses, 3);
});

test('a texture left out of a full reload clears the mesh cache', async () => {
    const handler = new FileHandler();
    const obj = { path: '/m/part.obj', data: new TextEncoder().encode('v 0 0 0') };
    handler.setFiles([obj, { path: '/m/tex.png', data: new Uint8Array([1]) }], [], true);
    const mesh = handler.fileMap.get('/m/part.obj');
    let parses = 0;
    const parse = async () => { parses++; return { isBufferGeometry: true, clone() { return this; } }; };
    await cachedMeshParse(mesh, parse);
    handler.setFiles([obj], [], true);
    assert.equal(handler.fileMap.get('/m/part.obj'), mesh);
    await cachedMeshParse(mesh, parse);
    assert.equal(parses, 2);
});
