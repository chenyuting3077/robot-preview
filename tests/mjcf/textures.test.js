// MJCF textures must land where MuJoCo's classic renderer puts them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import * as THREE from 'three';
import { MJCFAdapter } from '../../src/adapters/MJCFAdapter.js';
import { builtinTexturePixels } from '../../src/utils/MJCFTextures.js';

globalThis.DOMParser = DOMParser;

// The floor of MuJoCo Menagerie's scene.xml files.
const scene = `
<mujoco model="scene">
  <asset>
    <texture type="2d" name="groundplane" builtin="checker" mark="edge" rgb1="0.2 0.3 0.4" rgb2="0.1 0.2 0.3"
      markrgb="0.8 0.8 0.8" width="300" height="300"/>
    <material name="groundplane" texture="groundplane" texuniform="true" texrepeat="5 5" reflectance="0.2"/>
    <texture name="cubetex" builtin="checker" width="64" height="64"/>
    <material name="cubemat" texture="cubetex"/>
    <material name="red" rgba="1 0 0 1"/>
    <material name="tiles" texture="groundplane" texrepeat="2 3"/>
  </asset>
  <worldbody>
    <geom name="floor" size="0 0 0.05" type="plane" material="groundplane"/>
    <body name="b">
      <geom name="cube" type="box" size="0.1 0.1 0.1" material="cubemat"/>
      <geom name="own_rgba" type="box" size="0.1 0.1 0.1" material="red" rgba="0 1 0 1" pos="1 0 0"/>
      <geom name="default_rgba" type="box" size="0.1 0.1 0.1" material="red" rgba="0.5 0.5 0.5 1" pos="2 0 0"/>
      <geom name="tiled" type="box" size="0.1 0.2 0.3" material="tiles" pos="3 0 0"/>
    </body>
  </worldbody>
</mujoco>`;

function findMesh(model, name) {
    let found = null;
    model.threeObject.traverse(object => {
        if (object.name === name) found = object;
    });
    assert.ok(found, `mesh ${name}`);
    return found;
}

const sample = (map, u, v) => new THREE.Vector2(u, v).applyMatrix3(map.matrix);

test('Menagerie floor: one checker repeat per 2 / texrepeat metres, starting like MuJoCo', async () => {
    const model = await MJCFAdapter.parse(scene, new Map());
    const floor = findMesh(model, 'floor');
    const map = floor.material.map;
    assert.ok(map, 'floor has a texture');
    assert.equal(map.colorSpace, THREE.SRGBColorSpace);

    // The display plane is 100 m wide; uv 0.5 is the origin.
    const width = floor.geometry.parameters.width;
    const atOrigin = sample(map, 0.5, 0.5);
    const oneRepeat = sample(map, 0.5 + 0.4 / width, 0.5 + 0.4 / width);
    assert.ok(Math.abs(atOrigin.x + 0.5) < 1e-9, `u at origin ${atOrigin.x}`);
    assert.ok(Math.abs(oneRepeat.x - atOrigin.x - 1) < 1e-9, `u per 0.4 m ${oneRepeat.x - atOrigin.x}`);
    assert.ok(Math.abs(Math.abs(oneRepeat.y - atOrigin.y) - 1) < 1e-9, `v per 0.4 m ${oneRepeat.y - atOrigin.y}`);
    // Material rgba is white by default, so the texture keeps its colors.
    assert.deepEqual(floor.material.color.toArray(), [1, 1, 1]);
});

test('texrepeat without texuniform repeats per face, MuJoCo flips v', async () => {
    const model = await MJCFAdapter.parse(scene, new Map());
    const map = findMesh(model, 'tiled').material.map;
    const corner = sample(map, 0, 0);
    const opposite = sample(map, 1, 1);
    assert.deepEqual([corner.x, corner.y], [0, 3]);
    assert.deepEqual([opposite.x, opposite.y], [2, 0]);
});

test('texture type defaults to cube, which is not drawn', async () => {
    const model = await MJCFAdapter.parse(scene, new Map());
    assert.equal(findMesh(model, 'cube').material.map, null);
});

test('geom rgba wins over the material unless it is the default 0.5 0.5 0.5 1', async () => {
    const model = await MJCFAdapter.parse(scene, new Map());
    assert.deepEqual(findMesh(model, 'own_rgba').material.color.toArray(), [0, 1, 0]);
    assert.deepEqual(findMesh(model, 'default_rgba').material.color.toArray(), [1, 0, 0]);
});

test('builtin checker and edge mark match MuJoCo Builtin2D', () => {
    const pixels = builtinTexturePixels({
        width: 4, height: 4, builtin: 'checker', mark: 'edge',
        rgb1: [1, 0, 0], rgb2: [0, 0, 1], markrgb: [0, 1, 0], random: 0
    });
    const at = (r, c) => Array.from(pixels.slice(4 * (r * 4 + c), 4 * (r * 4 + c) + 3));
    assert.deepEqual(at(0, 0), [0, 255, 0], 'edge');
    assert.deepEqual(at(1, 1), [255, 0, 0], 'rgb1 top-left quadrant');
    assert.deepEqual(at(1, 2), [0, 0, 255], 'rgb2 top-right quadrant');
    assert.deepEqual(at(2, 2), [255, 0, 0], 'rgb1 bottom-right quadrant');
    assert.equal(builtinTexturePixels({ width: 0, height: 4, builtin: 'checker' }), null);
});
