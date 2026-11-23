import * as THREE from 'three';
import DistanceWorker from './distance-worker.js?worker&inline';
import { ownGeometry, positionsOf } from './cloud-colors.mjs';

// Loaded only when a distance is first chosen. One worker per reference file: its tree is the slow part, built
// once for every file and detail cloud measured against it, and dropped with the worker when nothing uses it.
export function createComparer(root) {
    const references = new Map();
    let jobs = 0;

    // Into the root's frame less the reference's origin, in float64, so a cloud placed at UTM coordinates reaches the
    // worker as small float32 numbers.
    const matrixOf = (object, origin) => {
        root.updateMatrixWorld(true);
        return new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z).multiply(root.matrixWorld.clone().invert()).multiply(object.matrixWorld).elements;
    };
    // A structured clone copies a view's whole buffer, so a view over part of one goes as a transferred copy.
    const sendable = (array, transfer) => {
        if (array.byteOffset === 0 && array.byteLength === array.buffer.byteLength) return array;
        const copy = array.slice();
        transfer.push(copy.buffer);
        return copy;
    };

    function referenceFor(file, objects) {
        if (references.has(file.id)) return references.get(file.id);
        const worker = new DistanceWorker();
        const origin = file.box.getCenter(new THREE.Vector3());
        const pending = new Map();
        const fail = error => {
            for (const { reject } of pending.values()) reject(error);
            pending.clear();
        };
        let ready;
        const built = new Promise((resolve, reject) => { ready = { resolve, reject }; });
        // A reference that failed to build is built again the next time it is asked for.
        built.catch(() => references.get(file.id)?.built === built && references.delete(file.id));
        worker.onmessage = ({ data }) => {
            if (data.type === 'ready') return ready.resolve();
            const job = pending.get(data.job);
            if (data.type === 'error' && data.job === undefined) return ready.reject(new Error(data.message));
            if (!job) return;
            if (data.type === 'progress') return job.onProgress(data.done, data.total);
            pending.delete(data.job);
            if (data.type === 'error') job.reject(new Error(data.message));
            else job.resolve(data.values);
        };
        worker.onerror = event => {
            const error = new Error(event.message || 'distance worker failed');
            ready.reject(error);
            fail(error);
        };
        const transfer = [];
        const parts = objects.map(object => {
            const geometry = ownGeometry(object);
            const part = { positions: sendable(positionsOf(geometry), transfer), matrix: matrixOf(object, origin), mesh: Boolean(object.isMesh) };
            if (object.isMesh && geometry.index) part.indices = sendable(geometry.index.array.subarray(0, geometry.index.count), transfer);
            return part;
        });
        worker.postMessage({ type: 'reference', parts }, transfer);
        const reference = { worker, origin, pending, built };
        references.set(file.id, reference);
        return reference;
    }

    return {
        // Distances of each of `objects` to `file`, whose `referenceObjects` (its clouds and meshes) form the reference.
        async measure(file, referenceObjects, objects, onProgress = () => {}) {
            const reference = referenceFor(file, referenceObjects);
            await reference.built;
            const transfer = [];
            const parts = objects.map(object => ({ positions: sendable(positionsOf(ownGeometry(object)), transfer), matrix: matrixOf(object, reference.origin) }));
            const job = ++jobs;
            return new Promise((resolve, reject) => {
                reference.pending.set(job, { resolve, reject, onProgress });
                reference.worker.postMessage({ type: 'query', job, parts }, transfer);
            });
        },
        // Ends the workers of references no object uses any more, giving back their trees' memory.
        keep(ids) {
            for (const [id, reference] of references) {
                if (ids.has(id)) continue;
                reference.worker.terminate();
                for (const { reject } of reference.pending.values()) reject(new Error('cancelled'));
                references.delete(id);
            }
        }
    };
}
