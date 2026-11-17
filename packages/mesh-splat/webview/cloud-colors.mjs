import * as THREE from 'three';
import { colorize, colorRange, heights } from './geometry.mjs';

const hasColor = geometry => Boolean(geometry.attributes.color);

// The Original / Height / Intensity buttons of the Display menu, over every point cloud under `root`.
export function createCloudColors({ root, upAxis }) {
    const clouds = [];
    function setMode(mode) {
        document.querySelectorAll('[data-color]').forEach(button => button.classList.toggle('active', button.dataset.color === mode));
        // Heights in the root's frame, where the up axis applies; one range over all clouds.
        root.updateMatrixWorld(true);
        const toRoot = root.matrixWorld.clone().invert();
        const values = clouds.map(({ geometry, matrixWorld }) => (mode === 'intensity' ? geometry.userData.intensity
            : mode === 'height' && heights(geometry.attributes.position.array, upAxis(), toRoot.clone().multiply(matrixWorld).elements)));
        const range = values.some(Boolean) && colorRange(values.filter(Boolean));
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
            material.color.set(hasColor(geometry) ? 0xffffff : 0x9aa7b8);
            material.needsUpdate = true;
        });
    }

    // Runs before the Points display mode adds points to meshes, so every Points here is a point cloud.
    function setup() {
        root.traverse(child => { if (child.isPoints) clouds.push(child); });
        for (const cloud of clouds) cloud.userData.rgb = cloud.geometry.attributes.color;
        const has = key => clouds.some(cloud => key === 'rgb' ? cloud.userData.rgb : cloud.geometry.userData.intensity);
        document.querySelectorAll('[data-color], #color-separator').forEach(element => { element.hidden = !clouds.length; });
        document.getElementById('color-intensity').hidden = !has('intensity');
        document.querySelectorAll('[data-color]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.color)));
        if (clouds.length) setMode(has('rgb') ? 'rgb' : has('intensity') ? 'intensity' : 'height');
    }

    return { setup, setMode };
}
