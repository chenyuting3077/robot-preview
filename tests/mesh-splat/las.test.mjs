import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lasReader } from '../../packages/mesh-splat/webview/las.mjs';
import { linearByteTable } from '../../packages/mesh-splat/webview/color.mjs';
import { expected, fixture, matchesLaspy } from './las-fixtures.mjs';

const SIZES = [20, 28, 26, 34, 57, 63, 30, 36, 38, 59, 67];
const GPS = [-1, 20, -1, 20, 20, 20, 22, 22, 22, 22, 22];
const RGB = [-1, -1, 20, 28, -1, 28, -1, 30, 30, -1, 30];

// A LAS file: `points` hold raw X Y Z integers and the fields a user can color by.
function las({ format = 0, version = '1.2', points, scale = [0.001, 0.001, 0.001], offset = [0, 0, 0], extra = 0, count = points.length, bounds, vlrs = [] }) {
    const minor = Number(version.split('.')[1]);
    const headerSize = { 2: 227, 3: 235, 4: 375 }[minor];
    const vlrBytes = vlrs.reduce((sum, { data }) => sum + 54 + data.length, 0);
    const stride = SIZES[format] + extra;
    const bytes = new Uint8Array(headerSize + vlrBytes + points.length * stride);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode('LASF'));
    bytes[24] = 1;
    bytes[25] = minor;
    view.setUint16(94, headerSize, true);
    view.setUint32(96, headerSize + vlrBytes, true);
    view.setUint32(100, vlrs.length, true);
    bytes[104] = format;
    view.setUint16(105, stride, true);
    view.setUint32(107, minor === 4 && count > 2 ** 32 - 1 ? 0 : count, true);
    scale.forEach((s, i) => view.setFloat64(131 + i * 8, s, true));
    offset.forEach((o, i) => view.setFloat64(155 + i * 8, o, true));
    const real = (axis, raw) => raw * scale[axis] + offset[axis];
    const [min, max] = bounds ?? [0, 1].map(end => [0, 1, 2].map(axis => (end ? Math.max : Math.min)(...points.map(p => real(axis, p.xyz[axis])))));
    [0, 1, 2].forEach(axis => {
        view.setFloat64(179 + axis * 16, max[axis], true);
        view.setFloat64(187 + axis * 16, min[axis], true);
    });
    if (minor === 4) {
        view.setUint32(247, count % 2 ** 32, true);
        view.setUint32(251, Math.floor(count / 2 ** 32), true);
    }
    let at = headerSize;
    for (const { user = 'LASF_Projection', id, data } of vlrs) {
        bytes.set(new TextEncoder().encode(user), at + 2);
        view.setUint16(at + 18, id, true);
        view.setUint16(at + 20, data.length, true);
        bytes.set(data, at + 54);
        at += 54 + data.length;
    }
    const wide = format >= 6;
    for (const { xyz, intensity = 0, returnNumber = 1, classification = 0, source = 0, gps = 0, rgb = [0, 0, 0] } of points) {
        xyz.forEach((v, i) => view.setInt32(at + i * 4, v, true));
        view.setUint16(at + 12, intensity, true);
        bytes[at + 14] = returnNumber | (1 << (wide ? 4 : 3));
        // A set synthetic flag (bit 5) must not reach a format 0-5 class.
        if (wide) bytes[at + 16] = classification;
        else bytes[at + 15] = classification | 32;
        view.setUint16(at + (wide ? 20 : 18), source, true);
        if (GPS[format] >= 0) view.setFloat64(at + GPS[format], gps, true);
        if (RGB[format] >= 0) rgb.forEach((v, i) => view.setUint16(at + RGB[format] + i * 2, v, true));
        at += stride;
    }
    return bytes;
}

function read(bytes, limit, options) {
    const reader = lasReader(limit, options);
    reader.push(bytes);
    return reader.finish();
}

const rows = (count, at = i => [i * 1000, -i * 500, i * 250]) => Array.from({ length: count }, (_, i) => ({
    xyz: at(i), intensity: 100 * i, returnNumber: 1 + (i % 3), classification: 2 + (i % 4), source: 7 + (i % 2), gps: 1000 + i, rgb: [i * 4000, 65535 - i * 4000, 30000]
}));
const plain = array => array && [...array];

