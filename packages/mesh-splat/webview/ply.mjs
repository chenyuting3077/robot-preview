const TYPE_SIZE = {
    char: 1, uchar: 1, int8: 1, uint8: 1,
    short: 2, ushort: 2, int16: 2, uint16: 2,
    int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4,
    double: 8, float64: 8
};
const FLAT_SCALE = Math.log(1e-6);

export function readPlyHeader(bytes) {
    const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
    const end = head.indexOf('end_header');
    if (!head.startsWith('ply') || end < 0) return null;
    const header = { format: '', elements: [], headerLength: new TextEncoder().encode(head.slice(0, head.indexOf('\n', end) + 1)).length };
    for (const line of head.slice(0, end).split(/\r?\n/)) {
        const [keyword, ...rest] = line.trim().split(/\s+/);
        if (keyword === 'format') header.format = rest[0];
        if (keyword === 'element') header.elements.push({ name: rest[0], count: Number(rest[1]), properties: [] });
        if (keyword === 'property') {
            header.elements.at(-1)?.properties.push(rest[0] === 'list'
                ? { name: rest[3], type: rest[2], list: true }
                : { name: rest[1], type: rest[0] });
        }
    }
    return header;
}

export function plyKind(header) {
    const vertex = header.elements.find(element => element.name === 'vertex');
    const names = new Set(vertex?.properties.map(property => property.name));
    if (names.has('f_dc_0') || (names.has('scale_0') && names.has('opacity'))) return 'splat';
    return header.elements.some(element => element.name === 'face' && element.count > 0) ? 'mesh' : 'points';
}

export function addMissingScale(bytes, header) {
    const vertex = header.elements[0];
    const names = vertex?.properties.map(property => property.name) ?? [];
    if (vertex?.name !== 'vertex' || !names.includes('scale_1') || names.includes('scale_2')) return bytes;
    if (header.format !== 'binary_little_endian' || vertex.properties.some(property => property.list)) return bytes;
    const sizes = vertex.properties.map(property => TYPE_SIZE[property.type]);
    const at = names.indexOf('scale_1');
    const before = sizes.slice(0, at + 1).reduce((sum, size) => sum + size, 0);
    const stride = sizes.reduce((sum, size) => sum + size, 0);
    const oldHeader = new TextDecoder().decode(bytes.subarray(0, header.headerLength));
    const newHeader = new TextEncoder().encode(oldHeader.replace(/(property \S+ scale_1\r?\n)/, '$1property float scale_2\n'));
    const body = vertex.count * stride;
    const out = new Uint8Array(newHeader.length + vertex.count * (stride + 4) + bytes.length - header.headerLength - body);
    out.set(newHeader);
    const view = new DataView(out.buffer);
    let src = header.headerLength;
    let dst = newHeader.length;
    for (let i = 0; i < vertex.count; i++, src += stride, dst += stride + 4) {
        out.set(bytes.subarray(src, src + before), dst);
        view.setFloat32(dst + before, FLAT_SCALE, true);
        out.set(bytes.subarray(src + before, src + stride), dst + before + 4);
    }
    out.set(bytes.subarray(src), dst);
    return out;
}
