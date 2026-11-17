// The STEP cache file: a JSON header, then per mesh meshopt-encoded positions (exponential filter, 15-bit
// mantissa), octahedral 8-bit normals and indices. A 3.96M-vertex, 3.67M-triangle assembly: 132.6 MB of
// arrays -> 24.2 MB, 2.3 s to encode, 0.2 s to decode, positions within 0.016 of a 333-unit model (Node 22).
// The index codec may rotate a triangle's corners, which keeps its winding.
const FORMAT = 'robot-preview-step-cache-2';

// meshes: [{ name, positions: Float32Array, normals: Float32Array, indices: Uint32Array, groups: [[start, count, srgb]] }]
export function encodeStepCache(encoder, meshes) {
    const parts = [];
    let size = 0;
    const add = bytes => {
        parts.push(bytes);
        size += bytes.length;
        return [size - bytes.length, bytes.length];
    };
    const header = meshes.map(({ name, positions, normals, indices, groups }) => {
        const count = positions.length / 3;
        // The octahedral filter reads 4 floats per normal.
        const padded = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) padded.set(normals.subarray(i * 3, i * 3 + 3), i * 4);
        return {
            name, vertices: count, indices: indices.length, groups,
            position: add(encoder.encodeVertexBuffer(encoder.encodeFilterExp(positions, count, 12, 15), count, 12)),
            normal: add(encoder.encodeVertexBuffer(encoder.encodeFilterOct(padded, count, 4, 8), count, 4)),
            index: add(encoder.encodeIndexBuffer(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength), indices.length, 4))
        };
    });
    const json = new TextEncoder().encode(JSON.stringify({ format: FORMAT, meshes: header }));
    const out = new Uint8Array(4 + json.length + size);
    new DataView(out.buffer).setUint32(0, json.length, true);
    out.set(json, 4);
    let at = 4 + json.length;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}

// Normals come back as 4 normalized Int8 per vertex; the 4th byte is padding.
export function decodeStepCache(decoder, bytes) {
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
    const { format, meshes } = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length)));
    if (format !== FORMAT) throw new Error('not a STEP cache');
    const body = bytes.subarray(4 + length);
    const part = ([at, size]) => body.subarray(at, at + size);
    return meshes.map(({ name, vertices, indices, groups, position, normal, index }) => {
        const positions = new Float32Array(vertices * 3);
        const normals = new Int8Array(vertices * 4);
        const out = new Uint32Array(indices);
        decoder.decodeVertexBuffer(new Uint8Array(positions.buffer), vertices, 12, part(position), 'EXPONENTIAL');
        decoder.decodeVertexBuffer(new Uint8Array(normals.buffer), vertices, 4, part(normal), 'OCTAHEDRAL');
        decoder.decodeIndexBuffer(new Uint8Array(out.buffer), indices, 4, part(index));
        return { name, positions, normals, indices: out, groups };
    });
}