test('point formats 0, 1, 2, 3, 6, 7 and 8 give the positions, colors and fields written', () => {
    const table = linearByteTable();
    for (const format of [0, 1, 2, 3, 6, 7, 8]) {
        const points = read(las({ format, version: format >= 6 ? '1.4' : '1.2', points: rows(4) }));
        assert.equal(points.total, 4, `format ${format}`);
        assert.equal(points.offset, null, `format ${format}`);
        assert.deepEqual(plain(points.positions), [0, 0, 0, 1, -0.5, 0.25, 2, -1, 0.5, 3, -1.5, 0.75], `format ${format}`);
        assert.deepEqual(plain(points.scalars.intensity), [0, 100, 200, 300], `format ${format}`);
        assert.deepEqual(plain(points.scalars.classification), [2, 3, 4, 5], `format ${format}`);
        assert.deepEqual(plain(points.scalars.return_number), [1, 2, 3, 1], `format ${format}`);
        assert.deepEqual(plain(points.scalars.point_source_id), [7, 8, 7, 8], `format ${format}`);
        assert.deepEqual(plain(points.scalars.gps_time), GPS[format] >= 0 ? [0, 1, 2, 3] : undefined, `format ${format}`);
        const rgb = rows(4).flatMap(({ rgb }) => rgb.map(v => table[v >> 8]));
        assert.deepEqual(plain(points.colors), RGB[format] >= 0 ? rgb : null, `format ${format}`);
        assert.deepEqual(points.las, { version: format >= 6 ? '1.4' : '1.2', format, crs: null });
    }
});

test('formats 6-10 read the 8-bit class and 4-bit return number', () => {
    const points = read(las({ format: 6, version: '1.4', points: [{ xyz: [0, 0, 0], classification: 200, returnNumber: 12 }, { xyz: [1, 1, 1], classification: 31, returnNumber: 9 }] }));
    assert.deepEqual(plain(points.scalars.classification), [200, 31]);
    assert.deepEqual(plain(points.scalars.return_number), [12, 9]);
});

test('waveform formats 4, 5, 9 and 10 open, their wave packets skipped', () => {
    for (const format of [4, 5, 9, 10]) {
        const points = read(las({ format, version: format >= 6 ? '1.4' : '1.3', points: rows(3) }));
        assert.deepEqual(plain(points.positions), [0, 0, 0, 1, -0.5, 0.25, 2, -1, 0.5], `format ${format}`);
        assert.deepEqual(plain(points.scalars.classification), [2, 3, 4], `format ${format}`);
    }
});

test('LAS 1.4 reads its 64-bit point count when the legacy one is 0', () => {
    const bytes = las({ format: 1, version: '1.4', points: rows(3) });
    new DataView(bytes.buffer).setUint32(107, 0, true);
    assert.equal(read(bytes).total, 3);
});

test('records longer than the format (extra bytes) and VLRs before the points are skipped', () => {
    const vlrs = [{ user: 'LASF_Spec', id: 4, data: new Uint8Array(192).fill(7) }];
    const points = read(las({ format: 3, points: rows(3), extra: 6, vlrs }));
    assert.deepEqual(plain(points.positions), [0, 0, 0, 1, -0.5, 0.25, 2, -1, 0.5]);
    assert.deepEqual(plain(points.scalars.intensity), [0, 100, 200]);
});

test('fed in chunks of any size, a file gives the same points', () => {
    const bytes = las({ format: 7, version: '1.4', points: rows(9), extra: 3, vlrs: [{ id: 2112, data: new TextEncoder().encode('PROJCS["x"]') }] });
    const whole = read(bytes);
    for (let size = 1; size <= 90; size++) {
        const reader = lasReader();
        for (let at = 0; at < bytes.length; at += size) assert.ok(reader.push(bytes.subarray(at, at + size)));
        assert.deepEqual(reader.finish(), whole, `chunks of ${size} bytes`);
    }
});

