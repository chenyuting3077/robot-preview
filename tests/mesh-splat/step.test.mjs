import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepLengthUnit } from '../../packages/mesh-splat/webview/step.mjs';

test('reads SI length units with and without a prefix', () => {
    assert.equal(stepLengthUnit("#5=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );\n#6=( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );"), 1e-3);
    assert.equal(stepLengthUnit('#5=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));'), 1);
});

test('reads inch assemblies', () => {
    assert.equal(stepLengthUnit("#7=(CONVERSION_BASED_UNIT('INCH',#8)LENGTH_UNIT()NAMED_UNIT(#9));"), 0.0254);
});

test('gives up on missing, unknown or mixed units', () => {
    assert.equal(stepLengthUnit('#1=CARTESIAN_POINT(\'\',(0.,0.,0.));'), null);
    assert.equal(stepLengthUnit("#7=(CONVERSION_BASED_UNIT('FURLONG',#8)LENGTH_UNIT()NAMED_UNIT(#9));"), null);
    assert.equal(stepLengthUnit('#5=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n#15=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));'), null);
});

test('only units the context assigns count', () => {
    assert.equal(stepLengthUnit('#10=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNIT_ASSIGNED_CONTEXT((#11,#13))REPRESENTATION_CONTEXT(\'\',\'3D\'));\n#11=(\nLENGTH_UNIT()\nNAMED_UNIT(*)\nSI_UNIT(.MILLI.,.METRE.)\n);\n#12=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));\n#13=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));'), 1e-3);
});

test('the same unit declared twice is still one unit', () => {
    assert.equal(stepLengthUnit('#5=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n#15=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));'), 1e-3);
});

test('groupByColor sorts triangles into one group per face color', async () => {
    const { groupByColor } = await import('../../packages/mesh-splat/webview/step.mjs');
    const colors = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const indices = new Uint32Array([0, 1, 2, 3, 4, 5, 2, 1, 0]);
    const { indices: sorted, groups } = groupByColor(colors, indices);
    assert.deepEqual([...sorted], [0, 1, 2, 2, 1, 0, 3, 4, 5]);
    assert.deepEqual(groups, [{ color: [1, 0, 0], start: 0, count: 6 }, { color: [0, 0, 1], start: 6, count: 3 }]);
    assert.equal(groupByColor(colors, indices.subarray(0, 3)).indices.length, 3);
});

test('mergeMeshes offsets each share by the vertices before it', async () => {
    const { mergeMeshes } = await import('../../packages/mesh-splat/webview/step.mjs');
    const share = n => ({ positions: new Float32Array(9).fill(n), normals: new Float32Array(9), colors: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) });
    const merged = mergeMeshes([share(1), share(2)]);
    assert.deepEqual([...merged.indices], [0, 1, 2, 3, 4, 5]);
    assert.deepEqual([...merged.positions.subarray(8, 10)], [1, 2]);
});
