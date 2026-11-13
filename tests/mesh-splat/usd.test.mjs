import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4 } from '../../packages/mesh-splat/node_modules/three/build/three.module.js';
import { readPlyHeader } from '../../packages/mesh-splat/webview/ply.mjs';
import { USDCParser } from '../../packages/mesh-splat/node_modules/three/examples/jsm/loaders/usd/USDCParser.js';
import { gaussianPly, composeUsd, applyVariants, expandArcs, hideGuides, dropUndefined, expandFloat32, ArcUSDCParser } from '../../packages/mesh-splat/webview/usd.mjs';

function rows(ply) {
    const header = readPlyHeader(ply);
    const names = header.elements[0].properties.map(({ name }) => name);
    const view = new DataView(ply.buffer, header.headerLength);
    return Array.from({ length: header.elements[0].count }, (_, i) =>
        Object.fromEntries(names.map((name, k) => [name, view.getFloat32((i * names.length + k) * 4, true)])));
}

test('gaussianPly writes 3DGS PLY fields from a ParticleField3DGaussianSplat', () => {
    const at = (name, value) => [`/G.${name}`, { fields: { default: value } }];
    const sh = Float32Array.from({ length: 2 * 4 * 3 }, (_, i) => i);
    const specs = Object.fromEntries([
        at('positions', new Float32Array([1, 2, 3, 4, 5, 6])),
        at('orientations', new Float32Array([0.1, 0.2, 0.3, 0.9, 0, 0, 0, 1])),
        at('scales', new Float32Array([1, Math.E, 0.5, 1, 1, 1])),
        at('opacities', new Float32Array([0.5, 0.75])),
        at('radiance:sphericalHarmonicsCoefficients', sh)
    ]);
    const [first, second] = rows(gaussianPly(specs, '/G'));
    assert.deepEqual([first.x, first.y, first.z], [1, 2, 3]);
    assert.deepEqual([first.f_dc_0, first.f_dc_1, first.f_dc_2], [0, 1, 2]);
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => first[`f_rest_${i}`]), [3, 6, 9, 4, 7, 10, 5, 8, 11]);
    assert.equal(first.opacity, 0);
    assert.ok(Math.abs(second.opacity - Math.log(3)) < 1e-6);
    assert.ok(Math.abs(first.scale_1 - 1) < 1e-6);
    assert.deepEqual([first.rot_0, first.rot_1, first.rot_2, first.rot_3].map(v => +v.toFixed(3)), [0.9, 0.1, 0.2, 0.3]);
    assert.equal(second.f_dc_0, 12);
});

test('gaussianPly falls back to displayColor without SH', () => {
    const specs = {
        '/G.positions': { fields: { default: [0, 0, 0] } },
        '/G.primvars:displayColor': { fields: { default: [0.5, 0.5, 0.5] } }
    };
    const [row] = rows(gaussianPly(specs, '/G'));
    assert.equal(row.f_dc_0, 0);
    assert.equal(row.rot_0, 1);
    assert.equal(rows(gaussianPly(specs, '/G')).length, 1);
    assert.equal(gaussianPly({}, '/G'), null);
});

test('composeUsd hides invisible prims and finds particle fields', async () => {
    const usda = `#usda 1.0
def Xform "World"
{
    def Mesh "Shown"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }
    def Mesh "Hidden"
    {
        token visibility = "invisible"
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }
    def ParticleField3DGaussianSplat "Splats"
    {
        point3f[] positions = [(0, 0, 0)]
    }
}
`;
    const { group, gaussians } = await composeUsd(new TextEncoder().encode(usda));
    assert.equal(group.getObjectByName('Shown').visible, true);
    assert.equal(group.getObjectByName('Hidden').visible, false);
    assert.deepEqual(gaussians.map(({ object }) => object.name), ['Splats']);
});

test('composeUsd follows references and merges sublayers with overs', async () => {
    const files = {
        'http://x/a/root.usda': '#usda 1.0\ndef Xform "World"\n{\n    def Xform "Part" (\n        add references = @./part/part.usda@\n    )\n    {\n    }\n}\n',
        'http://x/a/part/part.usda': '#usda 1.0\n(\n    defaultPrim = "Part"\n    subLayers = [\n        @./look.usda@,\n        @./geom/geom.usda@\n    ]\n)\n',
        'http://x/a/part/look.usda': '#usda 1.0\nover "Part"\n{\n    over "Tri"\n    {\n        token visibility = "invisible"\n    }\n}\n',
        'http://x/a/part/geom/geom.usda': '#usda 1.0\ndef Xform "Part"\n{\n    def Mesh "Tri"\n    {\n        int[] faceVertexCounts = [3]\n        int[] faceVertexIndices = [0, 1, 2]\n        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]\n    }\n}\n'
    };
    const read = async url => {
        if (!(url in files)) throw new Error(`404 ${url}`);
        return new TextEncoder().encode(files[url]);
    };
    const { group, missing } = await composeUsd(await read('http://x/a/root.usda'), 'http://x/a/', read);
    assert.deepEqual(missing, []);
    const tri = group.getObjectByName('Tri');
    assert.ok(tri?.isMesh);
    assert.equal(tri.visible, false);
    const { missing: lost } = await composeUsd(new TextEncoder().encode('#usda 1.0\ndef Xform "A" (\n    references = @./none.usda@\n)\n{\n}\n'), 'http://x/a/', read);
    assert.deepEqual(lost, ['none.usda']);
});

