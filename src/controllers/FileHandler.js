import { ModelLoaderFactory } from '../loaders/ModelLoaderFactory.js';
import { readFileContent } from '../utils/FileUtils.js';

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
    }

    async loadPrimary(primaryPath) {
        const file = this.fileMap.get(primaryPath);
        this.currentModelFile = file;
        try {
            if (!file) throw new Error(`File not found: ${primaryPath}`);
            const content = await readFileContent(file);
            const fileType = ModelLoaderFactory.detectFileType(file.name, content);
            if (!fileType) throw new Error(`${window.i18n.t('unsupportedFormat')}: ${file.name}`);
            const model = await ModelLoaderFactory.loadModel(fileType, content, primaryPath, this.fileMap, file);
            await Promise.race([model.meshesReady, new Promise(resolve => setTimeout(resolve, FileHandler.MESH_TIMEOUT_MS))]);
            this.onModelLoaded?.(model, file);
        } catch (error) {
            console.error('Failed to load file:', error);
            document.getElementById('canvas-snapshot')?.remove();
            this.onLoadError?.(error);
        }
    }
}
