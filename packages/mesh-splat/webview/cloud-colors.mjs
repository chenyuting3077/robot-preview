import * as THREE from 'three';
import { colorize, colorRange } from './color.mjs';
import { heights } from './geometry.mjs';
import { hasColor, POINT_GREY } from './materials.mjs';

// One color per file for the Solid mode, Tableau 10 reordered so the first files (a map and a scan) take
// orange and blue, which stay apart from each other, from turbo's middle and from both backgrounds.
// Solid color indexes for `ids`: a file in `kept` keeps its own, the others take the lowest index no file has,
// so files apart in the view stay apart however many have come and gone.
export function assignHues(ids, kept = {}) {
    const hues = {};
    for (const id of ids) if (Number.isInteger(kept?.[id])) hues[id] = kept[id];
    for (const id of ids) {
        if (id in hues) continue;
        let hue = 0;
        while (Object.values(hues).includes(hue)) hue++;
        hues[id] = hue;
    }
    return hues;
}

export const SOLID_COLORS = ['#f28e2b', '#4e79a7', '#59a14f', '#e15759', '#b07aa1', '#76b7b2', '#edc948', '#ff9da7', '#9c755f', '#bab0ac'];

// A field's mode is 'field:<name>', so a field named "height" stays apart from Height. Height and each field share
// one range over the clouds in that mode, so one color means one value across files. `fileOf` gives a cloud's
// file a number that stays when another file is removed, so its solid color does not change.
export function createCloudColors({ root, upAxis, label = name => name, onChange = () => {}, fileOf = null }) {
    const clouds = [];
    const modes = new Map();
    // The legend shows the mode the Display menu last set while a cloud uses it.
    let shown;
    const fieldOf = mode => (mode?.startsWith('field:') ? mode.slice(6) : null);
    const ranged = mode => mode === 'height' || !!fieldOf(mode);
    // A field's mode is for the clouds that carry it; every cloud takes the others.
    const takes = (cloud, mode) => !fieldOf(mode) || !!cloud.geometry.userData.scalars?.[fieldOf(mode)];
    const solidOf = cloud => {
        const parent = clouds.find(other => other !== cloud && other.children.includes(cloud));
        if (parent) return solidOf(parent);
        const index = fileOf ? fileOf(cloud) : clouds.indexOf(cloud);
        return new THREE.Color(SOLID_COLORS[index % SOLID_COLORS.length]);
    };

    function recolor() {
        // Heights in the root's frame, where the up axis applies.
        root.updateMatrixWorld(true);
        const toRoot = root.matrixWorld.clone().invert();
        const values = clouds.map(cloud => {
            const mode = modes.get(cloud);
            const field = fieldOf(mode);
            if (field) return cloud.geometry.userData.scalars?.[field];
            return mode === 'height' && heights(cloud.geometry.attributes.position.array, upAxis(), toRoot.clone().multiply(cloud.matrixWorld).elements);
        });
        // One range per mode over the clouds in it, as loaded, so adding detail does not recolor the rest.
        const ranges = new Map();
        for (const mode of new Set(modes.values())) {
            const lists = values.filter((value, c) => value && modes.get(clouds[c]) === mode && !clouds[c].userData.detail);
            // No finite value (no points, or all NaN) gives no range.
            const range = ranged(mode) && lists.length && colorRange(lists);
            if (range && Number.isFinite(range[0])) ranges.set(mode, range);
        }
        clouds.forEach((cloud, c) => {
            const { geometry, material } = cloud;
            const mode = modes.get(cloud);
            // One mapped attribute per cloud, refilled in place: a replaced attribute keeps its GPU buffer until the geometry is disposed.
            const mapped = () => (cloud.userData.mapped ??= new THREE.BufferAttribute(new Uint8Array(geometry.attributes.position.count * 3), 3, true));
            if (values[c]) {
                colorize(values[c], mapped().array, ranges.get(mode) ?? colorRange([values[c]]));
                mapped().needsUpdate = true;
                geometry.setAttribute('color', mapped());
            } else if (mode === 'solid') {
                // THREE.Color keeps linear components already (color management is on).
                const [r, g, b] = solidOf(cloud).toArray().map(value => Math.round(value * 255));
                const { array } = mapped();
                for (let i = 0; i < array.length; i += 3) {
                    array[i] = r;
                    array[i + 1] = g;
                    array[i + 2] = b;
                }
                mapped().needsUpdate = true;
                geometry.setAttribute('color', mapped());
            } else if (mode === 'rgb' && cloud.userData.rgb) geometry.setAttribute('color', cloud.userData.rgb);
            else geometry.deleteAttribute('color');
            material.vertexColors = hasColor(geometry);
            material.color.set(hasColor(geometry) ? 0xffffff : POINT_GREY);
            material.needsUpdate = true;
        });
        const all = new Set(modes.values());
        // A button is lit when every cloud that can take its mode is in it.
        document.querySelectorAll('[data-color]').forEach(button => {
            const able = clouds.filter(cloud => takes(cloud, button.dataset.color));
            button.classList.toggle('active', able.length > 0 && able.every(cloud => modes.get(cloud) === button.dataset.color));
        });
        const legend = all.has(shown) && ranges.has(shown) ? shown : clouds.map(cloud => modes.get(cloud)).find(mode => ranges.has(mode));
        onChange(legend ?? shown, legend ? ranges.get(legend) : null);
    }

    // Every cloud, or only `some` of them (a Stage row's).
    function assign(mode, some) {
        if (some === clouds) shown = mode;
        for (const cloud of some) if (clouds.includes(cloud) && takes(cloud, mode)) modes.set(cloud, mode);
        for (const cloud of clouds) for (const child of cloud.children) if (some.includes(cloud) && clouds.includes(child)) modes.set(child, modes.get(cloud));
    }
    function setMode(mode, some = clouds) {
        assign(mode, some);
        recolor();
    }
    // [[mode, clouds], ...] with one recolor, for a view restoring every file's mode.
    function setModes(entries) {
        for (const [mode, some] of entries) assign(mode, some);
        recolor();
    }

    // Runs before the Points display mode adds points to meshes, so every Points here is a point cloud. Each
    // starts in its own colors, else its intensity, else by height.
    function setup() {
        root.traverse(child => { if (child.isPoints) clouds.push(child); });
        for (const cloud of clouds) cloud.userData.rgb = cloud.geometry.attributes.color;
        // The clouds of one file start in one mode, as a file's clouds did before views held several files: a USD
        // stage's plain Points prim shows grey beside a colored one rather than by height.
        const fileKey = cloud => (fileOf ? fileOf(cloud) : cloud);
        for (const key of new Set(clouds.map(fileKey))) {
            const own = clouds.filter(cloud => fileKey(cloud) === key);
            const mode = own.some(cloud => cloud.userData.rgb) ? 'rgb' : own.some(cloud => cloud.geometry.userData.scalars?.intensity) ? 'field:intensity' : 'height';
            for (const cloud of own) modes.set(cloud, mode);
        }
        const names = [...new Set(clouds.flatMap(cloud => Object.keys(cloud.geometry.userData.scalars ?? {})))];
        document.getElementById('color-fields').replaceChildren(...names.map(name => {
            const button = Object.assign(document.createElement('button'), { className: 'control-button', textContent: label(name), title: name });
            button.dataset.color = `field:${name}`;
            return button;
        }));
        document.querySelectorAll('[data-color], #color-separator').forEach(element => { element.hidden = !clouds.length; });
        document.querySelectorAll('[data-color]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.color)));
        shown = modes.get(clouds[0]);
        if (clouds.length) recolor();
    }

    // A cloud added after setup (the detail of a sampled one) takes its parent's mode and the loaded clouds' range.
    function add(cloud) {
        cloud.userData.detail = true;
        const parent = clouds.find(other => other.children.includes(cloud));
        clouds.push(cloud);
        cloud.userData.rgb = cloud.geometry.attributes.color;
        modes.set(cloud, parent ? modes.get(parent) : shown);
        recolor();
    }
    function remove(cloud) {
        if (!clouds.includes(cloud)) return;
        clouds.splice(clouds.indexOf(cloud), 1);
        modes.delete(cloud);
        recolor();
    }

    return { setup, setMode, setModes, add, remove, modeOf: cloud => modes.get(cloud), solidOf, refresh: recolor };
}
