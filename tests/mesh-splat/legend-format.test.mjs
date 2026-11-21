import test from 'node:test';
import assert from 'node:assert/strict';
import { legendLabels } from '../../packages/mesh-splat/webview/legend-format.mjs';

test('both ends of a legend get enough decimals for their difference to read', () => {
    assert.deepEqual(legendLabels(1234.5, 1236.0, 'en-US'), ['1,234.5', '1,236.0']);
    assert.deepEqual(legendLabels(500.1, 504.9, 'en-US'), ['500.1', '504.9']);
    assert.deepEqual(legendLabels(0, 255, 'en-US'), ['0', '255']);
    assert.deepEqual(legendLabels(0.02, 0.98, 'en-US'), ['0.02', '0.98']);
});

test('a high, narrow range keeps its integer part instead of rounding it to three digits', () => {
    // float32 steps 0.25 at 4e6, which has two decimals.
    assert.deepEqual(legendLabels(4000123.25, 4000123.75, 'en-US'), ['4,000,123.25', '4,000,123.75']);
});

test('decimals stop at the ones float32\'s step has at that size', () => {
    // 0.5 at 8e6: one decimal, whatever the span asks for.
    assert.deepEqual(legendLabels(8000000.5, 8000000.5 + 0.5, 'en-US'), ['8,000,000.5', '8,000,001.0']);
});

test('values near 1 with a tiny span stay in fixed point, up to seven decimals', () => {
    assert.deepEqual(legendLabels(Math.fround(1.0000001), Math.fround(1.0000005), 'en-US'), ['1.0000001', '1.0000005']);
});

test('a range without a span shows its value to three significant digits or more, whole numbers kept', () => {
    assert.deepEqual(legendLabels(1234.5, 1234.5, 'en-US'), ['1,234.5', '1,234.5']);
    assert.deepEqual(legendLabels(0.004, 0.004, 'en-US'), ['0.004', '0.004']);
    assert.deepEqual(legendLabels(0, 0, 'en-US'), ['0', '0']);
});

test('no end reads as -0', () => {
    assert.deepEqual(legendLabels(-0.04, 2.5, 'en-US'), ['0.0', '2.5']);
});

test('tiny magnitudes go scientific, so the ends still differ', () => {
    assert.deepEqual(legendLabels(0, 1e-7, 'en-US'), ['0', '1E-7']);
    assert.deepEqual(legendLabels(1.5e-8, 9.5e-8, 'en-US'), ['1.5E-8', '9.5E-8']);
});

test('a range with a non-finite end falls back to three significant digits', () => {
    assert.deepEqual(legendLabels(NaN, 3.14159, 'en-US'), ['NaN', '3.14']);
});
