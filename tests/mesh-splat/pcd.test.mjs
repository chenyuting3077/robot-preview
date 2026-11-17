import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PCDLoader } from '../../packages/mesh-splat/node_modules/three/examples/jsm/loaders/PCDLoader.js';
import { pcdReader, dropNaNPoints } from '../../packages/mesh-splat/webview/pcd.mjs';

// The whole file as one chunk.
function readPcdPoints(bytes, limit) {
    const reader = pcdReader(limit);
    return reader.push(bytes) ? reader.finish() : null;
}
import { linearByteTable } from '../../packages/mesh-splat/webview/geometry.mjs';

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

test('leaves ascii and double positions to PCDLoader and refuses a short binary body', () => {
    assert.equal(readPcdPoints(new TextEncoder().encode('FIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nPOINTS 1\nDATA ascii\n1 2 3\n')), null);
    assert.throws(() => readPcdPoints(binaryPcd(['x', 'y', 'z'], [[1, 2, 3]], 1000)), /ends after 1 of its 1000 points/);
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

test('reads integer intensity', () => {
    const head = 'FIELDS x y z intensity\nSIZE 4 4 4 2\nTYPE F F F U\nCOUNT 1 1 1 1\nPOINTS 2\nDATA binary\n';
    const body = new DataView(new ArrayBuffer(2 * 14));
    [[1, 2, 3, 500], [4, 5, 6, 65535]].forEach(([x, y, z, i], row) => {
        [x, y, z].forEach((v, k) => body.setFloat32(row * 14 + k * 4, v, true));
        body.setUint16(row * 14 + 12, i, true);
    });
    const points = readPcdPoints(new Uint8Array([...new TextEncoder().encode(head), ...new Uint8Array(body.buffer)]));
    assert.deepEqual([...points.intensity], [500, 65535]);
});

test('drops NaN points and leaves them out of the total', () => {
    const points = readPcdPoints(binaryPcd(['x', 'y', 'z'], [[1, 2, 3], [NaN, NaN, NaN], [4, 5, 6]]));
    assert.deepEqual([...points.positions], [1, 2, 3, 4, 5, 6]);
    assert.equal(points.total, 2);
});

test('a NaN row gives its sample slot to the next finite row', () => {
    const rows = Array.from({ length: 10 }, (_, i) => (i === 3 ? [NaN, 0, 0] : i === 5 ? [0, NaN, 0] : [i, 0, 0]));
    const points = readPcdPoints(binaryPcd(['x', 'y', 'z'], rows), 4);
    // Rows 0, 3, 5, 8 are sampled; 3 and 5 are NaN, so 4 and 6 stand in for them.
    assert.deepEqual([...points.positions].filter((_, i) => i % 3 === 0), [0, 4, 6, 8]);
    assert.equal(points.total, 8);
});

test('dropNaNPoints removes the rows that are not points from every attribute', () => {
    const attributes = { position: { array: new Float32Array([1, 2, 3, NaN, NaN, NaN, 4, 5, 6]), itemSize: 3 }, intensity: { array: new Float32Array([7, 8, 9]), itemSize: 1 } };
    const kept = dropNaNPoints(attributes);
    assert.deepEqual([...kept.position], [1, 2, 3, 4, 5, 6]);
    assert.deepEqual([...kept.intensity], [7, 9]);
    assert.equal(dropNaNPoints({ position: { array: new Float32Array([1, 2, 3]), itemSize: 3 } }), null);
});
