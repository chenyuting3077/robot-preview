import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePointsText, parseOff } from '../../packages/mesh-splat/webview/text-formats.mjs';

test('parsePointsText keeps the first three numbers and skips headers', () => {
    assert.deepEqual(parsePointsText('2\n1 2 3\n4,5,6\nfoo bar baz\n'), { positions: [1, 2, 3, 4, 5, 6], colors: null });
});

test('parsePointsText reads RGB from x y z r g b and PTS x y z i r g b', () => {
    assert.deepEqual(parsePointsText('0 0 0 255 0 0\n1 1 1 0 255 0').colors, [1, 0, 0, 0, 1, 0]);
    assert.deepEqual(parsePointsText('1\n0 0 0 -500 0 0 255').colors, [0, 0, 1]);
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
