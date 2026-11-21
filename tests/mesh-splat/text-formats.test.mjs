import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePointsText, parseOff } from '../../packages/mesh-splat/webview/text-formats.mjs';

test('parsePointsText keeps the first three numbers and skips headers', () => {
    const { positions, colors } = parsePointsText('2\n1 2 3\n4,5,6\nfoo bar baz\n');
    assert.deepEqual(Array.from(positions), [1, 2, 3, 4, 5, 6]);
    assert.equal(colors, null);
});

test('parsePointsText reads RGB from x y z r g b and PTS x y z i r g b', () => {
    assert.deepEqual(Array.from(parsePointsText('0 0 0 255 0 0\n1 1 1 0 255 0').colors), [1, 0, 0, 0, 1, 0]);
    assert.deepEqual(Array.from(parsePointsText('1\n0 0 0 -500 0 0 255').colors), [0, 0, 1]);
});

test('parsePointsText ignores normals and partial colors', () => {
    assert.equal(parsePointsText('0 0 0 0.5 -0.5 0.7').colors, null);
    assert.equal(parsePointsText('0 0 0 255 0 0\n1 1 1').colors, null);
});

test('parseOff fan-triangulates polygons and ignores colors and comments', () => {
    const off = 'COFF\n# square\n4 1 0\n0 0 0 1 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3 255 0 0\n';
    assert.deepEqual(parseOff(off), { positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], indices: [0, 1, 2, 0, 2, 3] });
    assert.deepEqual(parseOff('OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n').indices, [0, 1, 2]);
});

test('parsePointsText gives what the line-splitting version gave', () => {
    const numbers = line => line.trim().split(/[\s,;]+/).map(Number);
    const isByte = value => Number.isInteger(value) && value >= 0 && value <= 255;
    const reference = text => {
        const positions = [];
        const colors = [];
        let colored = true;
        for (const line of text.split('\n')) {
            const values = numbers(line);
            if (values.length < 3 || !values.slice(0, 3).every(Number.isFinite)) continue;
            positions.push(values[0], values[1], values[2]);
            const rgb = values.slice(values.length >= 7 ? 4 : 3, values.length >= 7 ? 7 : 6);
            if (rgb.length === 3 && rgb.every(isByte)) colors.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
            else colored = false;
        }
        return { positions, colors: colored && colors.length ? colors : null };
    };
    const row = () => [Math.random() * 10 - 5, Math.random() * 10, -Math.random(), Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)];
    const cases = [
        Array.from({ length: 300 }, () => row().join(' ')).join('\n'),
        '# header\n' + Array.from({ length: 300 }, () => row().join(', ')).join('\r\n') + '\n\n',
        Array.from({ length: 300 }, () => { const r = row(); return [r[0], r[1], r[2], 0.5, r[3], r[4], r[5]].join(';'); }).join('\n'),
        Array.from({ length: 300 }, () => row().slice(0, 3).join('\t')).join('\n') + '\nbad line\n1 2\n',
        '1e-3 -2.5E+2 3\n4 5 6 300 0 0\n',
        ',1,2,3,10,20,30\n1;2;3;\n  7 8 9 1 2 3 4  \n1\u00a02\u00a03\n',
        'x y z r g b\n1 2 3 2.55e2 0 1\n+5 .5 5. 255.0 007 -0\n1e 2 3\n. 1 2\n0x1F 2 3\nInfinity 1 2\n12abc 1 2\n',
        Array.from({ length: 300 }, () => [Math.random() * 1e6, Math.random() * 1e-6, -Math.random()].map(String).join(' ')).join('\n'),
        Array.from({ length: 300 }, () => [Math.random() * 100, Math.random(), Math.random()].map(x => x.toExponential(8)).join(' ')).join('\n'),
        '1234567890123456789 2 3\n0.1234567890123456789 2 3\n'
    ];
    for (const text of cases) {
        const actual = parsePointsText(text);
        const expected = reference(text);
        // Compared as float32: that is what geometryFrom hands to the GPU either way. Far clouds have an offset
        // taken out, here as in the reference.
        const offset = actual.offset ?? [0, 0, 0];
        assert.deepEqual(Array.from(Float32Array.from(actual.positions)), Array.from(Float32Array.from(expected.positions, (v, i) => v - offset[i % 3])));
        assert.deepEqual(actual.colors && Array.from(Float32Array.from(actual.colors)), expected.colors && Array.from(Float32Array.from(expected.colors)));
    }
});

// 1 mm apart at UTM coordinates (easting 5e5, northing 4e6), where float32 steps are 3 cm and 0.25 m.
const utmRows = Array.from({ length: 5 }, (_, i) => [500000.25 + i / 1000, 4000000.5 + i / 1000, 120 + i / 1000]);

