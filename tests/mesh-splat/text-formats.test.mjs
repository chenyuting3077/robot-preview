import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePointsText, parseOff } from '../../packages/mesh-splat/webview/text-formats.mjs';

test('parsePointsText keeps the first three numbers and skips headers', () => {
    assert.deepEqual(parsePointsText('2\n1 2 3 100 255 0 0\n4,5,6\nfoo bar baz\n'), [1, 2, 3, 4, 5, 6]);
});

test('parseOff fan-triangulates polygons and ignores colors and comments', () => {
    const off = 'COFF\n# square\n4 1 0\n0 0 0 1 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3 255 0 0\n';
    assert.deepEqual(parseOff(off), { positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], indices: [0, 1, 2, 0, 2, 3] });
    assert.deepEqual(parseOff('OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n').indices, [0, 1, 2]);
});
