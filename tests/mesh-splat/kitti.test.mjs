import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binReader, binLayout } from '../../packages/mesh-splat/webview/kitti.mjs';

// Headerless little-endian float32 records, one row of values per point.
function scan(rows) {
    const view = new DataView(new ArrayBuffer(rows.length * rows[0].length * 4));
    rows.flat().forEach((value, i) => view.setFloat32(i * 4, value, true));
    return new Uint8Array(view.buffer);
}

function read(bytes, fileName = '000000.bin', limit, options) {
    const reader = binReader(bytes.length, binLayout(fileName), limit, options);
    reader.push(bytes);
    return reader.finish();
}

test('a KITTI scan gives the positions and intensities written into it', () => {
    const points = read(scan([[1, 2, 3, 0.25], [-4.5, 5, 6.25, 0.75]]));
    assert.equal(points.total, 2);
    assert.deepEqual([...points.positions], [1, 2, 3, -4.5, 5, 6.25]);
    assert.equal(points.colors, null);
    assert.deepEqual(Object.keys(points.scalars), ['intensity']);
    assert.deepEqual([...points.scalars.intensity], [0.25, 0.75]);
});

test('fed in chunks of any size, a scan gives the same points', () => {
    const bytes = scan(Array.from({ length: 50 }, (_, i) => [i, -i, i / 2, i / 50]));
    const whole = read(bytes);
    for (let size = 1; size <= 70; size++) {
        const reader = binReader(bytes.length, binLayout('000000.bin'));
        for (let at = 0; at < bytes.length; at += size) assert.ok(reader.push(bytes.subarray(at, at + size)));
        assert.deepEqual(reader.finish(), whole, `chunks of ${size} bytes`);
    }
});

test('NaN and infinite points are dropped and left out of the total', () => {
    const points = read(scan([[1, 2, 3, 0.5], [NaN, 0, 0, 0.1], [0, Infinity, 0, 0.2], [0, 0, -Infinity, 0.3], [4, 5, 6, 0.9]]));
    assert.equal(points.total, 2);
    assert.deepEqual([...points.positions], [1, 2, 3, 4, 5, 6]);
    assert.deepEqual([...points.scalars.intensity], [0.5, 0.8999999761581421]);
});

test('a nuScenes .pcd.bin scan reads five floats a point, with ring as a second field', () => {
    const bytes = scan([[1, 2, 3, 40, 0], [4, 5, 6, 80, 31]]);
    const points = read(bytes, 'n008__LIDAR_TOP__1533151603547590.pcd.bin');
    assert.equal(points.total, 2);
    assert.deepEqual([...points.positions], [1, 2, 3, 4, 5, 6]);
    assert.deepEqual([...points.scalars.intensity], [40, 80]);
    assert.deepEqual([...points.scalars.ring], [0, 31]);
});

test('the layout is chosen by file name', () => {
    assert.equal(binLayout('scan.PCD.BIN').name, 'nuScenes x y z intensity ring');
    for (const name of ['000000.bin', 'velodyne.points.bin', 'pcd.bin']) assert.equal(binLayout(name).name, 'KITTI x y z intensity');
});

test('a size that is not a whole number of records is refused before any byte is read', () => {
    assert.throws(() => binReader(33, binLayout('000000.bin')), {
        name: 'NotAScan', bytes: 33, stride: 16, format: 'KITTI',
        message: 'the file is 33 bytes, not a multiple of the 16-byte KITTI point (x y z intensity): it does not look like a KITTI scan'
    });
    assert.throws(() => binReader(48, binLayout('scan.pcd.bin')), { name: 'NotAScan', stride: 20, message: /48 bytes, not a multiple of the 20-byte nuScenes point .*not look like a nuScenes scan/ });
    assert.doesNotThrow(() => binReader(0, binLayout('000000.bin')));
});

const xs = points => [...points.positions].filter((_, i) => i % 3 === 0);

test('a limit below the count keeps that many evenly spaced points of the whole total', () => {
    const points = read(scan(Array.from({ length: 10 }, (_, i) => [i, 0, 0, i])), '000000.bin', 4);
    assert.equal(points.total, 10);
    assert.deepEqual(xs(points), [0, 3, 5, 8]);
    assert.deepEqual([...points.scalars.intensity], [0, 3, 5, 8]);
});

test('with a region, keeps only the points in it', () => {
    const points = read(scan(Array.from({ length: 20 }, (_, i) => [i, 0, 0, i])), '000000.bin', 5, { inside: x => x >= 10, expected: 10 });
    assert.deepEqual(xs(points), [10, 12, 14, 16, 18]);
});

test('a scan at UTM coordinates is stored less a kilometre offset, as PCD is, and detail reads take the sample\'s', () => {
    // float32 in the file already: 500000.5 and 4000000.5 are exact, the offset keeps the GPU's step small.
    const rows = Array.from({ length: 100 }, (_, i) => [500000.5 + i, 4000000.5 + i, 12.25, i / 100]);
    const points = read(scan(rows));
    assert.deepEqual(points.offset, [500000, 4000000, 0]);
    assert.deepEqual([...points.positions.subarray(0, 6)], [0.5, 0.5, 12.25, 1.5, 1.5, 12.25]);
    // A detail read with the sample's offset: `inside` sees stored coordinates.
    const seen = [];
    const detail = read(scan(rows), '000000.bin', Infinity, { inside: (x, y, z) => (seen.push([x, y, z]), x < 2), expected: 2, offset: points.offset });
    assert.deepEqual(seen[0], [0.5, 0.5, 12.25]);
    assert.deepEqual([...detail.positions], [0.5, 0.5, 12.25, 1.5, 1.5, 12.25]);
    assert.deepEqual(detail.offset, points.offset);
});
