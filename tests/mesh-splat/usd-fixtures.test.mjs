import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Euler, Matrix4, Vector3 } from '../../packages/mesh-splat/node_modules/three/build/three.module.js';
import { composeUsd, dropUndefined, parseLayer } from '../../packages/mesh-splat/webview/usd.mjs';
import { readPlyHeader } from '../../packages/mesh-splat/webview/ply.mjs';

// Files are served under an https base, as the webview's resource URLs are: three only resolves against http(s) bases.
const ROOT = 'https://fixtures.invalid/';
const WG = new URL('../fixtures/usd/usd-wg/', import.meta.url);
const ISAAC = new URL('../../test-files/usd/isaac/', import.meta.url);
const NUREC = new URL('../../test-files/usd/nurec/', import.meta.url);

async function load(dir, file) {
    const read = async url => new Uint8Array(await readFile(new URL(decodeURIComponent(url.slice(ROOT.length)), dir)));
    const result = await composeUsd(await read(ROOT + file), ROOT + file.replace(/[^/]+$/, ''), read);
    result.group.updateMatrixWorld(true);
    return result;
}

const meshes = group => {
    const found = [];
    group.traverse(object => object.isMesh && found.push(object));
    return found;
};
const shown = object => {
    for (let node = object; node; node = node.parent) if (!node.visible) return false;
    return true;
};
const position = object => object.getWorldPosition(object.position.clone()).toArray().map(v => +v.toFixed(4));
const radius = mesh => {
    mesh.geometry.computeBoundingSphere();
    return +mesh.geometry.boundingSphere.radius.toFixed(4);
};
// Skipped unless the named files were downloaded; the layers they reference are not checked.
const fetched = (dir, ...files) => files.every(file => fs.existsSync(new URL(file, dir))) ? {} : { skip: 'run npm run fixtures:usd first' };

// usd-wg/assets (tests/fixtures/usd/usd-wg/README.md)

test('usd-wg: references, payloads and sublayers resolve from the same, a child and a parent folder', async () => {
    for (const [dir, prefix] of [['references', 'reference'], ['payload', 'payload'], ['subLayer', 'sublayer']]) {
        for (const where of ['same', 'child', 'parent']) {
            const file = `test_assets/foundation/stage_composition/${dir}/${prefix}_${where}_folder.usda`;
            const { group, missing } = await load(WG, file);
            assert.deepEqual(missing, [], file);
            assert.deepEqual(meshes(group).map(({ name }) => name), ['Cube'], file);
        }
    }
});

test('usd-wg: a missing layer is reported and the rest of the stage still renders', async () => {
    for (const file of ['references/reference_invalid', 'payload/payload_invalid', 'subLayer/sublayer_invalid']) {
        const { group, missing } = await load(WG, `test_assets/foundation/stage_composition/${file}.usda`);
        assert.deepEqual(missing, ['file_does_not_exist.usda'], file);
        assert.deepEqual(meshes(group).map(({ name }) => name), ['cube'], file);
    }
    const { group, missing } = await load(WG, 'test_assets/foundation/stage_composition/references_prim/reference_prim_in_other_file.usda');
    assert.deepEqual(missing, ['file_does_not_exist.usda']);
    assert.deepEqual(meshes(group).map(({ name }) => name), ['Cube_with_reference']);
});

test('usd-wg: guide purpose starts hidden', async () => {
    const { group } = await load(WG, 'test_assets/foundation/stage_composition/purpose.usda');
    assert.equal(shown(group.getObjectByName('CubeIsGuide')), false);
    assert.equal(shown(group.getObjectByName('CubeIsRender')), true);
});

