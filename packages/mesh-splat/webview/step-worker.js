import initFoxtrot, { reserve_input, step_to_mesh_input } from '../vendor/foxtrot/foxtrot.js';
import occtimportjs from '../vendor/occt/occt-import-js.js';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { encodeStepCache } from './step-cache.mjs';
import { groupByColor } from './step.mjs';

// One job per worker: a Rust panic aborts the foxtrot instance, so the caller starts a fresh worker each time.
self.onmessage = async ({ data: { job, bytes, wasm, part, parts, meshes: cacheMeshes } }) => {
    try {
        if (job === 'encode') {
            await MeshoptEncoder.ready;
            const out = encodeStepCache(MeshoptEncoder, cacheMeshes);
            self.postMessage(out, [out.buffer]);
            return;
        }
        if (job === 'foxtrot') {
            const { memory } = await initFoxtrot({ module_or_path: wasm });
            const at = reserve_input(bytes.length);
            new Uint8Array(memory.buffer, at, bytes.length).set(bytes);
            // Frees this copy now; a dropped reference would wait for a GC that the long call never triggers.
            bytes.buffer.transfer?.(0);
            const mesh = step_to_mesh_input(part, parts);
            // Grouped here so the per-vertex colors never reach the page.
            const { indices, groups } = groupByColor(mesh.take_colors(), mesh.take_indices());
            const out = { positions: mesh.take_positions(), normals: mesh.take_normals(), indices, groups };
            self.postMessage(out, [out.positions.buffer, out.normals.buffer, out.indices.buffer]);
            return;
        }
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
        self.postMessage({ meshes }, meshes.flatMap(mesh => [mesh.positions.buffer, mesh.indices.buffer, ...(mesh.normals ? [mesh.normals.buffer] : [])]));
    } catch (error) {
        self.postMessage({ error: String(error?.message ?? error) });
    }
};