test('a UTM tile at mm scale keeps neighbouring points 1 mm apart: X and Y lose the middle of the bounds, Z stays', () => {
    const points = read(las({
        format: 1, offset: [500000, 4000000, 0],
        points: Array.from({ length: 1001 }, (_, i) => ({ xyz: [987654 + i, 456789 + i, 1234567 + i] }))
    }));
    // Bounds 500987.654..500988.654 and 4000456.789..4000457.789: their middles, already on the mm grid.
    assert.deepEqual(points.offset, [500988.154, 4000457.289, 0]);
    const [x, y, z] = [0, 1, 2].map(axis => [...points.positions].filter((_, i) => i % 3 === axis));
    for (let i = 1; i < x.length; i++) {
        assert.ok(Math.abs(x[i] - x[i - 1] - 0.001) < 1e-6 && Math.abs(y[i] - y[i - 1] - 0.001) < 1e-6, `point ${i}: ${x[i] - x[i - 1]}, ${y[i] - y[i - 1]}`);
        assert.ok(Math.abs(z[i] - z[i - 1] - 0.001) < 2e-4, `z ${i}`);
    }
    assert.ok(Math.abs(x[0] + 0.5) < 1e-6 && Math.abs(y[1000] - 0.5) < 1e-6);
    assert.ok(Math.abs(z[0] - 1234.567) < 1e-4);
});

test('a middle of the bounds off the scale grid is rounded to it', () => {
    const points = read(las({ format: 0, scale: [0.01, 0.01, 0.01], offset: [300000.005, 0, 0], bounds: [[300000.001, 0, 0], [300000.071, 0, 0]], points: [{ xyz: [0, 0, 0] }, { xyz: [3, 0, 0] }] }));
    assert.ok(Math.abs(points.offset[0] - 300000.035) < 1e-9, points.offset[0]);
    assert.deepEqual(plain(points.positions).map(v => Math.round(v * 1e6) / 1e6), [-0.03, 0, 0, 0, 0, 0]);
});

test('a header without bounds takes the offset from the first point', () => {
    const points = read(las({ format: 0, offset: [500000, 4000000, 0], bounds: [[0, 0, 0], [0, 0, 0]], points: [{ xyz: [1000, 2000, 0] }, { xyz: [1001, 2001, 0] }] }));
    assert.deepEqual(points.offset, [500001, 4000002, 0]);
    assert.deepEqual(plain(points.positions).map(v => Math.round(v * 1e6) / 1e6), [0, 0, 0, 0.001, 0.001, 0]);
});

test('GPS time over a typical absolute range comes out relative to the earliest, one value per point', () => {
    const times = [1.3e9 + 12.5, 1.3e9 + 0.25, 1.3e9 + 0.5, 1.3e9 + 600.000125];
    const points = read(las({ format: 6, version: '1.4', points: times.map((gps, i) => ({ xyz: [i, 0, 0], gps })) }));
    assert.deepEqual(plain(points.scalars.gps_time), [12.25, 0, 0.25, Math.fround(599.750125)]);
});

test('a detail read times its GPS from the same earliest point as the sample', () => {
    const bytes = las({ format: 1, points: [5, 1, 9, 3].map((t, i) => ({ xyz: [i * 1000, 0, 0], gps: 2e8 + t })) });
    const detail = read(bytes, Infinity, { inside: x => x >= 2, expected: 2, offset: [0, 0, 0] });
    assert.deepEqual(plain(detail.scalars.gps_time), [8, 2]);
});

test('fields that hold one value for every point are left out', () => {
    const points = read(las({ format: 1, points: [{ xyz: [0, 0, 0], intensity: 9, gps: 5 }, { xyz: [1, 0, 0], intensity: 9, gps: 6 }] }));
    assert.deepEqual(Object.keys(points.scalars), ['gps_time']);
});

