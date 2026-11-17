import initFoxtrot, { reserve_input, step_to_mesh_input } from '../vendor/foxtrot/foxtrot.js';
import occtimportjs from '../vendor/occt/occt-import-js.js';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { encodeStepCache } from './step-cache.mjs';
import { groupByColor } from './step.mjs';

// Each job returns [message, transfer list].
const JOBS = {
    async encode({ meshes }) {
        await MeshoptEncoder.ready;
        const out = encodeStepCache(MeshoptEncoder, meshes);
        return [out, [out.buffer]];
    },
    async foxtrot({ bytes, wasm, part, parts }) {
        // foxtrot reports each face it starts; every 256th tells the page the run is still moving.
        globalThis.foxtrotProgress = faces => faces % 256 === 0 && self.postMessage({ progress: faces });
        const { memory } = await initFoxtrot({ module_or_path: wasm });
        const at = reserve_input(bytes.length);
        new Uint8Array(memory.buffer, at, bytes.length).set(bytes);
        // Frees this copy now; a dropped reference would wait for a GC that the long call never triggers.
        bytes.buffer.transfer?.(0);
        const mesh = step_to_mesh_input(part, parts);
        // Grouped here so the per-vertex colors never reach the page.
        const { indices, groups } = groupByColor(mesh.take_colors(), mesh.take_indices());
        const out = { positions: mesh.take_positions(), normals: mesh.take_normals(), indices, groups };
        return [out, [out.positions.buffer, out.normals.buffer, out.indices.buffer]];
    },
    async occt({ bytes, wasm }) {
        const occt = await occtimportjs({ wasmBinary: wasm });
        const result = occt.ReadStepFile(bytes, { linearUnit: 'meter' });
        if (!result.success) throw new Error('OpenCascade could not read the file');
        const meshes = result.meshes.map(mesh => ({
            name: mesh.name,
            color: mesh.color,
            faces: mesh.brep_faces,
            positions: new Float32Array(mesh.attributes.position.array),
            normals: mesh.attributes.normal && new Float32Array(mesh.attributes.normal.array),
            indices: new Uint32Array(mesh.index.array)
        }));
        return [{ meshes }, meshes.flatMap(mesh => [mesh.positions.buffer, mesh.indices.buffer, ...(mesh.normals ? [mesh.normals.buffer] : [])])];
    }
};

self.onmessage = async ({ data }) => {
    try {
        const job = Object.hasOwn(JOBS, data.job) && JOBS[data.job];
        if (!job) throw new Error(`unknown STEP job ${data.job}`);
        self.postMessage(...await job(data));
    } catch (error) {
        self.postMessage({ error: String(error?.message ?? error) });
    }
};
