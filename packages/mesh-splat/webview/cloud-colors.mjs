import * as THREE from 'three';
import { colorize, colorRange } from './color.mjs';
import { heights } from './geometry.mjs';
import { hasColor, POINT_GREY } from './materials.mjs';

// The color buttons of the Display menu over every point cloud under `root`: Original, Height, and one per
// scalar field the clouds carry in `geometry.userData.scalars` (name to values: PCD intensity, the extra
// properties of a PLY). Modes are 'rgb', 'height' and 'field:<name>', so a field named "height" stays apart.
// `label` names a field's button; `onChange(mode, range)` hears every recolor, `range` null for Original.
export function createCloudColors({ root, upAxis, label = name => name, onChange = () => {} }) {
    const clouds = [];
    let current;
    const fieldOf = mode => (mode?.startsWith('field:') ? mode.slice(6) : null);
    function setMode(mode) {
        current = mode;
        document.querySelectorAll('[data-color]').forEach(button => button.classList.toggle('active', button.dataset.color === mode));
        // Heights in the root's frame, where the up axis applies; one range over all clouds.
        root.updateMatrixWorld(true);
        const toRoot = root.matrixWorld.clone().invert();
        const field = fieldOf(mode);
        const values = clouds.map(({ geometry, matrixWorld }) => (field ? geometry.userData.scalars?.[field]
            : mode === 'height' && heights(geometry.attributes.position.array, upAxis(), toRoot.clone().multiply(matrixWorld).elements)));
        // The range comes from the clouds as loaded, so adding detail does not recolor the rest.
        const ranged = values.filter((value, c) => value && !clouds[c].userData.detail);
        const range = ranged.length ? colorRange(ranged) : null;
        clouds.forEach((cloud, c) => {
            const { geometry, material } = cloud;
            // One mapped attribute per cloud, refilled in place: a replaced attribute keeps its GPU buffer until the geometry is disposed.
            if (values[c]) {
                const mapped = cloud.userData.mapped ??= new THREE.BufferAttribute(new Uint8Array(values[c].length * 3), 3, true);
                colorize(values[c], mapped.array, range);
                mapped.needsUpdate = true;
                geometry.setAttribute('color', mapped);
            }
            else if (cloud.userData.rgb) geometry.setAttribute('color', cloud.userData.rgb);
            else geometry.deleteAttribute('color');
            material.vertexColors = hasColor(geometry);
            material.color.set(hasColor(geometry) ? 0xffffff : POINT_GREY);
            material.needsUpdate = true;
        });
        onChange(mode, mode === 'rgb' ? null : range);
    }

    // Runs before the Points display mode adds points to meshes, so every Points here is a point cloud.
    function setup() {
        root.traverse(child => { if (child.isPoints) clouds.push(child); });
        for (const cloud of clouds) cloud.userData.rgb = cloud.geometry.attributes.color;
        const names = [...new Set(clouds.flatMap(cloud => Object.keys(cloud.geometry.userData.scalars ?? {})))];
        document.getElementById('color-fields').replaceChildren(...names.map(name => {
            const button = Object.assign(document.createElement('button'), { className: 'control-button', textContent: label(name), title: name });
            button.dataset.color = `field:${name}`;
            return button;
        }));
        document.querySelectorAll('[data-color], #color-separator').forEach(element => { element.hidden = !clouds.length; });
        document.querySelectorAll('[data-color]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.color)));
        if (clouds.length) setMode(clouds.some(cloud => cloud.userData.rgb) ? 'rgb' : names.includes('intensity') ? 'field:intensity' : 'height');
    }

    // A cloud added after setup (the detail of a sampled one) takes the current mode and the loaded clouds' range.
    function add(cloud) {
        cloud.userData.detail = true;
        clouds.push(cloud);
        cloud.userData.rgb = cloud.geometry.attributes.color;
        setMode(current);
    }
    function remove(cloud) {
        clouds.splice(clouds.indexOf(cloud), 1);
        setMode(current);
    }

    return { setup, setMode, add, remove };
}
