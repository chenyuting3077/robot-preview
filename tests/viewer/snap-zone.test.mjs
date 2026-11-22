import test from 'node:test';
import assert from 'node:assert/strict';
import { snapZone } from '../../src/ui/PanelManager.js';

const v = { width: 1000, height: 800, top: 40 };

test('a corner reaches a quarter of the view along each edge', () => {
    assert.equal(snapZone(5, 5, v), 'top-left');
    assert.equal(snapZone(995, 190, v), 'top-right', 'along the right edge, inside the top quarter');
    assert.equal(snapZone(240, 795, v), 'bottom-left', 'along the bottom edge, inside the left quarter');
    assert.equal(snapZone(995, 795, v), 'bottom-right');
});

test('the middle of a side docks to that side; the middle of the top or bottom edge, nothing', () => {
    assert.equal(snapZone(5, 210, v), 'left');
    assert.equal(snapZone(995, 590, v), 'right');
    assert.equal(snapZone(500, 5, v), null);
    assert.equal(snapZone(500, 795, v), null);
    assert.equal(snapZone(500, 400, v), null);
});

test('past the edge counts as at it', () => {
    assert.equal(snapZone(-30, 400, v), 'left');
    assert.equal(snapZone(1030, -10, v), 'top-right');
});
