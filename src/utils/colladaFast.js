import * as THREE from 'three';
const daeWasmUrl = new URL('../wasm/dae.wasm', import.meta.url);

let compiled = null;

// rust/dae builds the vertex data and strips it from the XML, so ColladaLoader's DOM parse and
// float splitting only see materials and the scene graph. Returns null when rust/dae declines the file.
export async function splitDaeGeometry(bytes) {
    compiled ||= fetch(daeWasmUrl).then(response => response.arrayBuffer()).then(buffer => WebAssembly.compile(buffer));
    // A fresh instance per file: wasm memory never shrinks, and a 33 MB DAE grows it past 100 MB.
    const { exports } = await WebAssembly.instantiate(await compiled);
    const input = exports.alloc(bytes.length);
    new Uint8Array(exports.memory.buffer).set(bytes, input);
    const result = exports.run();
    // Read after run(): growing memory detaches earlier views of it.
    const memory = exports.memory.buffer;
    const [status, xmlPtr, xmlLen, jsonPtr, jsonLen, floatPtr, floatLen] = new Uint32Array(memory, result, 7);
    if (status !== 0) return null;
    const decoder = new TextDecoder();
    return {
        xml: decoder.decode(new Uint8Array(memory, xmlPtr, xmlLen)),
        geometries: JSON.parse(decoder.decode(new Uint8Array(memory, jsonPtr, jsonLen))),
        floats: new Float32Array(memory, floatPtr, floatLen)
    };
}

export async function parseCollada(loader, bytes, url) {
    const path = THREE.LoaderUtils.extractUrlBase(url);
    const fast = await splitDaeGeometry(bytes).catch(error => (console.warn('rust/dae failed, using ColladaLoader:', error), null));
    if (!fast) return loader.parse(new TextDecoder().decode(bytes), path);
    const result = loader.parse(fast.xml, path);
    for (const { id, types } of fast.geometries) {
        const build = result.library.geometries[id]?.build;
        if (!build) continue;
        for (const { type, groups, attributes } of types) {
            const geometry = build[type]?.data;
            if (!geometry) continue;
            geometry.clearGroups();
            groups.forEach(([start, count], index) => geometry.addGroup(start, count, index));
            for (const [name, offset, length, stride] of attributes) {
                geometry.setAttribute(name, new THREE.BufferAttribute(fast.floats.slice(offset, offset + length), stride));
            }
        }
    }
    return result;
}
