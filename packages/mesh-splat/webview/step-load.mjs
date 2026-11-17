import * as THREE from 'three';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { decodeStepCache } from './step-cache.mjs';
import { groupByFace, stepLengthUnit } from './step.mjs';
import { MESH_GREY, surfaceMaterial } from './materials.mjs';
import StepWorker from './step-worker.js?worker&inline';
import foxtrotWasm from '../vendor/foxtrot/foxtrot_bg.wasm?url';
import occtWasm from '../vendor/occt/occt-import-js.wasm?url';

// STEP is B-rep and needs a CAD kernel to tessellate.
// ponytail: foxtrot still skips a few faces (AMR: 2 of 18,255), left as small holes; run OpenCascade on
// those faces only if a model needs them. OpenCascade (C++) gets every face but takes minutes on large
// assemblies, so it runs only when the length unit is unclear or foxtrot fails or yields no triangles (it
// skips shapes it does not know). Both run in a worker so the view keeps turning meanwhile.

// A fresh worker per job: a Rust panic aborts foxtrot's instance, and WASM memory only goes back when the
// worker does. `workers` lets a caller stop the rest when one fails.
// A worker that dies without an error event (none seen yet) is caught by these timeouts. foxtrot reports
// progress, so its timeout counts from the last face it started; OpenCascade cannot, so its timeout covers
// the whole run, far above the slowest measured (116 s, 161 MB file in VS Code).
const TIMEOUT_MINUTES = { foxtrot: 2, encode: 5, occt: 25 };
function runWorker(message, transfer, workers = []) {
    return new Promise((resolve, reject) => {
        const worker = new StepWorker();
        workers.push(worker);
        const finish = (error, data) => {
            clearTimeout(timer);
            worker.terminate();
            if (error) reject(error);
            else resolve(data);
        };
        const minutes = TIMEOUT_MINUTES[message.job];
        const expire = () => setTimeout(() => finish(new Error(`STEP ${message.job} worker went ${minutes} minutes without progress`)), minutes * 60e3);
        let timer = expire();
        worker.onmessage = ({ data }) => {
            if (data?.progress === undefined) return finish(data?.error && new Error(data.error), data);
            clearTimeout(timer);
            timer = expire();
        };
        worker.onmessageerror = () => finish(new Error('STEP worker sent a message that could not be read'));
        worker.onerror = event => finish(new Error(event.message));
        worker.postMessage(message, transfer);
    });
}

// The worker gets the WASM bytes, not its URL, so it does not depend on a fetch from a blob: worker
// reaching the webview's service worker, which serves extension files in VS Code.
const wasmOf = url => fetch(new URL(url, document.baseURI)).then(response => response.arrayBuffer());

// Each worker parses the whole file and triangulates every parts-th face. A worker's WASM peaks at about
// 3.3x the file (161 MB file: 512 MB, Node 22); budgeting 8x keeps that file at two workers on a machine
// with 8 GB or more. The budget is a quarter of the machine's memory (Chrome reports at most 8 GB), so a
// small machine runs fewer, slower workers instead of running out.
async function foxtrotJob(bytes) {
    const budget = Math.min(1.5e9, (navigator.deviceMemory ?? 8) * 0.25e9);
    const parts = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1, 1 + Math.floor(budget / (8 * bytes.length))));
    // The last worker takes `bytes` itself, leaving it empty here, instead of a copy.
    const copies = Array.from({ length: parts }, (_, part) => (part === parts - 1 ? bytes : bytes.slice()));
    const wasm = await wasmOf(foxtrotWasm);
    const workers = [];
    // One mesh per worker: merging them would hold every array twice at the memory peak.
    // When one fails OpenCascade runs next, so the others must not keep their memory meanwhile.
    return Promise.all(copies.map((copy, part) => {
        const own = wasm.slice(0);
        return runWorker({ job: 'foxtrot', bytes: copy, wasm: own, part, parts }, [own, copy.buffer], workers);
    })).catch(error => {
        workers.forEach(worker => worker.terminate());
        throw error;
    });
}

const occtJob = async bytes => {
    const wasm = await wasmOf(occtWasm);
    return runWorker({ job: 'occt', bytes, wasm }, [wasm, bytes.buffer]);
};

