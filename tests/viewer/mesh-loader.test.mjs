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

test('meshes without normals get them, existing normals are kept', async () => {
    const THREE = await import('three');
    const { ensureMeshNormals } = await import('../../src/utils/MeshLoader.js');
    const bare = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const lit = bare.clone().setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
    const group = new THREE.Group().add(new THREE.Mesh(bare), new THREE.Mesh(lit));
    ensureMeshNormals(group);
    assert.deepEqual([...bare.attributes.normal.array.slice(0, 3)], [0, 0, 1]);
    assert.deepEqual([...lit.attributes.normal.array.slice(0, 3)], [0, 0, -1]);
});

test('a mesh sent without data is requested once, when first read, and kept while its version holds', async () => {
    const handler = new FileHandler();
    const requested = [];
    handler.requestFile = async path => { requested.push(path); return new TextEncoder().encode(`solid ${path}`); };
    handler.setFiles([{ path: '/m/used.stl', version: 'disk:1' }, { path: '/m/unused.stl', version: 'disk:1' }], [], true);
    const used = handler.fileMap.get('/m/used.stl');
    assert.equal(used.name, 'used.stl');
    assert.equal(await used.text(), 'solid /m/used.stl');
    assert.equal(new TextDecoder().decode(await used.arrayBuffer()), 'solid /m/used.stl');
    assert.deepEqual(requested, ['/m/used.stl']);
    handler.setFiles([{ path: '/m/used.stl', version: 'disk:1' }, { path: '/m/unused.stl', version: 'disk:1' }], [], true);
    assert.equal(handler.fileMap.get('/m/used.stl'), used, 'same version keeps the object, so the mesh cache holds');
    handler.setFiles([{ path: '/m/used.stl', version: 'disk:2' }]);
    assert.notEqual(handler.fileMap.get('/m/used.stl'), used);
    await handler.fileMap.get('/m/used.stl').text();
    assert.deepEqual(requested, ['/m/used.stl', '/m/used.stl']);
});
