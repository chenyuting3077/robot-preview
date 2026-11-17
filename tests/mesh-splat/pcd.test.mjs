import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PCDLoader } from '../../packages/mesh-splat/node_modules/three/examples/jsm/loaders/PCDLoader.js';
import { readPcdPoints, pcdReader } from '../../packages/mesh-splat/webview/pcd.mjs';
import { linearByteTable } from '../../packages/mesh-splat/webview/ply.mjs';

function binaryPcd(fields, rows, points = rows.length) {
    const head = `# .PCD v0.7\nVERSION 0.7\nFIELDS ${fields.join(' ')}\nSIZE ${fields.map(() => 4).join(' ')}\nTYPE ${fields.map(f => (f === 'rgb' ? 'U' : 'F')).join(' ')}\nCOUNT ${fields.map(() => 1).join(' ')}\nWIDTH ${points}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS ${points}\nDATA binary\n`;
    const body = new DataView(new ArrayBuffer(rows.length * fields.length * 4));
    rows.forEach((row, i) => row.forEach((v, j) => (fields[j] === 'rgb' ? body.setUint32 : body.setFloat32).call(body, (i * fields.length + j) * 4, v, true)));
    return new Uint8Array([...new TextEncoder().encode(head), ...new Uint8Array(body.buffer)]);
}

test('reads binary xyz like PCDLoader, skipping unused fields', () => {
    const bytes = binaryPcd(['x', 'y', 'z', 'intensity', 'normal_x'], [[1, 2, 3, 9, 0], [-4.5, 5, 6.25, 9, 1]]);
    const points = readPcdPoints(bytes);
    assert.deepEqual([...points.positions], [...new PCDLoader().parse(bytes.slice().buffer).geometry.attributes.position.array]);
    assert.equal(points.colors, null);
});

test('reads packed rgb as linear bytes', () => {
    const points = readPcdPoints(binaryPcd(['x', 'y', 'z', 'rgb'], [[0, 0, 0, 0xff8000]]));
    const table = linearByteTable();
    assert.deepEqual([...points.colors], [table[255], table[128], table[0]]);
});

test('leaves ascii, short bodies and double positions to PCDLoader', () => {
    assert.equal(readPcdPoints(new TextEncoder().encode('FIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nPOINTS 1\nDATA ascii\n1 2 3\n')), null);
    assert.equal(readPcdPoints(binaryPcd(['x', 'y', 'z'], [[1, 2, 3]], 1000)), null);
    assert.equal(readPcdPoints(new TextEncoder().encode('FIELDS x y z\nSIZE 8 8 8\nTYPE F F F\nCOUNT 1 1 1\nPOINTS 0\nDATA binary\n')), null);
});

test('streamed chunks of any size give the same points', () => {
    const rows = Array.from({ length: 50 }, (_, i) => [i, -i, i / 2, i * 10, 0]);
    const bytes = binaryPcd(['x', 'y', 'z', 'intensity', 'normal_x'], rows);
    const whole = readPcdPoints(bytes);
    assert.deepEqual([...whole.intensity], rows.map(r => r[3]));
    for (const size of [1, 7, 20, 333]) {
        const reader = pcdReader();
        for (let at = 0; at < bytes.length; at += size) assert.ok(reader.push(bytes.subarray(at, at + size)));
        assert.deepEqual(reader.finish(), whole);
    }
});

test('keeps exactly limit evenly spaced points past the limit', () => {
    const rows = Array.from({ length: 10 }, (_, i) => [i, 0, 0]);
    const points = readPcdPoints(binaryPcd(['x', 'y', 'z'], rows), 4);
    assert.equal(points.total, 10);
    assert.deepEqual([...points.positions].filter((_, i) => i % 3 === 0), [0, 3, 5, 8]);
});
