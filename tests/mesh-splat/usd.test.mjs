import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlyHeader } from '../../packages/mesh-splat/webview/ply.mjs';
import { gaussianPly, composeUsd } from '../../packages/mesh-splat/webview/usd.mjs';

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

test('applyVariants keeps only the selected variant under its prim', async () => {
    const { applyVariants } = await import('../../packages/mesh-splat/webview/usd.mjs');
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
    const { expandArcs } = await import('../../packages/mesh-splat/webview/usd.mjs');
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
    }, async asset => (asset === './geo.usd' ? external : null));
    assert.equal(specs['/Robot/link'].fields.typeName, 'Xform');
    assert.equal(specs['/Robot/link'].fields.references, undefined);
    assert.equal(specs['/Robot/link/mesh'].fields.typeName, 'Mesh');
    assert.deepEqual(specs['/Robot/link/mesh.points'].fields.default, [0, 0, 0]);
    assert.equal(specs['/Robot/base/visuals/link'].fields.typeName, 'Mesh');
});
