import initFoxtrot, { step_to_mesh } from '../vendor/foxtrot/foxtrot.js';
import occtimportjs from '../vendor/occt/occt-import-js.js';

// One job per worker: a Rust panic aborts the foxtrot instance, so the caller starts a fresh worker each time.
self.onmessage = async ({ data: { engine, bytes, wasm } }) => {
    try {
        if (engine === 'foxtrot') {
            await initFoxtrot({ module_or_path: wasm });
            const mesh = step_to_mesh(bytes);
            const out = { positions: mesh.take_positions(), normals: mesh.take_normals(), colors: mesh.take_colors(), indices: mesh.take_indices(), failed: mesh.failed };
            self.postMessage(out, [out.positions.buffer, out.normals.buffer, out.colors.buffer, out.indices.buffer]);
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
