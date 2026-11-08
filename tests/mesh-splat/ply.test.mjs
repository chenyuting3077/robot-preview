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

// The typed-array point reader must give exactly what three's PLYLoader gives.
const { PLYLoader } = await import('../../packages/mesh-splat/node_modules/three/examples/jsm/loaders/PLYLoader.js');
const { readPlyPoints } = await import('../../packages/mesh-splat/webview/ply.mjs');

function typedPly(format, properties, rows) {
    const types = { float: [4, 'setFloat32'], uchar: [1, 'setUint8'], double: [8, 'setFloat64'], int: [4, 'setInt32'] };
    const header = `ply\nformat ${format} 1.0\nelement vertex ${rows.length}\n${properties.map(([type, name]) => `property ${type} ${name}\n`).join('')}end_header\n`;
    if (format === 'ascii') return ascii(header + rows.map(row => row.join(' ')).join('\n') + '\n');
    const head = new TextEncoder().encode(header);
    const stride = properties.reduce((sum, [type]) => sum + types[type][0], 0);
    const out = new Uint8Array(head.length + rows.length * stride);
    out.set(head);
    const view = new DataView(out.buffer);
    let offset = head.length;
    for (const row of rows) {
        properties.forEach(([type], i) => {
            view[types[type][1]](offset, row[i], format === 'binary_little_endian');
            offset += types[type][0];
        });
    }
    return out;
}

const randomRows = (n, columns) => Array.from({ length: n }, () => columns.map(type => (type === 'uchar' ? Math.floor(Math.random() * 256) : type === 'int' ? Math.floor(Math.random() * 1000) : Math.fround(Math.random() * 20 - 10))));

const ATTRIBUTE_OF = { positions: 'position', normals: 'normal', uvs: 'uv', colors: 'color' };

// Every attribute PLYLoader builds, with the same values and array type, and no others.
function assertSameAsLoader(bytes) {
    const expected = new PLYLoader().parse(bytes.buffer.slice(0)).attributes;
    const points = readPlyPoints(bytes, readPlyHeader(bytes));
    assert.ok(points, 'supported');
    for (const [key, name] of Object.entries(ATTRIBUTE_OF)) {
        if (!expected[name]) {
            assert.equal(points[key], null, `no ${name}`);
            continue;
        }
        assert.deepEqual(Array.from(points[key]), Array.from(expected[name].array), name);
        assert.equal(points[key].constructor, expected[name].array.constructor, `${name} type`);
    }
}

for (const [label, format, properties] of [
    ['binary little-endian xyz', 'binary_little_endian', [['float', 'x'], ['float', 'y'], ['float', 'z']]],
    ['binary little-endian with colour and other properties', 'binary_little_endian', [['float', 'x'], ['float', 'nx'], ['float', 'y'], ['float', 'z'], ['uchar', 'red'], ['uchar', 'green'], ['uchar', 'blue'], ['int', 'intensity']]],
    ['binary big-endian with colour', 'binary_big_endian', [['float', 'x'], ['float', 'y'], ['float', 'z'], ['uchar', 'red'], ['uchar', 'green'], ['uchar', 'blue']]],
    ['double positions', 'binary_little_endian', [['double', 'x'], ['double', 'y'], ['double', 'z']]],
    ['ascii with colour', 'ascii', [['float', 'x'], ['float', 'y'], ['float', 'z'], ['uchar', 'red'], ['uchar', 'green'], ['uchar', 'blue']]],
    ['binary normals and uvs', 'binary_little_endian', [['float', 'x'], ['float', 'y'], ['float', 'z'], ['float', 'nx'], ['float', 'ny'], ['double', 'nz'], ['float', 'u'], ['float', 'v'], ['uchar', 'red'], ['uchar', 'green'], ['uchar', 'blue']]],
    ['ascii normals and uvs', 'ascii', [['float', 'x'], ['float', 'y'], ['float', 'z'], ['double', 'nx'], ['float', 'ny'], ['float', 'nz'], ['float', 's'], ['float', 't']]]
]) {
    test(`readPlyPoints matches PLYLoader: ${label}`, () => {
        assertSameAsLoader(typedPly(format, properties, randomRows(257, properties.map(([type]) => type))));
    });
}

test('readPlyPoints matches PLYLoader on an empty cloud with colour properties', () => {
    const properties = [['float', 'x'], ['float', 'y'], ['float', 'z'], ['uchar', 'red'], ['uchar', 'green'], ['uchar', 'blue']];
    assertSameAsLoader(typedPly('binary_little_endian', properties, []));
    assertSameAsLoader(typedPly('ascii', properties, []));
});

