import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DOMParser } from 'linkedom';

globalThis.DOMParser ??= DOMParser;
const wasmPath = new URL('../../src/wasm/dae.wasm', import.meta.url);
// Node's fetch has no file: URLs.
const realFetch = globalThis.fetch;
globalThis.fetch = async url => (String(url) === wasmPath.href ? new Response(fs.readFileSync(wasmPath)) : realFetch(url));
const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
const { parseCollada, splitDaeGeometry } = await import('../../src/utils/colladaFast.js');

function describe(scene) {
    const out = [];
    scene.traverse(object => {
        const entry = { type: object.type, name: object.name, matrix: object.matrix.elements.map(v => +v.toFixed(9)), children: object.children.length };
        if (object.geometry) {
            const g = object.geometry;
            entry.groups = g.groups.map(({ start, count, materialIndex }) => [start, count, materialIndex]);
            entry.attributes = Object.fromEntries(Object.entries(g.attributes).map(([name, a]) => [name, [a.itemSize, Array.from(a.array)]]));
            entry.materials = [object.material].flat().map(m => [m.type, m.name, m.color?.getHexString(), m.opacity, m.transparent, m.side]);
        }
        out.push(entry);
    });
    return out;
}

test('rust/dae gives the same scene as ColladaLoader alone', async () => {
    const bytes = fs.readFileSync(new URL('../fixtures/collada/mixed.dae', import.meta.url));
    assert.ok(await splitDaeGeometry(new Uint8Array(bytes)));
    const loader = new ColladaLoader();
    const expected = describe(loader.parse(new TextDecoder().decode(bytes), '').scene);
    const fast = await parseCollada(loader, new Uint8Array(bytes), 'blob:x');
    assert.deepEqual(describe(fast.scene), expected);
    assert.ok(expected.some(e => e.attributes?.uv) && expected.some(e => e.type === 'LineSegments'));
});

test('files outside rust/dae fall back to ColladaLoader', async () => {
    const xml = fs.readFileSync(new URL('../fixtures/collada/mixed.dae', import.meta.url), 'utf8')
        .replace('<input semantic="POSITION" source="#shape-pos"/>', '<input semantic="POSITION" source="#shape-pos"/><input semantic="COLOR" source="#shape-pos"/>');
    assert.equal(await splitDaeGeometry(new TextEncoder().encode(xml)), null);
    const loader = new ColladaLoader();
    const fast = await parseCollada(loader, new TextEncoder().encode(xml), 'blob:x');
    assert.deepEqual(describe(fast.scene), describe(loader.parse(xml, '').scene));
});

test('a stripped file ColladaLoader cannot parse is parsed again whole', async () => {
    const bytes = fs.readFileSync(new URL('../fixtures/collada/mixed.dae', import.meta.url));
    const loader = new ColladaLoader();
    const parse = loader.parse.bind(loader);
    let calls = 0;
    loader.parse = (text, path) => {
        if (calls++ === 0) throw new Error('stripped XML refused');
        return parse(text, path);
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
        const result = await parseCollada(loader, new Uint8Array(bytes), 'file:///mixed.dae');
        assert.deepEqual(describe(result.scene), describe(parse(new TextDecoder().decode(bytes), 'file:///').scene));
    } finally {
        console.warn = warn;
    }
});