test('parsePointsText takes a UTM offset out before float32, keeping 1 mm neighbours apart and heights as stored', () => {
    const { positions, offset } = parsePointsText(utmRows.map(row => row.join(' ')).join('\n'));
    assert.deepEqual(offset, [500000, 4000000, 0]);
    for (let i = 0; i < utmRows.length; i++) {
        for (let k = 0; k < 3; k++) assert.ok(Math.abs(positions[i * 3 + k] + offset[k] - utmRows[i][k]) < 1e-5, `point ${i} axis ${k}`);
    }
});

test('parsePointsText leaves a cloud near the origin as it is, with no offset', () => {
    const { positions, offset } = parsePointsText('1 2 3\n-900.5 9000 4');
    assert.equal(offset, null);
    assert.deepEqual(Array.from(positions), [1, 2, 3, -900.5, 9000, 4]);
});

test('parsePointsText writes float32 positions, also while recentering', () => {
    assert.ok(parsePointsText('1 2 3').positions instanceof Float32Array);
    assert.ok(parsePointsText(utmRows.map(row => row.join(' ')).join('\n')).positions instanceof Float32Array);
});

test('one stray point 10 km out does not shift an indoor scan', () => {
    const rows = [...Array.from({ length: 20 }, (_, i) => [1.0001 * i, 2.0002 * i, 0.5]), [1e7, 3, 0]];
    const { positions, offset } = parsePointsText(rows.map(row => row.join(' ')).join('\n'));
    assert.equal(offset, null);
    assert.deepEqual(Array.from(positions.subarray(0, 60)), Array.from(Float32Array.from(rows.slice(0, 20).flat())));
});

test('a few points at 0 0 0 do not pull a UTM tile\'s offset away from it', () => {
    const rows = [[0, 0, 0], ...utmRows, [0, 0, 0]];
    const { positions, offset } = parsePointsText(rows.map(row => row.join(' ')).join('\n'));
    assert.deepEqual(offset, [500000, 4000000, 0]);
    for (let i = 1; i <= utmRows.length; i++) assert.ok(Math.abs(positions[i * 3] + offset[0] - rows[i][0]) < 1e-5);
});

test('an infinite coordinate leaves the offset and the other points as they are', () => {
    const { positions, offset } = parsePointsText([...utmRows, [Infinity, 4000000, 0]].map(row => row.join(' ')).join('\n'));
    assert.deepEqual(offset, [500000, 4000000, 0]);
    assert.ok(Array.from(positions.subarray(0, utmRows.length * 3)).every(Number.isFinite));
});

test('a Y-up cloud has its offset taken out of X and Z, heights staying in Y', () => {
    const rows = utmRows.map(([x, y, z]) => [x, z, y]);
    const { positions, offset } = parsePointsText(rows.map(row => row.join(' ')).join('\n'));
    assert.deepEqual(offset, [500000, 0, 4000000]);
    for (let i = 0; i < rows.length; i++) {
        for (let k = 0; k < 3; k++) assert.ok(Math.abs(positions[i * 3 + k] + offset[k] - rows[i][k]) < 1e-5, `point ${i} axis ${k}`);
    }
});

test('every axis whose median reaches 10 km has its offset taken out, heights included', () => {
    const rows = utmRows.map(([x, y]) => [x, y, 12000.25]);
    const { positions, offset } = parsePointsText(rows.map(row => row.join(' ')).join('\n'));
    assert.deepEqual(offset, [500000, 4000000, 12000]);
    assert.ok(Math.abs(positions[2] - 0.25) < 1e-6);
});

test('0 0 0 placeholder rows filling the start of the file leave the offset to the real points after them', () => {
    const rows = [...Array.from({ length: 70000 }, () => [0, 0, 0]), ...utmRows];
    const { positions, offset } = parsePointsText(rows.map(row => row.join(' ')).join('\n'));
    assert.deepEqual(offset, [500000, 4000000, 0]);
    for (let i = 70000; i < rows.length; i++) assert.ok(Math.abs(positions[i * 3] + offset[0] - rows[i][0]) < 1e-5);
});

test('a local corridor 22 km long keeps its coordinates instead of moving its origin end away', () => {
    const rows = Array.from({ length: 2201 }, (_, i) => [22000 - i * 10, 0.5, 0]);
    const { positions, offset } = parsePointsText(rows.map(row => row.join(' ')).join('\n'));
    assert.equal(offset, null);
    assert.equal(positions[2200 * 3 + 1], 0.5);
});

test('a stray point far from a UTM tile does not cancel its offset', () => {
    const rows = [...Array.from({ length: 100 }, (_, i) => [500000.25 + i / 1000, 4000000.5, 120]), [1e7, 4000000, 0]];
    assert.deepEqual(parsePointsText(rows.map(row => row.join(' ')).join('\n')).offset, [500000, 4000000, 0]);
});
