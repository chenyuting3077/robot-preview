import assert from 'node:assert/strict';
import fs from 'node:fs';
import { linearByteTable } from '../../packages/mesh-splat/webview/color.mjs';

// Files written by laspy 2.7 (tests/fixtures/las/generate.py), checked against laspy's own reading of them.
const fixtures = new URL('../fixtures/las/', import.meta.url);
export const fixture = name => new Uint8Array(fs.readFileSync(new URL(name, fixtures)));
export const expected = JSON.parse(fs.readFileSync(new URL('expected.json', fixtures), 'utf8'));
const plain = array => array && [...array];

export function matchesLaspy(points, want, name) {
    const table = linearByteTable();
    assert.equal(points.total, want.count, name);
    assert.deepEqual([points.las.version, points.las.format], [want.version, want.format], name);
    const [cx, cy] = points.offset ?? [0, 0];
    want.x.forEach((x, i) => {
        assert.equal(points.positions[i * 3], Math.fround(x - cx), `${name} x ${i}`);
        assert.equal(points.positions[i * 3 + 1], Math.fround(want.y[i] - cy), `${name} y ${i}`);
        assert.equal(points.positions[i * 3 + 2], Math.fround(want.z[i]), `${name} z ${i}`);
    });
    for (const field of ['intensity', 'classification', 'return_number', 'point_source_id']) assert.deepEqual(plain(points.scalars[field]), want[field], `${name} ${field}`);
    if (want.gps_time) {
        const earliest = Math.min(...want.gps_time);
        want.gps_time.forEach((t, i) => assert.ok(Math.abs(points.scalars.gps_time[i] - (t - earliest)) < 1e-4, `${name} gps ${i}`));
    }
    assert.deepEqual(plain(points.colors), want.rgb ? want.rgb.map(v => table[v >> 8]) : null, `${name} rgb`);
}
