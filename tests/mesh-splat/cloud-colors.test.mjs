import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import * as THREE from '../../packages/mesh-splat/node_modules/three/build/three.module.js';
import { createCloudColors, assignHues } from '../../packages/mesh-splat/webview/cloud-colors.mjs';
import { POINT_GREY } from '../../packages/mesh-splat/webview/materials.mjs';

function page() {
    const { document } = parseHTML(`<div id="color-separator"></div>
        <button data-color="rgb"></button><button data-color="height" id="color-height"></button><div id="color-fields"></div>`);
    globalThis.document = document;
    return document;
}

function cloud(positions, { rgb, scalars } = {}) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    if (rgb) geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(rgb), 3, true));
    geometry.userData.scalars = scalars && Object.fromEntries(Object.entries(scalars).map(([name, values]) => [name, new Float32Array(values)]));
    return new THREE.Points(geometry, new THREE.PointsMaterial());
}

const active = document => [...document.querySelectorAll('[data-color]')].filter(b => b.classList.contains('active')).map(b => b.dataset.color);
const fieldButtons = document => [...document.querySelectorAll('#color-fields button')].map(b => [b.dataset.color, b.textContent]);

test('a cloud without RGB starts in intensity, and Original falls back to grey', () => {
    const document = page();
    const root = new THREE.Group();
    const points = cloud([0, 0, 0, 0, 0, 1], { scalars: { intensity: [1, 2] } });
    root.add(points);
    const changes = [];
    const colors = createCloudColors({ root, upAxis: () => '+Z', label: name => name.toUpperCase(), onChange: (...change) => changes.push(change) });
    colors.setup();
    assert.deepEqual(active(document), ['field:intensity']);
    assert.deepEqual(fieldButtons(document), [['field:intensity', 'INTENSITY']]);
    assert.ok(points.geometry.attributes.color);
    colors.setMode('rgb');
    assert.equal(points.geometry.attributes.color, undefined);
    assert.equal(points.material.color.getHex(), new THREE.Color(POINT_GREY).getHex());
    // The legend hears each mode with its range, and none for Original.
    assert.equal(changes[0][0], 'field:intensity');
    assert.equal(changes[0][1].length, 2);
    assert.deepEqual(changes.at(-1), ['rgb', null]);
});

test('a cloud with RGB starts in it, and has no field buttons without fields', () => {
    const document = page();
    const root = new THREE.Group();
    root.add(cloud([0, 0, 0], { rgb: [255, 0, 0] }));
    createCloudColors({ root, upAxis: () => '+Z' }).setup();
    assert.deepEqual(active(document), ['rgb']);
    assert.deepEqual(fieldButtons(document), []);
});

test('every field of every cloud gets one button, and a field named "height" stays apart from Height', () => {
    const document = page();
    const root = new THREE.Group();
    const a = cloud([0, 0, 0, 0, 0, 1], { scalars: { confidence: [0, 1], height: [5, 5] } });
    const b = cloud([0, 0, 0, 0, 0, 1], { scalars: { confidence: [2, 3] } });
    root.add(a, b);
    const colors = createCloudColors({ root, upAxis: () => '+Z' });
    colors.setup();
    assert.deepEqual(fieldButtons(document).map(([mode]) => mode), ['field:confidence', 'field:height']);
    assert.deepEqual(active(document), ['height']);
    // Confidence spans 0-3 over both clouds, so b's points take the warmer end of one shared scale.
    colors.setMode('field:confidence');
    assert.deepEqual(active(document), ['field:confidence']);
    assert.notDeepEqual([...a.geometry.attributes.color.array.slice(0, 3)], [...b.geometry.attributes.color.array.slice(0, 3)]);
    // A cloud without the field keeps its mode.
    colors.setMode('field:height');
    assert.deepEqual([colors.modeOf(a), colors.modeOf(b)], ['field:height', 'field:confidence']);
});

