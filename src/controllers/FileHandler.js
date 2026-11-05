import { ModelLoaderFactory } from '../loaders/ModelLoaderFactory.js';
import * as THREE from 'three';
import { readFileContent } from '../utils/FileUtils.js';
import { loadMeshFile, clearMeshCache } from '../utils/MeshLoader.js';

const MESH_RE = /\.(stl|dae|obj)$/i;

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

export class FileHandler {
    constructor() {
        this.fileMap = new Map();
        this.currentModelFile = null;
        this.onModelLoaded = null;
        this.onLoadError = null;
    }

    static MESH_TIMEOUT_MS = 15000;

    setFiles(entries, removed = [], reset = false) {
        if (reset) this.fileMap.clear();
        removed.forEach(path => this.fileMap.delete(path));
        entries.forEach(({ path, data }) => this.fileMap.set(path, new File([data], path.split('/').pop())));
        if (entries.some(({ path }) => /\.(mtl|bin|png|jpe?g)$/i.test(path))) clearMeshCache();
    }

    async loadPrimary(primaryPath, options = {}) {
        const file = this.fileMap.get(primaryPath);
        this.currentModelFile = file;
        try {
            if (!file) throw new Error(`File not found: ${primaryPath}`);
            if (MESH_RE.test(file.name)) {
                const mesh = await loadMeshFile(primaryPath, this.fileMap);
                if (!mesh) throw new Error(window.i18n.t('cannotLoadMesh'));
                this.onModelLoaded?.(meshModel(mesh, file.name), file);
                return;
            }
            const content = await readFileContent(file);
            const fileType = ModelLoaderFactory.detectFileType(file.name, content);
            if (!fileType) throw new Error(`${window.i18n.t('unsupportedFormat')}: ${file.name}`);
            const model = await ModelLoaderFactory.loadModel(fileType, content, primaryPath, this.fileMap, file, options);
            await Promise.race([model.meshesReady, new Promise(resolve => setTimeout(resolve, FileHandler.MESH_TIMEOUT_MS))]);
            this.onModelLoaded?.(model, file);
        } catch (error) {
            console.error('Failed to load file:', error);
            document.getElementById('canvas-snapshot')?.remove();
            this.onLoadError?.(error);
        }
    }
}
