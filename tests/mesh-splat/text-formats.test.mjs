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
        ',1,2,3,10,20,30\n1;2;3;\n  7 8 9 1 2 3 4  \n1\u00a02\u00a03\n'
    ];
    for (const text of cases) {
        const actual = parsePointsText(text);
        const expected = reference(text);
        // Compared as float32: that is what geometryFrom hands to the GPU either way.
        assert.deepEqual(Array.from(Float32Array.from(actual.positions)), Array.from(Float32Array.from(expected.positions)));
        assert.deepEqual(actual.colors && Array.from(Float32Array.from(actual.colors)), expected.colors && Array.from(Float32Array.from(expected.colors)));
    }
});