test('readPlyHeader reads the vertex count with parseInt, as PLYLoader does', () => {
    const bytes = ascii('ply\nformat ascii 1.0\nelement vertex 2e1\nproperty float x\nproperty float y\nproperty float z\nend_header\n1 2 3\n4 5 6\n');
    assert.equal(readPlyHeader(bytes).elements[0].count, 2);
    assertSameAsLoader(bytes);
});

test('a vertex count larger than the body leaves the file to PLYLoader before allocating', () => {
    const asciiBytes = ascii('ply\nformat ascii 1.0\nelement vertex 10000000000\nproperty float x\nproperty float y\nproperty float z\nend_header\n1 2 3\n');
    assert.equal(readPlyPoints(asciiBytes, readPlyHeader(asciiBytes)), null);
    const binary = typedPly('binary_little_endian', [['float', 'x'], ['float', 'y'], ['float', 'z']], [[1, 2, 3]]);
    const header = readPlyHeader(binary);
    header.elements[0].count = 1e10;
    assert.equal(readPlyPoints(binary, header), null);
});

test('a header starting with CRLF but ending in LF is measured right and left to PLYLoader', () => {
    const lf = typedPly('binary_little_endian', [['float', 'x'], ['float', 'y'], ['float', 'z']], [[1, 2, 3]]);
    const bytes = new Uint8Array(lf.length + 1);
    bytes.set(ascii('ply\r\n'));
    bytes.set(lf.subarray(4), 5);
    const header = readPlyHeader(bytes);
    assert.equal(header.headerLength, lf.length - 12 + 1);
    assert.equal(readPlyPoints(bytes, header), null);
});

test('readPlyPoints leaves unusual layouts to PLYLoader', () => {
    const floatColour = typedPly('binary_little_endian', [['float', 'x'], ['float', 'y'], ['float', 'z'], ['float', 'red'], ['float', 'green'], ['float', 'blue']], [[0, 0, 0, 0.5, 0.5, 0.5]]);
    assert.equal(readPlyPoints(floatColour, readPlyHeader(floatColour)), null);
});

test('readPlyPoints matches PLYLoader on out-of-range ASCII colours', () => {
    const bytes = ascii('ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n0 0 0 264 -3 255\n1 1 1 300 0 999\n2 2 2 x 1 2\n');
    const expected = new PLYLoader().parse(bytes.buffer.slice(0));
    assert.deepEqual(Array.from(readPlyPoints(bytes, readPlyHeader(bytes)).colors), Array.from(expected.attributes.color.array));
});

test('readPlyPoints picks colour properties by PLYLoader name priority, not file order', () => {
    const bytes = typedPly('binary_little_endian', [['float', 'x'], ['float', 'y'], ['float', 'z'], ['uchar', 'r'], ['uchar', 'g'], ['uchar', 'b'], ['uchar', 'red'], ['uchar', 'green'], ['uchar', 'blue']], randomRows(31, ['float', 'float', 'float', 'uchar', 'uchar', 'uchar', 'uchar', 'uchar', 'uchar']));
    const expected = new PLYLoader().parse(bytes.buffer.slice(0));
    assert.deepEqual(Array.from(readPlyPoints(bytes, readPlyHeader(bytes)).colors), Array.from(expected.attributes.color.array));
});

test('readPlyHeader measures the header in bytes, also with a Latin-1 comment', () => {
    const body = typedPly('binary_little_endian', [['float', 'x'], ['float', 'y'], ['float', 'z']], [[1, 2, 3], [4, 5, 6]]);
    const text = new TextDecoder().decode(body);
    const headerEnd = text.indexOf('end_header\n') + 'end_header\n'.length;
    const head = new TextEncoder().encode(text.slice(0, headerEnd).replace('format', 'comment café\nformat'));
    const latin1 = new Uint8Array(head.length - 1);
    // Re-encode the é as one Latin-1 byte, as some exporters write it.
    const at = head.findIndex((byte, i) => byte === 0xc3 && head[i + 1] === 0xa9);
    latin1.set(head.subarray(0, at));
    latin1[at] = 0xe9;
    latin1.set(head.subarray(at + 2), at + 1);
    const bytes = new Uint8Array(latin1.length + body.length - headerEnd + 8);
    bytes.set(latin1);
    bytes.set(body.subarray(headerEnd), latin1.length);
    assert.equal(readPlyHeader(bytes).headerLength, latin1.length);
    assert.deepEqual(Array.from(readPlyPoints(bytes, readPlyHeader(bytes)).positions), [1, 2, 3, 4, 5, 6]);
});

test('readPlyPoints splits ASCII on every whitespace PLYLoader splits on', () => {
    const bytes = ascii('ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nend_header\n1 2 3\n4 5\t6\n');
    const expected = new PLYLoader().parse(bytes.buffer.slice(0));
    assert.deepEqual(Array.from(readPlyPoints(bytes, readPlyHeader(bytes)).positions), Array.from(expected.attributes.position.array));
});