const stepMaterials = new Map();
const stepMaterial = color => {
    const key = color.join();
    if (!stepMaterials.has(key)) stepMaterials.set(key, surfaceMaterial(color, { userData: { srgb: color } }));
    return stepMaterials.get(key);
};

/** @param {Omit<import('./step.mjs').StepMesh, 'normals'> & { normalAttribute?: THREE.BufferAttribute | THREE.InterleavedBufferAttribute }} mesh */
function stepMesh({ name = '', positions, normalAttribute, indices, groups }) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (normalAttribute) geometry.setAttribute('normal', normalAttribute);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    groups.forEach(({ start, count }, slot) => geometry.addGroup(start, count, slot));
    if (!normalAttribute) geometry.computeVertexNormals();
    return Object.assign(new THREE.Mesh(geometry, groups.map(({ color }) => stepMaterial(color))), { name });
}

function foxtrotObject(parts, unit) {
    const group = new THREE.Group();
    for (const { positions, normals, indices, groups } of parts) {
        if (!indices.length) continue;
        for (let i = 0; i < positions.length; i++) positions[i] *= unit;
        group.add(stepMesh({ positions, normalAttribute: new THREE.BufferAttribute(normals, 3), indices, groups }));
    }
    return group;
}

function occtObject({ meshes }) {
    const group = new THREE.Group();
    for (const mesh of meshes) {
        const { indices, groups } = groupByFace(mesh.indices, mesh.faces, mesh.color ?? MESH_GREY);
        group.add(stepMesh({ name: mesh.name, positions: mesh.positions, normalAttribute: mesh.normals && new THREE.BufferAttribute(mesh.normals, 3), indices, groups }));
    }
    return group;
}

function cachedObject(bytes) {
    const group = new THREE.Group();
    for (const { name, positions, normals, indices, groups } of decodeStepCache(MeshoptDecoder, bytes)) {
        group.add(stepMesh({ name, positions, normalAttribute: new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(normals, 4), 3, 0, true), indices, groups }));
    }
    return group;
}

// Encoded in a worker after the first frame, so the model shows without waiting for it.
function cacheStep(object, sendCache) {
    const meshes = [];
    object.traverse(({ isMesh, name, geometry, material }) => {
        if (!isMesh || !geometry.index?.count) return;
        meshes.push({
            name,
            positions: geometry.attributes.position.array.slice(),
            normals: geometry.attributes.normal.array.slice(),
            indices: Uint32Array.from(geometry.index.array),
            groups: geometry.groups.map(({ start, count, materialIndex }) => ({ start, count, color: material[materialIndex].userData.srgb }))
        });
    });
    if (!meshes.length) return;
    setTimeout(() => runWorker({ job: 'encode', meshes }, meshes.flatMap(mesh => [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer]))
        .then(sendCache, error => console.warn('STEP cache not written:', error.message)), 500);
}

// `cached` is the cache file's URL, or ''. The transport's `sendCache` is null outside VS Code.
export async function stepModel(cached, { readAll, sendCache }) {
    // A cache that is gone (another editor's trim) or unreadable is replaced by tessellating again.
    if (cached) {
        const object = await fetch(cached)
            .then(response => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(response.statusText))))
            .then(async buffer => (await MeshoptDecoder.ready, cachedObject(new Uint8Array(buffer))))
            .catch(error => (console.warn('STEP cache unreadable:', error), null));
        if (object) return object;
    }
    const bytes = await readAll();
    const unit = stepLengthUnit(new TextDecoder('latin1').decode(bytes));
    const foxtrotParts = unit && await foxtrotJob(bytes).catch(() => null);
    // The last foxtrot worker took the file, so OpenCascade reads it again.
    const object = foxtrotParts?.some(part => part.indices.length) ? foxtrotObject(foxtrotParts, unit) : occtObject(await occtJob(bytes.length ? bytes : await readAll()));
    // OpenCascade can finish without a single triangle (the 161 MB assembly does); an empty view would look like a hang.
    let triangles = 0;
    object.traverse(child => { triangles += child.geometry?.index?.count ?? 0; });
    if (!triangles) throw new Error('neither foxtrot nor OpenCascade produced any triangles for this file');
    if (sendCache) cacheStep(object, sendCache);
    return object;
}
