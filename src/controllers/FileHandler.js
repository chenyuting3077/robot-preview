import { ModelLoaderFactory } from '../loaders/ModelLoaderFactory.js';
import * as THREE from 'three';
import { readFileContent } from '../utils/FileUtils.js';
import { loadMeshFile, clearMeshCache } from '../utils/MeshLoader.js';

const MESH_RE = /\.(stl|dae|obj)$/i;

// ColladaLoader turns Z_UP files Y-up and leaves Y_UP / X_UP alone; a lone DAE is instead put in the
// robot's Z-up frame like RViz does. A missing <up_axis> counts as Z_UP, the ROS default, not Collada's Y_UP.
function daeToZUp(object, text) {
    const axis = text.match(/<up_axis>\s*([XYZ])_UP/)?.[1] ?? 'Z';
    object.rotation.set(axis === 'Y' ? Math.PI / 2 : 0, axis === 'X' ? -Math.PI / 2 : 0, 0);
}

function meshModel(mesh, name) {
    const object = mesh.isBufferGeometry
        ? new THREE.Mesh(mesh, new THREE.MeshPhongMaterial({ color: 0xb0b0b0, shininess: 30 }))
        : mesh;
    object.traverse(child => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
    const link = { name: 'mesh_root', threeObject: object, visuals: [{ threeObject: object, geometry: { mesh: name } }], inertial: null };
    return { name, isMesh: true, rootLink: 'mesh_root', links: new Map([['mesh_root', link]]), joints: new Map(), threeObject: object };
}

// FNV-1a plus a second 32-bit pass with the MurmurHash2 multiplier; callers
// pair it with the size. A false match needs a same-size file colliding in
// both (estimated, not measured: ~2^-64 per changed file) and would show stale
// meshes.
// Words at a time when aligned: 30 MB hashes in 10 ms instead of 44 (Node 22).
function contentHash(bytes) {
    let a = 0x811c9dc5;
    let b = 0x01000193;
    let i = 0;
    if (bytes.byteOffset % 4 === 0) {
        const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length >>> 2);
        for (let w = 0; w < words.length; w++) {
            a = Math.imul(a ^ words[w], 0x01000193);
            b = Math.imul(b ^ words[w], 0x5bd1e995);
        }
        i = words.length * 4;
    }
    for (; i < bytes.length; i++) {
        a = Math.imul(a ^ bytes[i], 0x01000193);
        b = Math.imul(b ^ bytes[i], 0x5bd1e995);
    }
    return `${a >>> 0}:${b >>> 0}:${bytes.length}`;
}

// Files a mesh reads besides itself (materials, buffers, textures): the mesh
// cache is keyed by the mesh's own File, so it cannot see these change.
const RESOURCE_RE = /\.(mtl|bin|png|jpe?g|gif|bmp|tga|tiff?|webp)$/i;

export class FileHandler {
    constructor() {
        this.fileMap = new Map();
        this.hashOf = new WeakMap();
        this.currentModelFile = null;
        this.onModelLoaded = null;
        this.onLoadError = null;
    }

    static MESH_TIMEOUT_MS = 15000;

    // An unchanged file keeps its File object, which keys the mesh cache. UR5e
    // (9.8 MB) full reload until meshes are ready: 259 → 62 ms; hashing adds
    // ~10 ms to the first load (headless Chrome 157, Apple M2, median of 10). Hashing
    // instead of comparing bytes avoids keeping a second copy of every file.
    setFiles(entries, removed = [], reset = false) {
        const previous = new Map(this.fileMap);
        if (reset) this.fileMap.clear();
        removed.forEach(path => this.fileMap.delete(path));
        let resourceChanged = false;
        entries.forEach(({ path, data }) => {
            const hash = contentHash(data);
            const old = previous.get(path);
            if (old && this.hashOf.get(old) === hash) {
                this.fileMap.set(path, old);
                return;
            }
            const file = new File([data], path.split('/').pop());
            this.hashOf.set(file, hash);
            this.fileMap.set(path, file);
            resourceChanged ||= RESOURCE_RE.test(path);
        });
        // A resource gone from the listing counts as changed, whether removed
        // explicitly or left out of a full reload.
        for (const path of previous.keys()) {
            if (!this.fileMap.has(path) && RESOURCE_RE.test(path)) resourceChanged = true;
        }
        if (resourceChanged) clearMeshCache();
    }

    async loadPrimary(primaryPath, options = {}) {
        const file = this.fileMap.get(primaryPath);
        this.currentModelFile = file;
        try {
            if (!file) throw new Error(`File not found: ${primaryPath}`);
            if (MESH_RE.test(file.name)) {
                const mesh = await loadMeshFile(primaryPath, this.fileMap);
                if (!mesh) throw new Error(window.i18n.t('cannotLoadMesh'));
                const model = meshModel(mesh, file.name);
                if (/\.dae$/i.test(file.name)) daeToZUp(model.threeObject, await readFileContent(file));
                this.onModelLoaded?.(model, file);
                return;
            }
            const content = await readFileContent(file);
            const fileType = ModelLoaderFactory.detectFileType(file.name, content);
            if (!fileType) throw new Error(`${window.i18n.t('unsupportedFormat')}: ${file.name}`);
            const model = await ModelLoaderFactory.loadModel(fileType, content, primaryPath, this.fileMap, file, options);
            options.onParsed?.(model);
            await Promise.race([model.meshesReady, new Promise(resolve => setTimeout(resolve, FileHandler.MESH_TIMEOUT_MS))]);
            this.onModelLoaded?.(model, file);
        } catch (error) {
            console.error('Failed to load file:', error);
            document.getElementById('canvas-snapshot')?.remove();
            this.onLoadError?.(error);
        }
    }
}
