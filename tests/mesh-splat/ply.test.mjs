import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlyHeader, plyKind, addMissingScale } from '../../packages/mesh-splat/webview/ply.mjs';

function binaryPly(properties, rows, extra = '') {
    const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${rows.length}\n${properties.map(name => `property float ${name}\n`).join('')}${extra}end_header\n`;
    const head = new TextEncoder().encode(header);
    const out = new Uint8Array(head.length + rows.length * properties.length * 4);
    out.set(head);
    const view = new DataView(out.buffer);
    rows.flat().forEach((value, i) => view.setFloat32(head.length + i * 4, value, true));
    return out;
}

const ascii = text => new TextEncoder().encode(text);

test('plyKind tells splats, meshes and point clouds apart', () => {
    assert.equal(plyKind(readPlyHeader(binaryPly(['x', 'y', 'z', 'f_dc_0'], [[0, 0, 0, 1]]))), 'splat');
    assert.equal(plyKind(readPlyHeader(ascii('ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n'))), 'mesh');
    assert.equal(plyKind(readPlyHeader(ascii('ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty uchar red\nend_header\n'))), 'points');
    assert.equal(readPlyHeader(ascii('solid stl')), null);
});

test('addMissingScale inserts a flat scale_2 after scale_1 for 2DGS', () => {
    const props = ['x', 'y', 'z', 'f_dc_0', 'opacity', 'scale_0', 'scale_1', 'rot_0'];
    const input = binaryPly(props, [[1, 2, 3, 4, 5, 6, 7, 8], [11, 12, 13, 14, 15, 16, 17, 18]]);
    const output = addMissingScale(input, readPlyHeader(input));
    const header = readPlyHeader(output);
    assert.deepEqual(header.elements[0].properties.map(p => p.name), [...props.slice(0, 7), 'scale_2', 'rot_0']);
    const view = new DataView(output.buffer, header.headerLength);
    const row = i => Array.from({ length: 9 }, (_, j) => view.getFloat32((i * 9 + j) * 4, true));
    assert.deepEqual(row(0).filter((_, j) => j !== 7), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(row(1).filter((_, j) => j !== 7), [11, 12, 13, 14, 15, 16, 17, 18]);
    assert.ok(Math.abs(row(1)[7] - Math.log(1e-6)) < 1e-4);
    assert.equal(output.length, input.length + 8 + 'property float scale_2\n'.length);
});

test('addMissingScale leaves 3DGS files untouched', () => {
    const input = binaryPly(['x', 'scale_0', 'scale_1', 'scale_2'], [[1, 2, 3, 4]]);
    assert.equal(addMissingScale(input, readPlyHeader(input)), input);
});

test('addMissingScale returns null for 2DGS files it cannot flatten', () => {
    const ascii = new TextEncoder().encode('ply\nformat ascii 1.0\nelement vertex 1\nproperty float scale_0\nproperty float scale_1\nend_header\n1 2\n');
    assert.equal(addMissingScale(ascii, readPlyHeader(ascii)), null);
    const vertexSecond = binaryPly(['scale_0', 'scale_1'], [[1, 2]]);
    const header = readPlyHeader(vertexSecond);
    header.elements.unshift({ name: 'camera', count: 0, properties: [] });
    assert.equal(addMissingScale(vertexSecond, header), null);
    const oddType = new TextEncoder().encode('ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty half scale_0\nproperty float scale_1\nend_header\n');
    assert.equal(addMissingScale(oddType, readPlyHeader(oddType)), null);
});
