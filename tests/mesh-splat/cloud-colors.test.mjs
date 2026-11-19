import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import * as THREE from '../../packages/mesh-splat/node_modules/three/build/three.module.js';
import { createCloudColors } from '../../packages/mesh-splat/webview/cloud-colors.mjs';
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
    // A cloud without the field shows grey in that mode.
    colors.setMode('field:height');
    assert.equal(b.geometry.attributes.color, undefined);
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