test('usd-wg: metersPerUnit scales the stage to meters, from the root layer only', async () => {
    for (const [file, scale] of [['metersPerUnit_1', 1], ['metersPerUnit_10', 10], ['metersPerUnit_mix', 100]]) {
        const { group, metersPerUnit } = await load(WG, `test_assets/foundation/stage_configuration/metersPerUnit/${file}.usda`);
        assert.equal(metersPerUnit, scale, file);
        assert.equal(group.scale.x, scale, file);
        assert.deepEqual(position(group.getObjectByName('X')), [+(1.1 * scale).toFixed(4), 0, 0], file);
    }
});

test('usd-wg: upAxis is reported and the root is left unrotated', async () => {
    for (const axis of ['X', 'Y', 'Z', 'invalid']) {
        const { group, upAxis } = await load(WG, `test_assets/foundation/stage_configuration/upAxis/upAxis_${axis}.usda`);
        assert.equal(upAxis, axis);
        assert.deepEqual(group.rotation.toArray().slice(0, 3), [0, 0, 0]);
    }
});

test('usd-wg: nested and composed xformOps', async () => {
    const nested = await load(WG, 'test_assets/schemaTests/usdGeom/transforms/xforms_nested.usda');
    assert.deepEqual(position(nested.group.getObjectByName('Cube')), [0.0111, 0.0222, 0.0333]);
    const simple = await load(WG, 'test_assets/schemaTests/usdGeom/transforms/simple_transform.usda');
    const mesh = simple.group.getObjectByName('mesh');
    assert.deepEqual(position(mesh), [0.04, 0.05, 0.06]);
    assert.deepEqual(mesh.getWorldScale(mesh.scale.clone()).toArray().map(v => +v.toFixed(4)), [0.01, 0.02, 0.03]);
});

test('usd-wg: matrix transforms and xforms nested under a Scope', async () => {
    const matrix = await load(WG, 'test_assets/schemaTests/usdGeom/transforms/matrix_transform.usda');
    assert.deepEqual(position(matrix.group.getObjectByName('mesh')), [0.04, 0.05, 0.06]);
    const scoped = await load(WG, 'test_assets/schemaTests/usdGeom/transforms/scopes_and_xforms_nested.usda');
    assert.deepEqual(position(scoped.group.getObjectByName('D')), [0.04, 0.05, 0.06]);
    assert.deepEqual(position(scoped.group.getObjectByName('cube')), [0.01, 0.01, 0.01]);
});