test('applyVariants keeps only the selected variant under its prim', () => {
    const specs = applyVariants({
        '/R': { specType: 1, fields: { typeName: 'Xform', variantSelection: { Physics: 'On' } } },
        '/R/{Physics=On}': { specType: 1, fields: { payload: '@./on.usd@' } },
        '/R/{Physics=Off}': { specType: 1, fields: { payload: '@./off.usd@' } },
        '/R/{Physics=On}/Link': { specType: 1, fields: { typeName: 'Mesh' } },
        '/R/{Physics=Off}/Other': { specType: 1, fields: { typeName: 'Mesh' } }
    });
    assert.equal(specs['/R'].fields.payload, '@./on.usd@');
    assert.equal(specs['/R'].fields.typeName, 'Xform');
    assert.equal(specs['/R/Link'].fields.typeName, 'Mesh');
    assert.equal(specs['/R/Other'], undefined);
});

test('expandArcs copies internal and external reference targets', async () => {
    const external = {
        '/': { specType: 1, fields: { defaultPrim: 'Lib' } },
        '/Lib': { specType: 1, fields: { typeName: 'Scope' } },
        '/Lib/visuals/link': { specType: 1, fields: { typeName: 'Mesh' } }
    };
    const specs = await expandArcs({
        '/Robot/link': { specType: 1, fields: { typeName: 'Xform', references: ['@@</Prototypes/link>, @./geo.usd@</Lib/visuals/link>'] } },
        '/Robot/base': { specType: 1, fields: { typeName: 'Xform', payload: '@./geo.usd@' } },
        '/Prototypes/link/mesh': { specType: 1, fields: { typeName: 'Mesh' } },
        '/Prototypes/link/mesh.points': { specType: 2, fields: { default: [0, 0, 0] } }
    }, async asset => (asset === './geo.usd' ? { specs: external, url: 'http://x/geo.usd' } : null));
    assert.equal(specs['/Robot/link'].fields.typeName, 'Xform');
    assert.equal(specs['/Robot/link'].fields.references, undefined);
    assert.equal(specs['/Robot/link/mesh'].fields.typeName, 'Mesh');
    assert.deepEqual(specs['/Robot/link/mesh.points'].fields.default, [0, 0, 0]);
    assert.equal(specs['/Robot/base/visuals/link'].fields.typeName, 'Mesh');
});

test('expandArcs relocates material bindings and honours variant selections from the referencing prim', async () => {
    const asset = {
        '/': { specType: 1, fields: { defaultPrim: 'Part' } },
        '/Part': { specType: 1, fields: { typeName: 'Xform', variantSelection: { Look: 'Red' } } },
        '/Part/{Look=Red}/Mesh': { specType: 1, fields: { typeName: 'Mesh' } },
        '/Part/{Look=Blue}/Mesh': { specType: 1, fields: { typeName: 'Cube' } },
        '/Part/Mesh.material:binding': { specType: 1, fields: { targetPaths: ['/Part/Looks/Mat'] } }
    };
    const specs = await expandArcs({
        '/World/A': { specType: 1, fields: { typeName: 'Xform', references: [{ assetPath: './part.usd' }], variantSelection: { Look: 'Blue' } } }
    }, async () => ({ specs: asset, url: 'http://x/part.usd' }));
    assert.equal(specs['/World/A/Mesh'].fields.typeName, 'Cube');
    assert.deepEqual(specs['/World/A/Mesh.material:binding'].fields.targetPaths, ['/World/A/Looks/Mat']);
});

test('hideGuides marks guide prims invisible instead of removing them', () => {
    const specs = hideGuides({
        '/R/collider': { specType: 1, fields: { typeName: 'Cube' } },
        '/R/collider.purpose': { specType: 1, fields: { typeName: 'token', default: 'guide' } }
    });
    assert.equal(specs['/R/collider'].fields.typeName, 'Cube');
    assert.equal(specs['/R/collider.visibility'].fields.default, 'invisible');
});

test('dropUndefined removes over and class prims that no layer defines', () => {
    const specs = dropUndefined({
        '/R': { specType: 1, fields: { typeName: 'Xform', specifier: 0 } },
        '/R/gripper': { specType: 1, fields: { specifier: 1 } },
        '/R/gripper/joint': { specType: 1, fields: { specifier: 1 } },
        '/R/gripper/joint.state': { specType: 1, fields: { default: 0 } },
        '/__class__': { specType: 1, fields: { specifier: 2 } }
    });
    assert.deepEqual(Object.keys(specs), ['/R']);
});

