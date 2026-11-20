import { gunzipSync } from 'three/examples/jsm/libs/fflate.module.js';

// Enough MessagePack for NuRec's export: maps, arrays, strings, numbers and binary blobs.
export function unpack(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = new TextDecoder();
    let at = 0;
    const take = length => bytes.subarray(at, (at += length));
    const array = length => Array.from({ length }, read);
    const map = length => {
        const out = {};
        for (let i = 0; i < length; i++) out[read()] = read();
        return out;
    };
    const u8 = () => view.getUint8(at++);
    const u16 = () => view.getUint16((at += 2) - 2);
    const u32 = () => view.getUint32((at += 4) - 4);
    const string = length => text.decode(take(length));
    const handlers = new Map([
        [0xc0, () => null], [0xc2, () => false], [0xc3, () => true],
        [0xc4, () => take(u8())], [0xc5, () => take(u16())], [0xc6, () => take(u32())],
        [0xca, () => view.getFloat32((at += 4) - 4)], [0xcb, () => view.getFloat64((at += 8) - 8)],
        [0xcc, u8], [0xcd, u16], [0xce, u32], [0xcf, () => Number(view.getBigUint64((at += 8) - 8))],
        [0xd0, () => view.getInt8(at++)], [0xd1, () => view.getInt16((at += 2) - 2)], [0xd2, () => view.getInt32((at += 4) - 4)], [0xd3, () => Number(view.getBigInt64((at += 8) - 8))],
        [0xd9, () => string(u8())], [0xda, () => string(u16())], [0xdb, () => string(u32())],
        [0xdc, () => array(u16())], [0xdd, () => array(u32())],
        [0xde, () => map(u16())], [0xdf, () => map(u32())]
    ]);
    function read() {
        const byte = view.getUint8(at++);
        if (byte < 0x80) return byte;
        if (byte < 0x90) return map(byte & 0x0f);
        if (byte < 0xa0) return array(byte & 0x0f);
        if (byte < 0xc0) return string(byte & 0x1f);
        if (byte >= 0xe0) return byte - 0x100;
        const handler = handlers.get(byte);
        if (!handler) throw new Error(`NuRec: unsupported MessagePack type 0x${byte.toString(16)}`);
        return handler();
    }
    return read();
}

export const readNurec = bytes => unpack(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes);

let halfTable;
function float16s(bytes) {
    if (!halfTable) {
        halfTable = new Float32Array(65536);
        for (let h = 0; h < 65536; h++) {
            const sign = h >> 15 ? -1 : 1, exponent = (h >> 10) & 31, mantissa = h & 1023;
            halfTable[h] = exponent === 0 ? sign * mantissa * 2 ** -24 : exponent === 31 ? (mantissa ? NaN : sign * Infinity) : sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
        }
    }
    const words = new Uint16Array(bytes.slice().buffer);
    const out = new Float32Array(words.length);
    for (let i = 0; i < words.length; i++) out[i] = halfTable[words[i]];
    return out;
}

// NuRec keeps 3DGUT's raw parameters (logit density, log scale, w-first rotation, SH with RGB per coefficient),
// which is what a 3DGS PLY stores, so they are copied across with only the SH regrouped by channel.
export function nurecPly(nurec) {
    const state = nurec?.nre_data?.state_dict ?? {};
    const tensor = name => {
        const key = Object.keys(state).find(key => key.endsWith(`gaussians.${name}`));
        const bytes = state[key];
        const shape = state[`${key}.shape`];
        if (!(bytes instanceof Uint8Array) || !shape) return null;
        return { values: float16s(bytes), width: shape[1] ?? 1, count: shape[0] };
    };
    const positions = tensor('positions');
    if (!positions?.count) return null;
    const [rotations, scales, densities, albedo, specular] = ['rotations', 'scales', 'densities', 'features_albedo', 'features_specular'].map(tensor);
    const count = positions.count;
    const rest = (specular?.width ?? 0) / 3;
    const names = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', ...Array.from({ length: rest * 3 }, (_, i) => `f_rest_${i}`), 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
    const stride = names.length;
    let header = `ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${names.map(name => `property float ${name}\n`).join('')}end_header\n`;
    // Padded to a multiple of 4 so the body can be written through one Float32Array.
    header = header.replace('element', `comment ${' '.repeat((4 - ((header.length + 9) % 4)) % 4)}\nelement`);
    const head = new TextEncoder().encode(header);
    const out = new Uint8Array(head.length + count * stride * 4);
    out.set(head);
    const body = new Float32Array(out.buffer, head.length, count * stride);
    for (let i = 0; i < count; i++) {
        const row = i * stride;
        for (let c = 0; c < 3; c++) {
            body[row + c] = positions.values[i * 3 + c];
            body[row + 3 + c] = albedo?.values[i * 3 + c] ?? 0;
            for (let k = 0; k < rest; k++) body[row + 6 + c * rest + k] = specular.values[i * specular.width + k * 3 + c];
        }
        let j = row + 6 + rest * 3;
        // A tensor the export left out falls back to an opaque (logit 10), small (e^-4) Gaussian.
        body[j++] = densities?.values[i] ?? 10;
        for (let c = 0; c < 3; c++) body[j++] = scales?.values[i * 3 + c] ?? -4;
        const q = rotations ? rotations.values.subarray(i * 4, i * 4 + 4) : [1, 0, 0, 0];
        const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        for (let c = 0; c < 4; c++) body[j++] = q[c] / length;
    }
    return out;
}