test('16-bit colors are scaled to 8 bits, and 8-bit values written in 16-bit slots are taken as they are', () => {
    const table = linearByteTable();
    const wide = read(las({ format: 2, points: [{ xyz: [0, 0, 0], rgb: [65535, 32768, 0] }] }));
    assert.deepEqual(plain(wide.colors), [table[255], table[128], table[0]]);
    const narrow = read(las({ format: 2, points: [{ xyz: [0, 0, 0], rgb: [255, 128, 0] }, { xyz: [1, 0, 0], rgb: [10, 20, 30] }] }));
    assert.deepEqual(plain(narrow.colors), [255, 128, 0, 10, 20, 30].map(v => table[v]));
});

test('a limit keeps evenly spaced points of the whole total, and a region only its own, less the given offset', () => {
    const bytes = las({ format: 0, offset: [500000, 4000000, 0], points: Array.from({ length: 10 }, (_, i) => ({ xyz: [i * 1000, 0, 0], intensity: i })) });
    const sample = read(bytes, 4);
    assert.equal(sample.total, 10);
    assert.deepEqual(plain(sample.scalars.intensity), [0, 3, 5, 8]);
    assert.deepEqual(sample.offset, [500004.5, 4000000, 0]);
    const seen = [];
    const detail = read(bytes, Infinity, { inside: (x, y, z) => (seen.push(x), x > 3), expected: 2, offset: sample.offset });
    assert.equal(seen[0], -4.5);
    assert.deepEqual(plain(detail.positions), [3.5, 0, 0, 4.5, 0, 0]);
    assert.deepEqual(plain(detail.scalars.intensity), [8, 9]);
});

test('a truncated body, a broken header and another file are refused with what is wrong', () => {
    const bytes = las({ format: 1, points: rows(5) });
    assert.throws(() => read(bytes.subarray(0, bytes.length - 3)), /the LAS ends after 4 of its 5 points/);
    assert.throws(() => read(bytes.subarray(0, 100)), /the LAS header is cut short at 100 bytes/);
    assert.throws(() => read(new TextEncoder().encode('ply\nformat ascii 1.0\n')), /not a LAS file: it does not start with LASF/);
    const broken = bytes.slice();
    new DataView(broken.buffer).setUint32(96, 100, true);
    assert.throws(() => read(broken), /the LAS header is broken/);
    const format = bytes.slice();
    format[104] = 11;
    assert.throws(() => read(format), /LAS point format 11 is not one of 0-10/);
    const short = bytes.slice();
    new DataView(short.buffer).setUint16(105, 20, true);
    assert.throws(() => read(short), /records are 20 bytes, shorter than point format 1's 28/);
    const compressed = bytes.slice();
    compressed[104] |= 0x80;
    assert.throws(() => read(compressed), /LAZ-compressed: open it as a \.laz file/);
});

test('the coordinate system is named from the WKT VLR or the GeoTIFF keys', () => {
    const wkt = new TextEncoder().encode('PROJCS["WGS 84 / UTM zone 32N",GEOGCS["WGS 84"]]\0');
    assert.equal(read(las({ format: 6, version: '1.4', points: rows(2), vlrs: [{ id: 2112, data: wkt }] })).las.crs, 'WGS 84 / UTM zone 32N');
    const keys = new Uint8Array(new Uint16Array([1, 1, 0, 2, 3072, 0, 1, 32632, 3073, 34737, 10, 0]).buffer);
    const ascii = new TextEncoder().encode('UTM 32N|\0');
    assert.equal(read(las({ format: 0, points: rows(2), vlrs: [{ id: 34735, data: keys }, { id: 34737, data: ascii }] })).las.crs, 'UTM 32N (EPSG:32632)');
    assert.equal(read(las({ format: 0, points: rows(2), vlrs: [{ id: 34735, data: keys }] })).las.crs, 'EPSG:32632');
});

test('every point format, LAS 1.2 to 1.4, reads as laspy reads it', () => {
    for (const [name, want] of Object.entries(expected)) matchesLaspy(read(fixture(name)), want, name);
});

test('the coordinate system laspy wrote is named', () => {
    assert.equal(read(fixture('f7-wkt.las')).las.crs, 'NAD83 / UTM zone 15N');
    assert.equal(read(fixture('f3-geotiff.las')).las.crs, 'NAD83 / UTM zone 15N (EPSG:26915)');
});
