import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLength } from '../../src/ui/UIController.js';

test('grid cell sizes read as cm or mm', () => {
    assert.equal(formatLength(0.5), '50 cm');
    assert.equal(formatLength(0.1), '10 cm');
    assert.equal(formatLength(0.01), '1 cm');
    assert.equal(formatLength(0.001), '1 mm');
});
