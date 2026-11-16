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