test('xformOps with suffixes, any rotation order and !invert! are applied', async () => {
    const usda = `#usda 1.0
def Xform "A"
{
    double3 xformOp:translate = (1, 0, 0)
    float xformOp:rotateZ:joint = 90
    double3 xformOp:translate:pivot = (0, 2, 0)
    float3 xformOp:rotateXZY = (30, 40, 50)
    uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateZ:joint", "xformOp:translate:pivot", "xformOp:rotateXZY", "!invert!xformOp:translate:pivot"]
}
`;
    const { group } = await composeUsd(new TextEncoder().encode(usda));
    const a = group.getObjectByName('A');
    const deg = Math.PI / 180;
    const pivot = new Matrix4().makeTranslation(0, 2, 0);
    const expected = new Matrix4().makeTranslation(1, 0, 0)
        .multiply(new Matrix4().makeRotationZ(90 * deg))
        .multiply(pivot)
        .multiply(new Matrix4().makeRotationY(40 * deg))
        .multiply(new Matrix4().makeRotationZ(50 * deg))
        .multiply(new Matrix4().makeRotationX(30 * deg))
        .multiply(pivot.clone().invert());
    a.updateMatrix();
    a.matrix.elements.forEach((value, i) => assert.ok(Math.abs(value - expected.elements[i]) < 1e-5, `element ${i}`));
});

test('expandFloat32 gives the values three expands to, and null for an index out of range', () => {
    const data = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const expanded = (values, indices, size) => Array.from(indices, index => Array.from({ length: size }, (_, j) => values[index * size + j])).flat();
    assert.deepEqual(Array.from(expandFloat32(data, [1, 0, 1], 3)), expanded(data, [1, 0, 1], 3));
    assert.deepEqual(Array.from(expandFloat32(data, new Int32Array([2, 0]), 2)), expanded(data, [2, 0], 2));
    assert.equal(expandFloat32(data, [2], 3), null);
    assert.equal(expandFloat32(data, [-1], 3), null);
});

function crateReader(buffer, offset) {
    const view = new DataView(buffer);
    return {
        buffer, view, offset,
        readUint32() { this.offset += 4; return view.getUint32(this.offset - 4, true); },
        readUint64() { this.offset += 8; return Number(view.getBigUint64(this.offset - 8, true)); },
        readFloat32() { this.offset += 4; return view.getFloat32(this.offset - 4, true); }
    };
}

// [typeEnum, components]: Float, Quatf, Vec2f, Vec3f, Vec4f.
for (const [type, components] of [[8, 1], [17, 4], [20, 2], [24, 3], [28, 4]]) {
    for (const version of [{ major: 0, minor: 8 }, { major: 0, minor: 6 }]) {
        test(`float array type ${type} (crate 0.${version.minor}) reads as three reads it, from an unaligned offset`, () => {
            const count = 5;
            const sizeBytes = version.minor < 7 ? 4 : 8;
            const start = 3;
            const buffer = new ArrayBuffer(start + sizeBytes + count * components * 4 + 7);
            const view = new DataView(buffer);
            if (sizeBytes === 4) view.setUint32(start, count, true);
            else view.setBigUint64(start, BigInt(count), true);
            for (let i = 0; i < count * components; i++) view.setFloat32(start + sizeBytes + i * 4, i * 0.37 - 2.5, true);
            const parser = () => Object.assign(Object.create(ArcUSDCParser.prototype), { buffer, version, reader: crateReader(buffer, start) });
            const rep = { typeEnum: type, isCompressed: false };
            const ours = parser();
            const theirs = parser();
            const values = ours._readArrayValue(rep);
            const expected = USDCParser.prototype._readArrayValue.call(theirs, rep);
            assert.ok(values instanceof Float32Array);
            assert.deepEqual(Array.from(values), Array.from(expected));
            assert.equal(ours.reader.offset, theirs.reader.offset);
        });
    }
}

test('a float array running past the end of the file fails as it does in three', () => {
    const buffer = new ArrayBuffer(16);
    new DataView(buffer).setBigUint64(0, 100n, true);
    const parser = Object.assign(Object.create(ArcUSDCParser.prototype), { buffer, version: { major: 0, minor: 8 }, reader: crateReader(buffer, 0) });
    assert.throws(() => parser._readArrayValue({ typeEnum: 24, isCompressed: false }), RangeError);
});

test('composeUsd reports upAxis and leaves the root unrotated', async () => {
    const usda = up => new TextEncoder().encode(`#usda 1.0\n(\n${up}\n)\ndef Xform "World"\n{\n}\n`);
    const zUp = await composeUsd(usda('    upAxis = "Z"'));
    assert.equal(zUp.upAxis, 'Z');
    assert.equal(zUp.group.rotation.x, 0);
    assert.equal((await composeUsd(usda('    upAxis = "Y"'))).upAxis, 'Y');
    assert.equal((await composeUsd(usda(''))).upAxis, undefined);
});
