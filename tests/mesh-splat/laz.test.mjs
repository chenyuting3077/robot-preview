import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLazPerf } from '../../packages/mesh-splat/node_modules/laz-perf/lib/node/index.js';
import { lasReader, lazReader } from '../../packages/mesh-splat/webview/las.mjs';
import { expected, fixture as bytesOf, matchesLaspy } from './las-fixtures.mjs';

async function readLaz(bytes, limit, region, size = bytes.length) {
    const reader = await lazReader(bytes.length, () => createLazPerf(), limit, region);
    for (let at = 0; at < bytes.length; at += size) reader.push(bytes.subarray(at, at + size));
    return reader.finish();
}
function readLas(bytes, limit, region) {
    const reader = lasReader(limit, region);
    reader.push(bytes);
    return reader.finish();
}

test('a LAZ shows the same points as its LAS twin, LAS 1.2 and 1.4', async () => {
    for (const name of ['f3-1.2', 'f7-1.4']) {
        const laz = await readLaz(bytesOf(`${name}.laz`), Infinity, {}, 100);
        assert.deepEqual(laz, readLas(bytesOf(`${name}.las`)), name);
        matchesLaspy(laz, expected[`${name}.las`], `${name}.laz`);
    }
});

test('a LAZ sample and its detail read pick the points a LAS one does', async () => {
    const [laz, las] = [await readLaz(bytesOf('f7-1.4.laz'), 5), readLas(bytesOf('f7-1.4.las'), 5)];
    assert.deepEqual(laz, las);
    const region = { inside: x => x > 0, expected: 12, offset: las.offset };
    assert.deepEqual(await readLaz(bytesOf('f7-1.4.laz'), Infinity, region), readLas(bytesOf('f7-1.4.las'), Infinity, region));
});

test('a waveform LAZ, a cut LAZ and a file that is not LAS say what is wrong', async () => {
    await assert.rejects(readLaz(bytesOf('f9-1.4.laz')), /LAZ point format 9 carries waveforms, which the LAZ decoder cannot read/);
    const laz = bytesOf('f7-1.4.laz');
    await assert.rejects(readLaz(laz.subarray(0, laz.length - 400)), /the LAZ decoder cannot open this file: it is cut short, or its compressor \(layered chunked\) is not one laz-perf reads/);
    // A pointwise (unchunked) LAZ names its compressor when laz-perf cannot open it.
    const pointwise = bytesOf('f3-1.2.laz');
    const view = new DataView(pointwise.buffer, pointwise.byteOffset);
    for (let at = view.getUint16(94, true); at < view.getUint32(96, true); at += 54 + view.getUint16(at + 20, true)) {
        if (view.getUint16(at + 18, true) === 22204) view.setUint16(at + 54, 1, true);
    }
    await assert.rejects(readLaz(pointwise), /its compressor \(pointwise\) is not one laz-perf reads/);
    await assert.rejects(readLaz(new TextEncoder().encode('ply\nformat ascii 1.0\n'.repeat(20))), /not a LAS file/);
});

test('a .laz whose points are not compressed reads as LAS', async () => {
    assert.deepEqual(await readLaz(bytesOf('f6-1.4.las')), readLas(bytesOf('f6-1.4.las')));
});
