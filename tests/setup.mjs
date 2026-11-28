import { File } from 'node:buffer';

globalThis.File ??= File;
// three's FileLoader reports progress with it, which Node lacks.
globalThis.ProgressEvent ??= class extends Event {
    constructor(type, init = {}) {
        super(type);
        Object.assign(this, init);
    }
};