test('heights share one range across clouds, in the root frame', () => {
    page();
    const root = new THREE.Group();
    const low = cloud([0, 0, 0, 0, 0, 1]);
    const high = cloud([0, 0, 0, 0, 0, 1]);
    high.position.z = 10;
    root.add(low, high);
    createCloudColors({ root, upAxis: () => '+Z' }).setup();
    const first = cloudColor => [...cloudColor.geometry.attributes.color.array.slice(0, 3)];
    // The same local heights, placed 10 apart: the low cloud takes the bottom of the scale, the high one the top.
    assert.notDeepEqual(first(low), first(high));
});

test('a cloud added later takes the current mode and the loaded clouds\' range', () => {
    page();
    const root = new THREE.Group();
    const base = cloud([0, 0, 0, 0, 0, 1], { scalars: { intensity: [1, 2] } });
    root.add(base);
    const colors = createCloudColors({ root, upAxis: () => '+Z' });
    colors.setup();
    const before = [...base.geometry.attributes.color.array];
    const detail = cloud([0, 0, 0.5], { scalars: { intensity: [100] } });
    root.add(detail);
    colors.add(detail);
    assert.ok(detail.geometry.attributes.color);
    assert.deepEqual([...base.geometry.attributes.color.array], before, 'the detail does not move the range');
    colors.remove(detail);
    colors.setMode('rgb');
    assert.ok(detail.geometry.attributes.color, 'a removed cloud is left alone');
});

// A cloud as main.js shows it: read with its offset taken out, then placed back at the offset.
async function placedCloud(rows) {
    const { parsePointsText } = await import('../../packages/mesh-splat/webview/text-formats.mjs');
    const { positions, offset } = parsePointsText(rows.map(row => row.join(' ')).join('\n'));
    const points = cloud(positions);
    if (offset) points.position.fromArray(offset);
    return { points, offset };
}

for (const [label, up, row, expected] of [
    ['a UTM cloud, elevations kept', '+Z', i => [500000 + i / 10, 4000000 + i / 7, 500 + i / 20], [500, 505]],
    ['a Y-up UTM cloud, northing in Z', '+Y', i => [500000 + i / 10, 500 + i / 20, 4000000 + i / 7], [500, 505]],
    ['a cloud with far heights too', '+Z', i => [500000 + i / 10, 4000000 + i / 7, 20000 + i / 20], [20000, 20005]]
]) {
    test(`the height legend reads real elevations for ${label}`, async () => {
        page();
        const root = new THREE.Group();
        root.rotation.set(...{ '+Z': [-Math.PI / 2, 0, 0], '+Y': [0, 0, 0] }[up]);
        const { points, offset } = await placedCloud(Array.from({ length: 101 }, (_, i) => row(i)));
        assert.ok(offset, 'the offset was taken out');
        root.add(points);
        const changes = [];
        const colors = createCloudColors({ root, upAxis: () => up, onChange: (...change) => changes.push(change) });
        colors.setup();
        colors.setMode('height');
        const [low, high] = changes.at(-1)[1];
        // The 2nd and 98th percentile of 101 evenly spaced heights.
        assert.ok(Math.abs(low - (expected[0] + 0.1)) < 1e-3 && Math.abs(high - (expected[1] - 0.1)) < 1e-3, `${low} ${high}`);
    });
}
// A column of `n` points from z = `low` to z = `high`.
const column = (low, high, n = 101) => Array.from({ length: n }, (_, i) => [0, 0, low + (high - low) * i / (n - 1)]).flat();
const colorsOf = points => [...points.geometry.attributes.color.array];
const uniform = points => colorsOf(points).every((value, i, all) => value === all[i % 3]);

test('each cloud keeps its own mode, and height\'s range comes from the clouds shown by height only', () => {
    const document = page();
    const root = new THREE.Group();
    const scan = cloud(column(0, 1));
    const map = cloud(column(100, 200));
    root.add(scan, map);
    const changes = [];
    const colors = createCloudColors({ root, upAxis: () => '+Z', onChange: (...change) => changes.push(change) });
    colors.setup();
    colors.setMode('solid', [map]);
    assert.equal(colors.modeOf(scan), 'height');
    assert.equal(colors.modeOf(map), 'solid');
    const [, range] = changes.at(-1);
    assert.ok(range[0] >= 0 && range[1] <= 1, `height range ${range} is the scan's alone`);
    // The scan still spans the whole scale; the map is one color.
    assert.notDeepEqual(colorsOf(scan).slice(0, 3), colorsOf(scan).slice(-3));
    assert.ok(uniform(map));
    // With the clouds in different modes, no Display button is active.
    assert.deepEqual(active(document), []);
});

