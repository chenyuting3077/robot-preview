import { linearByteTable } from './ply.mjs';

// PCDLoader pushes every field of every point into plain arrays; a 1.2 GB
// binary cloud (38.9M points, x y z intensity normal curvature) runs the
// webview out of memory. This reads binary x y z (+ rgb) straight into typed
// arrays and drops normals and intensity, which PointsMaterial never uses.
// Anything else returns null and goes to PCDLoader.
export function readPcdPoints(bytes) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
    const data = /(^|[\r\n])DATA[ \t]+(\S+)[ \t]*\r?\n/i.exec(head);
    if (data?.[2] !== 'binary') return null;
    const field = key => new RegExp(`^${key}[ \\t]+(.*)$`, 'im').exec(head.replace(/^#.*/gm, ''))?.[1].trim().split(/\s+/) ?? [];
    const fields = field('FIELDS'), sizes = field('SIZE').map(Number), types = field('TYPE');
    const counts = field('COUNT').map(Number);
    const count = parseInt(field('POINTS')[0]);
    if (!(count >= 0) || sizes.length !== fields.length || types.length !== fields.length) return null;
    const offsets = [];
    let stride = 0;
    fields.forEach((_, i) => { offsets.push(stride); stride += sizes[i] * (counts[i] ?? 1); });
    const [x, y, z] = ['x', 'y', 'z'].map(name => fields.indexOf(name));
    if ([x, y, z].some(i => i < 0 || types[i] !== 'F' || sizes[i] !== 4)) return null;
    const start = data.index + data[0].length;
    // A wrong POINTS must not make us allocate gigabytes for a short body.
    if (start + stride * count > bytes.length) return null;
    const rgb = fields.indexOf('rgb');
    const view = new DataView(bytes.buffer, bytes.byteOffset + start, stride * count);
    const positions = new Float32Array(count * 3);
    const colors = rgb >= 0 && sizes[rgb] === 4 ? new Uint8Array(count * 3) : null;
    const table = colors && linearByteTable();
    for (let i = 0, row = 0; i < count; i++, row += stride) {
        positions[i * 3] = view.getFloat32(row + offsets[x], true);
        positions[i * 3 + 1] = view.getFloat32(row + offsets[y], true);
        positions[i * 3 + 2] = view.getFloat32(row + offsets[z], true);
        if (colors) {
            colors[i * 3] = table[view.getUint8(row + offsets[rgb] + 2)];
            colors[i * 3 + 1] = table[view.getUint8(row + offsets[rgb] + 1)];
            colors[i * 3 + 2] = table[view.getUint8(row + offsets[rgb])];
        }
    }
    return { positions, colors };
}