// Pivots and offsets in xformOpOrder, the order Maya writes them: the origin lands at T·Trpo·Trp·Rro·R·Trp⁻¹·Tspo·Tsp·H·Sso·S·Tsp⁻¹·0.
test('usd-wg: a Maya-style pivot xformOp stack', async () => {
    const { group } = await load(WG, 'test_assets/schemaTests/usdGeom/transforms/complex_transform.usda');
    const rotate = ([x, y, z]) => new Matrix4().makeRotationFromEuler(new Euler(x * Math.PI / 180, y * Math.PI / 180, z * Math.PI / 180, 'ZYX'));
    const move = ([x, y, z]) => new Matrix4().makeTranslation(x, y, z);
    const expected = [
        move([1, 2, 3]), move([4, 5, 6]), move([7, 8, 9]), rotate([10, 11, 12]), rotate([110, 120, 130]), move([-7, -8, -9]),
        move([1, 2, 3]), move([4, 5, 6]), new Matrix4().set(1, 0, 0, 0, 0.5, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
        new Matrix4().makeScale(7, 8, 9), new Matrix4().makeScale(0.1, 0.2, 0.3), move([-4, -5, -6])
    ].reduce((matrix, step) => matrix.multiply(step), new Matrix4().makeScale(0.01, 0.01, 0.01));
    const origin = new Vector3().applyMatrix4(expected).toArray().map(v => +v.toFixed(4));
    assert.deepEqual(position(group.getObjectByName('mesh')), origin);
});

test('usd-wg: an over that nothing defines is not drawn, and an over on a sublayer prim applies', async () => {
    const { group } = await load(WG, 'test_assets/foundation/stage_composition/over.usda');
    assert.deepEqual(meshes(group).map(({ name }) => name).sort(), ['Cube', 'definedCube']);
    assert.deepEqual(group.getObjectByName('Cube').material.color.toArray(), [0, 0, 0.8]);
});

test('usd-wg: every UsdGeom primitive becomes a mesh', async () => {
    const { group } = await load(WG, 'test_assets/schemaTests/usdGeom/primitives/all_primitives.usda');
    assert.deepEqual(meshes(group).map(({ name }) => name), ['Capsule', 'Cone', 'Cube', 'Cylinder', 'Sphere']);
});

test('usd-wg: inactive prims are not drawn', async () => {
    const { group } = await load(WG, 'test_assets/foundation/stage_composition/active.usda');
    assert.deepEqual(meshes(group).filter(shown).map(({ name }) => name), ['CubeActive']);
});

// Local opinions in the layer stack beat the selected variant (radius 1); a referenced default does not (radius 2).
test('usd-wg: USDA variantSet blocks apply the selected variant below local opinions', async () => {
    for (const [file, expected] of [['VariantSetAndLocal1/puzzle_1', 1], ['VariantSetAndLocal2/puzzle_2', 1], ['VariantSetAndLocal3/puzzle_3', 2]]) {
        const { group } = await load(WG, `docs/CompositionPuzzles/${file}.usda`);
        assert.equal(radius(group.getObjectByName('Sphere')), expected, file);
    }
});

test('usd-wg: displayColor colours primitives', async () => {
    const { group } = await load(WG, 'test_assets/foundation/stage_composition/purpose.usda');
    assert.deepEqual(group.getObjectByName('CubeIsRender').material.color.toArray(), [0, 0.8, 0]);
});

// Known gaps (docs/mesh-splat.md, "Not supported"), kept as todo tests.

test('usd-wg: inherits apply the opinions of a class', { todo: 'inherits are not composed' }, async () => {
    const { group } = await load(WG, 'test_assets/foundation/stage_composition/class_inherit.usda');
    assert.deepEqual(group.getObjectByName('cubeWithoutSetColor').material.color.toArray(), [0, 0.8, 0]);
});

// Across a reference, an inherit sees the referencing stage's override of its source; a specialize stays weaker than local.
test('usd-wg: inherits and specializes across a reference', { todo: 'inherits and specializes are not composed' }, async () => {
    const { group } = await load(WG, 'test_assets/foundation/stage_composition/inherit_and_specialize.usda');
    const referenced = group.getObjectByName('cubeSceneReferenced');
    assert.deepEqual(referenced.getObjectByName('inherits').material.color.toArray(), [0, 0.8, 0]);
    assert.deepEqual(referenced.getObjectByName('specializes').material.color.toArray(), [0.8, 0.8, 0]);
});

// Isaac Sim robots (scripts/fetch-usd-fixtures.mjs)

const ROBOTS = [
    ['4.5/Isaac/Robots/Franka/franka.usd', 11],
    ['5.1/Isaac/Robots/FrankaRobotics/FrankaPanda/franka.usd', 11],
    ['5.1/Isaac/IsaacLab/Robots/FrankaEmika/panda_instanceable.usd', 11],
    ['5.1/Isaac/Robots/Unitree/G1/g1.usd', 49]
];

test('isaac: robots compose Z-up in meters with every layer found and collisions hidden', fetched(ISAAC, ...ROBOTS.map(([file]) => file)), async () => {
    for (const [file, visible] of ROBOTS) {
        const { group, missing, upAxis } = await load(ISAAC, file);
        assert.deepEqual(missing, [], file);
        assert.equal(upAxis, 'Z', file);
        assert.equal(group.scale.x, 1, file);
        assert.equal(meshes(group).filter(shown).length, visible, file);
    }
});

test('isaac: prim types that are not drawn are listed, physics joints included', fetched(ISAAC, '4.5/Isaac/Robots/Franka/franka.usd'), async () => {
    const { notShown } = await load(ISAAC, '4.5/Isaac/Robots/Franka/franka.usd');
    const types = Object.fromEntries(notShown);
    assert.equal(types.PhysicsRevoluteJoint, 7);
    assert.equal(types.PhysicsPrismaticJoint, 2);
    assert.equal(types.Xform, undefined);
});

test('isaac: crate layers carry active = false', fetched(ISAAC, '5.1/Isaac/Robots/FrankaRobotics/FrankaPanda/configuration/franka_Gripper_Robotiq_2F_85.usd'), async () => {
    const { specsByPath } = parseLayer(new Uint8Array(await readFile(new URL('5.1/Isaac/Robots/FrankaRobotics/FrankaPanda/configuration/franka_Gripper_Robotiq_2F_85.usd', ISAAC))));
    assert.equal(specsByPath['/panda/panda_hand/geometry'].fields.active, false);
    assert.equal(dropUndefined({ '/panda': { fields: { typeName: 'Xform', specifier: 0 } }, ...specsByPath })['/panda/panda_hand/geometry'], undefined);
});

test('isaac: OmniPBR materials fall back to their diffuse colour', fetched(ISAAC, '5.1/Isaac/Robots/Unitree/G1/g1.usd'), async () => {
    const { group } = await load(ISAAC, '5.1/Isaac/Robots/Unitree/G1/g1.usd');
    const colours = new Set(meshes(group).filter(shown).map(mesh => [mesh.material].flat()[0]?.color?.getHexString()));
    assert.ok(colours.size > 1, [...colours].join());
});

// NuRec Gaussian scenes (scripts/fetch-usd-fixtures.mjs with HF_TOKEN)

test('nurec: a ParticleField USDZ yields its Gaussians', fetched(NUREC, 'xgrid-wormhole/wormhole.usdz'), async () => {
    const { gaussians, missing } = await load(NUREC, 'xgrid-wormhole/wormhole.usdz');
    assert.deepEqual(missing, []);
    assert.equal(gaussians.length, 1);
});

test('nurec: a stage referencing into a USDZ (a.usdz[b.usd]) yields its Gaussians', fetched(NUREC, 'xgrid-wormhole/stage_particle.usd', 'xgrid-wormhole/stage_particle_with_sim_objects.usd', 'xgrid-wormhole/wormhole.usdz'), async () => {
    const stage = await load(NUREC, 'xgrid-wormhole/stage_particle.usd');
    assert.deepEqual(stage.missing, []);
    assert.equal(stage.gaussians.length, 1);
    // The sim objects live on NVIDIA's internal Nucleus server, so only they are missing.
    const withObjects = await load(NUREC, 'xgrid-wormhole/stage_particle_with_sim_objects.usd');
    assert.ok(withObjects.missing.length && withObjects.missing.every(path => path.startsWith('omniverse://')), withObjects.missing.join());
    assert.equal(withObjects.gaussians.length, 1);
});

test('nurec: a legacy NuRec volume yields its Gaussians', fetched(NUREC, 'zh_lounge/usd/zh_lounge.usda', 'zh_lounge/usd/gauss.usda', 'zh_lounge/usd/export_last.nurec'), async () => {
    const { gaussians, missing, notShown } = await load(NUREC, 'zh_lounge/usd/zh_lounge.usda');
    assert.deepEqual(missing, []);
    assert.deepEqual(notShown, []);
    assert.equal(gaussians.length, 1);
    const header = readPlyHeader(gaussians[0].ply);
    assert.equal(header.elements[0].count, 1000000);
    assert.equal(header.elements[0].properties.length, 59);
    assert.equal(header.headerLength % 4, 0);
    const row = new Float32Array(gaussians[0].ply.buffer, header.headerLength, 59);
    assert.ok(Math.abs(Math.hypot(...row.subarray(55)) - 1) < 1e-3);
});