test('the Display menu\'s mode sets every cloud, and the shared range spans them', () => {
    const document = page();
    const root = new THREE.Group();
    const scan = cloud(column(0, 1));
    const map = cloud(column(100, 200));
    root.add(scan, map);
    const changes = [];
    const colors = createCloudColors({ root, upAxis: () => '+Z', onChange: (...change) => changes.push(change) });
    colors.setup();
    colors.setMode('solid', [map]);
    colors.setMode('height');
    assert.deepEqual([colors.modeOf(scan), colors.modeOf(map)], ['height', 'height']);
    assert.deepEqual(active(document), ['height']);
    const [mode, [low, high]] = changes.at(-1);
    assert.equal(mode, 'height');
    assert.ok(low < 10 && high > 190, `range ${low}..${high} spans both clouds`);
});

test('each file takes the lowest solid color no file in the view has, and keeps the one it had', () => {
    // Ids 0 and 10 would share a color by id modulo the palette.
    assert.deepEqual(assignHues(['0', '10']), { 0: 0, 10: 1 });
    assert.deepEqual(assignHues(['0', '2', '5'], { 0: 0, 2: 2 }), { 0: 0, 2: 2, 5: 1 });
    assert.deepEqual(assignHues(['2', '5', '6'], { 2: 2, 5: 0, 9: 1 }), { 2: 2, 5: 0, 6: 1 });
});

test('solid paints each file one color of its own, in file order, and its detail takes the same', () => {
    page();
    const root = new THREE.Group();
    const a = cloud(column(0, 1, 5));
    const b = cloud(column(0, 1, 5));
    root.add(a, b);
    const colors = createCloudColors({ root, upAxis: () => '+Z' });
    colors.setup();
    colors.setMode('solid');
    assert.ok(uniform(a) && uniform(b));
    assert.notDeepEqual(colorsOf(a).slice(0, 3), colorsOf(b).slice(0, 3));
    const detail = cloud(column(0, 1, 3));
    a.add(detail);
    colors.add(detail);
    assert.deepEqual(colorsOf(detail).slice(0, 3), colorsOf(a).slice(0, 3));
    // Solid has no range, so the legend hides.
    assert.equal(colors.modeOf(detail), 'solid');
});

test('the clouds of one file start in one mode: Original if any has RGB, else intensity if any has it, else height', () => {
    page();
    const start = (...list) => {
        const root = new THREE.Group();
        root.add(...list);
        const colors = createCloudColors({ root, upAxis: () => '+Z', fileOf: () => 0 });
        colors.setup();
        return list.map(cloud => colors.modeOf(cloud));
    };
    // A USD stage with a colored Points prim and a plain one: the plain one shows grey, as before #10.
    const plain = cloud([0, 0, 0, 0, 0, 1]);
    assert.deepEqual(start(cloud([0, 0, 0, 0, 0, 1], { rgb: [255, 0, 0, 0, 255, 0] }), plain), ['rgb', 'rgb']);
    assert.equal(plain.geometry.attributes.color, undefined);
    assert.deepEqual(start(cloud([0, 0, 0, 0, 0, 1], { scalars: { intensity: [1, 2] } }), cloud([0, 0, 0, 0, 0, 1])), ['field:intensity', 'field:intensity']);
    assert.deepEqual(start(cloud([0, 0, 0, 0, 0, 1]), cloud([0, 0, 0, 0, 0, 1])), ['height', 'height']);
});

test('several files\' modes set at once recolor once', () => {
    page();
    const root = new THREE.Group();
    const a = cloud(column(0, 1, 5));
    const b = cloud(column(0, 1, 5));
    root.add(a, b);
    let recolors = 0;
    const colors = createCloudColors({ root, upAxis: () => '+Z', onChange: () => recolors++ });
    colors.setup();
    recolors = 0;
    colors.setModes([['solid', [a]], ['height', [b]]]);
    assert.equal(recolors, 1);
    assert.deepEqual([colors.modeOf(a), colors.modeOf(b)], ['solid', 'height']);
    assert.ok(uniform(a));
});

