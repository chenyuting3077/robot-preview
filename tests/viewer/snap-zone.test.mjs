import test from 'node:test';
import assert from 'node:assert/strict';
import { snapZone, placement } from '../../src/ui/PanelManager.js';

const v = { width: 1000, height: 800, top: 40 };

test('a corner reaches a quarter of the view along each edge', () => {
    assert.equal(snapZone(5, 5, v), 'top-left');
    assert.equal(snapZone(995, 190, v), 'top-right', 'along the right edge, inside the top quarter');
    assert.equal(snapZone(240, 795, v), 'bottom-left', 'along the bottom edge, inside the left quarter');
    assert.equal(snapZone(995, 795, v), 'bottom-right');
    assert.equal(snapZone(140, 150, v), 'top-left', 'away from the edges, inside 15% of the width and a quarter of the height');
    assert.equal(snapZone(870, 700, v), 'bottom-right');
    assert.equal(snapZone(160, 150, v), null, 'past 15% of the width, off the edges');
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

test('a corner holds at most half the height below the toolbar; a side dock the full height', () => {
    // (800 - 40 - 3 * 20) / 2
    const tall = { left: 0, top: 0, width: 300, height: 600 };
    assert.deepEqual(placement({ ...tall, dock: 'top-right' }, v), { left: 680, top: 60, width: 300, height: 350 });
    assert.deepEqual(placement({ ...tall, dock: 'bottom-right' }, v), { left: 680, top: 430, width: 300, height: 350 });
    assert.deepEqual(placement({ ...tall, height: 200, dock: 'bottom-left' }, v), { left: 20, top: 580, width: 300, height: 200 }, 'a short panel keeps its height');
    assert.equal(placement({ ...tall, dock: 'left' }, v).height, 720);
});
