import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../packages/mesh-splat/node_modules/three/build/three.module.js';
import { UP, relativeUp } from '../../packages/mesh-splat/webview/up.mjs';
import { filePoint, measurement, decimalsFor, formatLength, formatPoint } from '../../packages/mesh-splat/webview/measure.mjs';

// A file's turn in the view, as main.js reads it: the view's up (root) times the file's own (its group).
const turnOf = (viewUp, fileUp = viewUp) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...UP[viewUp])).multiply(relativeUp(viewUp, fileUp)).toArray();
const near = (actual, expected, tolerance = 1e-9) => {
    assert.equal(actual.length, expected.length);
    actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) <= tolerance, `${actual} vs ${expected}`));
};

test('a +Z file\'s point, shown with its z up the screen, reads back in the file\'s frame', () => {
    // +Z up turns the file's (1, 2, 3) to the view's (1, 3, -2).
    near(filePoint([1, 3, -2], turnOf('+Z')), [1, 2, 3]);
});

test('an up axis chosen in the view is undone', () => {
    near(filePoint([1, 2, 3], turnOf('+Y', '+Y')), [1, 2, 3]);
    near(filePoint([1, -3, 2], turnOf('-Z')), [1, 2, 3]);
});

test('a UTM point keeps its offset and its millimetres', () => {
    near(filePoint([500100.5, 120, -4000200.25], turnOf('+Z')), [500100.5, 4000200.25, 120], 1e-6);
});

test('distance and per-axis deltas between two points of one file', () => {
    const turn = turnOf('+Z');
    const result = measurement({ view: [1, 3, -2], turn }, { view: [4, 3, -6], turn });
    near(result.a, [1, 2, 3]);
    near(result.b, [4, 6, 3]);
    assert.ok(Math.abs(result.distance - 5) < 1e-9);
    near(result.delta, [3, 4, 0]);
});

test('points of two files read in their own frames, the deltas in the first point\'s', () => {
    const cloud = turnOf('+Z');
    const gltf = turnOf('+Z', '+Y');
    const result = measurement({ view: [0, 0, 0], turn: cloud }, { view: [1, 2, 3], turn: gltf });
    near(result.a, [0, 0, 0]);
    near(result.b, [1, 2, 3]);
    assert.ok(Math.abs(result.distance - Math.sqrt(14)) < 1e-9);
    // The glTF's (1, 2, 3) lies at (1, -3, 2) in the cloud's frame: its +Y is the cloud's +Z, its +Z the cloud's -Y.
    near(result.delta, [1, -3, 2]);
});

test('decimals reach a millimetre in a metre-sized view and a thousandth of a smaller one', () => {
    assert.equal(decimalsFor(150), 3);
    assert.equal(decimalsFor(2), 3);
    assert.equal(decimalsFor(0.5), 4);
    assert.equal(decimalsFor(0.05), 5);
    assert.equal(decimalsFor(1e-12), 7);
    assert.equal(decimalsFor(0), 3);
    assert.equal(decimalsFor(NaN), 3);
});

test('lengths carry the USD stage\'s unit; other files have none', () => {
    assert.equal(formatLength(5, 3), '5.000');
    assert.equal(formatLength(12.5, 3, 1), '12.500 m');
    assert.equal(formatLength(12.5, 3, 0.01), '12.500 cm');
    assert.equal(formatLength(12.5, 3, 0.001), '12.500 mm');
    assert.equal(formatLength(10, 3, 0.0254), '10.000 × 0.0254 m');
});

test('coordinates read without grouping, so they paste into code, and never as -0', () => {
    assert.equal(formatPoint([500100.5, 4000200.25, 120], 3), '500100.500, 4000200.250, 120.000');
    assert.equal(formatPoint([-0.0001, -1.5, 0], 3, 0.01), '0.000, -1.500, 0.000 cm');
    assert.equal(formatLength(-0.0001, 3), '0.000');
});

test('a stage the view scales to meters reads in its own units', () => {
    // A metersPerUnit 0.01 stage is shown at 0.01: 1.5 m in the view is 150 cm in the stage.
    const turn = turnOf('+Y');
    const result = measurement({ view: [1.5, 0, 0], turn, scale: 0.01 }, { view: [1.5, 0.3, 0.4], turn, scale: 0.01 });
    near(result.a, [150, 0, 0], 1e-9);
    near(result.b, [150, 30, 40], 1e-9);
    assert.ok(Math.abs(result.distance - 50) < 1e-9);
    near(result.delta, [0, 30, 40], 1e-9);
});

test('a unit is named once for the readout, and only when every point shares it', async () => {
    const { readoutUnit } = await import('../../packages/mesh-splat/webview/measure.mjs');
    assert.deepEqual(readoutUnit([0.01, 0.01]), { shared: 'cm' });
    assert.deepEqual(readoutUnit([1]), { shared: 'm' });
    assert.deepEqual(readoutUnit([0.0254]), { shared: '× 0.0254 m' });
    assert.deepEqual(readoutUnit([undefined, null]), { shared: null });
    // Points of files in different units each carry theirs.
    assert.deepEqual(readoutUnit([0.01, 1]), { perRow: true });
    assert.deepEqual(readoutUnit([0.01, undefined]), { perRow: true });
});