test('a cloud with no points gives no range, so the legend hides', () => {
    page();
    const root = new THREE.Group();
    root.add(cloud([], { scalars: { intensity: [] } }));
    const changes = [];
    const colors = createCloudColors({ root, upAxis: () => '+Z', onChange: (...change) => changes.push(change) });
    colors.setup();
    colors.setMode('height');
    assert.deepEqual(changes, [['field:intensity', null], ['height', null]]);
});

test('a field from the Display menu sets the clouds that carry it; the others keep their mode', () => {
    const document = page();
    const root = new THREE.Group();
    const scan = cloud(column(0, 1, 5), { scalars: { intensity: [1, 2, 3, 4, 5], ring: [0, 1, 2, 3, 4] } });
    const map = cloud(column(0, 1, 5));
    root.add(scan, map);
    const colors = createCloudColors({ root, upAxis: () => '+Z' });
    colors.setup();
    const heights = colorsOf(map);
    colors.setMode('field:ring');
    assert.deepEqual([colors.modeOf(scan), colors.modeOf(map)], ['field:ring', 'height']);
    assert.deepEqual(colorsOf(map), heights);
    assert.deepEqual(active(document), ['field:ring']);
    colors.setMode('height');
    assert.deepEqual([colors.modeOf(scan), colors.modeOf(map)], ['height', 'height']);
    assert.deepEqual(active(document), ['height']);
});

test('a solid color is the swatch\'s sRGB color as linear bytes, converted once', () => {
    page();
    const root = new THREE.Group();
    const a = cloud(column(0, 1, 5));
    root.add(a);
    const colors = createCloudColors({ root, upAxis: () => '+Z' });
    colors.setup();
    colors.setMode('solid');
    // The sRGB transfer function (IEC 61966-2-1) applied to the first file's swatch, #f28e2b.
    const linear = byte => { const c = byte / 255; return Math.round(255 * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); };
    assert.equal(`#${colors.solidOf(a).getHexString()}`, '#f28e2b');
    assert.deepEqual(colorsOf(a).slice(0, 3), [0xf2, 0x8e, 0x2b].map(linear));
});

test('removing a cloud recomputes the shared range', () => {
    page();
    const root = new THREE.Group();
    const scan = cloud(column(0, 1));
    const map = cloud(column(100, 200));
    root.add(scan, map);
    const changes = [];
    const colors = createCloudColors({ root, upAxis: () => '+Z', onChange: (...change) => changes.push(change) });
    colors.setup();
    assert.ok(changes.at(-1)[1][1] > 190);
    colors.remove(map);
    assert.ok(changes.at(-1)[1][1] <= 1, 'the range is the scan\'s alone');
    // The scan's colors span the whole scale again.
    assert.notDeepEqual(colorsOf(scan).slice(0, 3), colorsOf(scan).slice(-3));
});

test('the legend follows the Display menu\'s mode, then any ranged mode, and hides when none is left', () => {
    page();
    const root = new THREE.Group();
    const scan = cloud(column(0, 1), { scalars: { intensity: column(0, 1).filter((_, i) => i % 3 === 2).map(z => z * 50) } });
    const map = cloud(column(100, 200), { rgb: Array(101 * 3).fill(200) });
    root.add(scan, map);
    const changes = [];
    const colors = createCloudColors({ root, upAxis: () => '+Z', onChange: (...change) => changes.push(change) });
    colors.setup();
    // Each cloud starts in its own best mode: the map in its RGB, the scan in intensity.
    assert.deepEqual([colors.modeOf(scan), colors.modeOf(map)], ['field:intensity', 'rgb']);
    assert.equal(changes.at(-1)[0], 'field:intensity');
    colors.setMode('height');
    colors.setMode('field:intensity', [scan]);
    assert.equal(changes.at(-1)[0], 'height', 'the Display menu last set height, and the map still uses it');
    colors.setMode('rgb', [map]);
    assert.equal(changes.at(-1)[0], 'field:intensity', 'no cloud uses height any more');
    colors.setMode('solid', [scan]);
    assert.deepEqual(changes.at(-1)[1], null);
});
