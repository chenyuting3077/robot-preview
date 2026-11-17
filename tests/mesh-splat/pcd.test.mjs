import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PCDLoader } from '../../packages/mesh-splat/node_modules/three/examples/jsm/loaders/PCDLoader.js';
import { pcdReader, dropNaNPoints } from '../../packages/mesh-splat/webview/pcd.mjs';

// The whole file as one chunk.
function readPcdPoints(bytes, limit) {
    const reader = pcdReader(limit);
    return reader.push(bytes) ? reader.finish() : null;
}
import { linearByteTable } from '../../packages/mesh-splat/webview/color.mjs';

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

test('refuses a short binary body', () => {
    assert.throws(() => readPcdPoints(binaryPcd(['x', 'y', 'z'], [[1, 2, 3]], 1000)), /ends after 1 of its 1000 points/);
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

test('with a region, keeps only its points, evenly spaced over the expected count', () => {
    const rows = Array.from({ length: 20 }, (_, i) => [i, 0, 0]).concat([[NaN, 0, 0]]);
    const read = (expected, limit) => {
        const reader = pcdReader(limit, { inside: x => x >= 10, expected });
        reader.push(binaryPcd(['x', 'y', 'z'], rows));
        return reader.finish();
    };
    const xs = points => [...points.positions].filter((_, i) => i % 3 === 0);
    assert.deepEqual(xs(read(12, 100)), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    assert.deepEqual(xs(read(10, 5)), [10, 12, 14, 16, 18]);
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

test('reads double-precision binary positions instead of handing the file to PCDLoader', () => {
    const head = 'FIELDS x y z\nSIZE 8 8 8\nTYPE F F F\nCOUNT 1 1 1\nPOINTS 2\nDATA binary\n';
    const body = new DataView(new ArrayBuffer(2 * 24));
    [[1.5, 2, 3], [4, 5, 6.25]].forEach((row, r) => row.forEach((v, k) => body.setFloat64(r * 24 + k * 8, v, true)));
    const points = readPcdPoints(new Uint8Array([...new TextEncoder().encode(head), ...new Uint8Array(body.buffer)]));
    assert.deepEqual([...points.positions], [1.5, 2, 3, 4, 5, 6.25]);
});

// LZF with literal runs only, plus one back-reference of `repeat` bytes from `back` bytes back when set,
// enough to exercise both tokens.
function lzf(bytes, repeat, back) {
    const out = [];
    for (let i = 0; i < bytes.length; i += 32) {
        const run = bytes.subarray(i, i + 32);
        out.push(run.length - 1, ...run);
    }
    if (repeat) out.push((repeat - 2) << 5, back - 1);
    return new Uint8Array(out);
}

test('ASCII and binary_compressed read like PCDLoader, in chunks of any size', () => {
    const rows = [[1, 2, 3, 0xff8000, 7], [-4.5, 5, 6.25, 0x00ff00, 8], [0.5, -1, 2, 0x0000ff, 9]];
    const fields = 'FIELDS x y z rgb intensity\nSIZE 4 4 4 4 4\nTYPE F F F U F\nCOUNT 1 1 1 1 1\n';
    const ascii = new TextEncoder().encode(`${fields}POINTS 3\nDATA ascii\n${rows.map(r => r.join(' ')).join('\n')}`);
    const columns = new DataView(new ArrayBuffer(rows.length * 20));
    rows.forEach((r, i) => r.forEach((v, f) => (f === 3 ? columns.setUint32 : columns.setFloat32).call(columns, f * rows.length * 4 + i * 4, v, true)));
    const raw = new Uint8Array(columns.buffer);
    const packed = lzf(raw);
    const sizes = new DataView(new ArrayBuffer(8));
    sizes.setUint32(0, packed.length, true);
    sizes.setUint32(4, raw.length, true);
    const compressed = new Uint8Array([...new TextEncoder().encode(`${fields}POINTS 3\nDATA binary_compressed\n`), ...new Uint8Array(sizes.buffer), ...packed]);
    for (const bytes of [ascii, compressed]) {
        const loader = new PCDLoader().parse(bytes.slice().buffer).geometry;
        const whole = readPcdPoints(bytes);
        assert.deepEqual([...whole.positions], [...loader.attributes.position.array]);
        assert.deepEqual([...whole.intensity], [7, 8, 9]);
        const table = linearByteTable();
        assert.deepEqual([...whole.colors.subarray(0, 3)], [table[255], table[128], table[0]]);
        for (const size of [1, 5, 17]) {
            const reader = pcdReader();
            for (let at = 0; at < bytes.length; at += size) reader.push(bytes.subarray(at, at + size));
            assert.deepEqual(reader.finish(), whole);
        }
    }
});

test('an LZF back-reference copies earlier output', () => {
    const fields = 'FIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\nPOINTS 1\nDATA binary_compressed\n';
    // 12 bytes: 8 literal, then 4 copied from 8 back, so z repeats x's bytes.
    const raw = new Uint8Array(new Float32Array([1.5, 2.5, 1.5]).buffer);
    const packed = lzf(raw.subarray(0, 8), 4, 8);
    const sizes = new DataView(new ArrayBuffer(8));
    sizes.setUint32(0, packed.length, true);
    sizes.setUint32(4, 12, true);
    const points = readPcdPoints(new Uint8Array([...new TextEncoder().encode(fields), ...new Uint8Array(sizes.buffer), ...packed]));
    assert.deepEqual([...points.positions], [1.5, 2.5, 1.5]);
});
