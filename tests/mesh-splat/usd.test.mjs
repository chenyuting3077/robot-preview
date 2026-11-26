import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4 } from '../../packages/mesh-splat/node_modules/three/build/three.module.js';
import { readPlyHeader } from '../../packages/mesh-splat/webview/ply.mjs';
import { USDCParser } from '../../packages/mesh-splat/node_modules/three/examples/jsm/loaders/usd/USDCParser.js';
import { USDComposer } from '../../packages/mesh-splat/node_modules/three/examples/jsm/loaders/usd/USDComposer.js';
import { nurecPly, unpack } from '../../packages/mesh-splat/webview/nurec.mjs';
import { gaussianPly, composeUsd, applyVariants, expandArcs, hideGuides, dropUndefined, expandFloat32, triangulateTrisQuads, ArcUSDCParser } from '../../packages/mesh-splat/webview/usd.mjs';

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

test('composeUsd reports a binding to a material that is not on the stage and keeps the default material', async () => {
    const usda = `#usda 1.0
def Xform "World"
{
    def Mesh "Tri" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        rel material:binding = </World/Looks/Gone>
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }
}
`;
    const { group, missingMaterials } = await composeUsd(new TextEncoder().encode(usda));
    assert.deepEqual(missingMaterials, ['/World/Looks/Gone']);
    assert.equal(group.getObjectByName('Tri').material.color.getHexString(), 'ffffff');
    // A primitive bound to a missing material falls back to its displayColor.
    const cube = await composeUsd(new TextEncoder().encode(`#usda 1.0
def Cube "Box" (
    prepend apiSchemas = ["MaterialBindingAPI"]
)
{
    rel material:binding = </Looks/Gone>
    color3f[] primvars:displayColor = [(0, 0.5, 0)]
}
`));
    assert.deepEqual(cube.group.getObjectByName('Box').material.color.toArray(), [0, 0.5, 0]);
});

test('composeUsd reads USDA variantSet blocks with payloads, child prims and overs', async () => {
    const files = {
        'http://x/robot.usda': `#usda 1.0
(
    defaultPrim = "Robot"
)

def Xform "Robot" (
    variants = {
        string Physics = "physics"
    }
    prepend variantSets = "Physics"
)
{
    variantSet "Physics" = {
        "none" {
            def Mesh "Wrong"
            {
            }
        }
        "physics" (
            prepend payload = @./physics.usda@
        ) {
            def Xform "Added"
            {
            }
        }
    }
}

over "Ghost" (
    variants = {
        string v = "a"
    }
    prepend variantSets = "v"
)
{
    variantSet "v" = {
        "a" {
            double radius = 3
        }
    }
}
`,
        'http://x/physics.usda': '#usda 1.0\n(\n    defaultPrim = "Robot"\n)\n\ndef Xform "Robot"\n{\n    def Mesh "Link"\n    {\n        int[] faceVertexCounts = [3]\n        int[] faceVertexIndices = [0, 1, 2]\n        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]\n    }\n}\n'
    };
    const read = async url => new TextEncoder().encode(files[url]);
    const { group, missing } = await composeUsd(await read('http://x/robot.usda'), 'http://x/', read);
    assert.deepEqual(missing, []);
    assert.ok(group.getObjectByName('Link')?.isMesh);
    assert.ok(group.getObjectByName('Added'));
    assert.equal(group.getObjectByName('Wrong'), undefined);
    assert.equal(group.getObjectByName('Ghost'), undefined);
});

test('USDA variants in a referenced layer follow the selection, which the referencing prim can override', async () => {
    const tri = 'int[] faceVertexCounts = [3]\n        int[] faceVertexIndices = [0, 1, 2]\n        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]';
    const files = {
        'http://x/robot.usda': `#usda 1.0
(
    defaultPrim = "Robot"
)
def Xform "Robot" (
    variants = {
        string v = "a"
    }
    prepend variantSets = "v"
)
{
    variantSet "v" = {
        "a" {
            def Mesh "A"
            {
                ${tri}
            }
        }
        "b" {
            def Mesh "B"
            {
                ${tri}
            }
        }
    }
}
`,
        'http://x/scene.usda': '#usda 1.0\ndef Xform "World"\n{\n    def "Kept" (\n        prepend references = @./robot.usda@\n    )\n    {\n    }\n    def "Switched" (\n        prepend references = @./robot.usda@\n        variants = {\n            string v = "b"\n        }\n    )\n    {\n    }\n}\n'
    };
    const read = async url => new TextEncoder().encode(files[url]);
    const { group } = await composeUsd(await read('http://x/scene.usda'), 'http://x/', read);
    const kept = group.getObjectByName('Kept');
    const switched = group.getObjectByName('Switched');
    assert.ok(kept.getObjectByName('A')?.isMesh);
    assert.equal(kept.getObjectByName('B'), undefined);
    assert.ok(switched.getObjectByName('B')?.isMesh);
    assert.equal(switched.getObjectByName('A'), undefined);
});

test('a referenced layer keeps its variant above what that layer itself references', async () => {
    const mesh = x => `def Mesh "Child"\n    {\n        double3 xformOp:translate = (${x}, 0, 0)\n        uniform token[] xformOpOrder = ["xformOp:translate"]\n        int[] faceVertexCounts = [3]\n        int[] faceVertexIndices = [0, 1, 2]\n        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]\n    }`;
    const files = {
        'http://x/part.usda': `#usda 1.0\n(\n    defaultPrim = "P"\n)\ndef Xform "P"\n{\n    ${mesh(1)}\n}\n`,
        'http://x/robot.usda': '#usda 1.0\n(\n    defaultPrim = "R"\n)\ndef Xform "R" (\n    prepend references = @./part.usda@\n    variants = {\n        string v = "x"\n    }\n    prepend variantSets = "v"\n)\n{\n    variantSet "v" = {\n        "x" {\n            over "Child"\n            {\n                double3 xformOp:translate = (5, 0, 0)\n            }\n        }\n    }\n}\n',
        'http://x/scene.usda': '#usda 1.0\ndef Xform "World"\n{\n    def "Robot" (\n        prepend references = @./robot.usda@\n    )\n    {\n    }\n}\n'
    };
    const read = async url => new TextEncoder().encode(files[url]);
    for (const root of ['robot.usda', 'scene.usda']) {
        const { group } = await composeUsd(await read(`http://x/${root}`), 'http://x/', read);
        assert.equal(group.getObjectByName('Child').position.x, 5, root);
    }
});

test('layers that reference each other are composed once around the cycle', async () => {
    const layer = (name, other) => `#usda 1.0\n(\n    defaultPrim = "${name}"\n)\ndef Xform "${name}"\n{\n    def Mesh "M${name}"\n    {\n        int[] faceVertexCounts = [3]\n        int[] faceVertexIndices = [0, 1, 2]\n        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]\n    }\n    def "Next" (\n        prepend references = @./${other}.usda@\n    )\n    {\n    }\n}\n`;
    const files = { 'http://x/a.usda': layer('A', 'b'), 'http://x/b.usda': layer('B', 'a') };
    const read = async url => new TextEncoder().encode(files[url]);
    const { group } = await composeUsd(await read('http://x/a.usda'), 'http://x/', read);
    const meshes = [];
    group.traverse(object => object.isMesh && meshes.push(object.name));
    assert.deepEqual(meshes, ['MA', 'MB', 'MA']);
});

test('a referenced layer\'s own references keep its paths mapped onto the stage and stop at cycles', async () => {
    const tri = '        int[] faceVertexCounts = [3]\n        int[] faceVertexIndices = [0, 1, 2]\n        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]\n';
    const self = name => `#usda 1.0\n(\n    defaultPrim = "${name}"\n)\ndef Xform "${name}"\n{\n    def Mesh "M${name}"\n    {\n${tri}    }\n    def "Again" (\n        prepend references = @./${name.toLowerCase()}.usda@\n    )\n    {\n    }\n}\n`;
    const files = {
        'http://x/robot.usda': `#usda 1.0\n(\n    defaultPrim = "R"\n)\ndef Xform "R"\n{\n    def "Inst" (\n        prepend references = </Lib/Part>\n    )\n    {\n    }\n    def Scope "Looks"\n    {\n        def Material "M"\n        {\n        }\n    }\n}\ndef Scope "Lib"\n{\n    def Xform "Part" (\n        prepend references = [@./b.usda@, @./c.usda@]\n    )\n    {\n        def Mesh "Bound" (\n            prepend apiSchemas = ["MaterialBindingAPI"]\n        )\n        {\n            rel material:binding = </R/Looks/M>\n${tri}        }\n    }\n}\n`,
        'http://x/b.usda': self('B'),
        'http://x/c.usda': self('C'),
        'http://x/scene.usda': '#usda 1.0\ndef Xform "World"\n{\n    def "One" (\n        prepend references = @./robot.usda@\n    )\n    {\n    }\n    def "Two" (\n        prepend references = @./robot.usda@\n    )\n    {\n    }\n}\n'
    };
    const read = async url => new TextEncoder().encode(files[url]);
    const { group, missingMaterials } = await composeUsd(await read('http://x/scene.usda'), 'http://x/', read);
    assert.deepEqual(missingMaterials, []);
    for (const name of ['One', 'Two']) {
        const meshes = [];
        group.getObjectByName(name).traverse(object => object.isMesh && meshes.push(object.name));
        assert.deepEqual(meshes.sort(), ['Bound', 'MB', 'MC'], name);
    }
});

test('arcs authored in the selected variant are stronger than the arcs authored on its prim', async () => {
    const part = x => `#usda 1.0\n(\n    defaultPrim = "P"\n)\ndef Xform "P"\n{\n    def Mesh "C"\n    {\n        double3 xformOp:translate = (${x}, 0, 0)\n        uniform token[] xformOpOrder = ["xformOp:translate"]\n        int[] faceVertexCounts = [3]\n        int[] faceVertexIndices = [0, 1, 2]\n        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]\n    }\n}\n`;
    const robot = (local, variant) => `#usda 1.0\n(\n    defaultPrim = "R"\n)\ndef Xform "R" (\n    prepend ${local} = @./a.usda@\n    variants = {\n        string v = "x"\n    }\n    prepend variantSets = "v"\n)\n{\n    variantSet "v" = {\n        "x" (\n            prepend ${variant} = @./b.usda@\n        ) {\n        }\n    }\n}\n`;
    for (const [local, variant] of [['references', 'references'], ['payload', 'references'], ['references', 'payload']]) {
        const files = { 'http://x/a.usda': part(1), 'http://x/b.usda': part(2), 'http://x/robot.usda': robot(local, variant), 'http://x/scene.usda': '#usda 1.0\ndef Xform "World"\n{\n    def "R" (\n        prepend references = @./robot.usda@\n    )\n    {\n    }\n}\n' };
        const read = async url => new TextEncoder().encode(files[url]);
        for (const root of ['robot.usda', 'scene.usda']) {
            const { group } = await composeUsd(await read(`http://x/${root}`), 'http://x/', read);
            assert.equal(group.getObjectByName('C').position.x, 2, `${variant} over ${local} in ${root}`);
        }
    }
});

test('references within the stage stop at their own prim, an ancestor or a descendant, as usdcat does', async () => {
    const mesh = name => `    def Mesh "${name}"\n    {\n        int[] faceVertexCounts = [3]\n        int[] faceVertexIndices = [0, 1, 2]\n        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]\n    }\n`;
    const stage = `#usda 1.0\ndef Xform "A" (\n    prepend references = </B>\n)\n{\n${mesh('MA')}}\ndef Xform "B"\n{\n${mesh('MB')}    def "C" (\n        prepend references = </A>\n    )\n    {\n    }\n    def "D" (\n        prepend references = </B>\n    )\n    {\n    }\n}\n`;
    const paths = async usda => {
        const { group } = await composeUsd(new TextEncoder().encode(usda), 'http://x/');
        const found = [];
        group.traverse(object => object.isMesh && found.push(`${object.parent.name}/${object.name}`));
        return found.sort();
    };
    const prim = (name, arc, body = '') => `def Xform "${name}"${arc ? ` (\n    prepend references = <${arc}>\n)` : ''}\n{\n${body}}\n`;
    assert.deepEqual(await paths(stage), ['A/MA', 'A/MB', 'B/MB', 'C/MA']);
    // A descendant of the referencing prim; an ancestor of where the arc lands once composed; a chain that comes
    // back to a prim it passed through.
    assert.deepEqual(await paths(`#usda 1.0\n${prim('A', '/A/C', prim('C', '', mesh('MC')))}`), ['C/MC']);
    assert.deepEqual(await paths(`#usda 1.0\n${prim('C', '/X')}${prim('X', '', prim('Y', '', prim('Z', '/C/Y') + mesh('MY')))}`), ['Y/MY', 'Y/MY']);
    assert.deepEqual(await paths(`#usda 1.0\n${prim('A', '/B/C')}${prim('B', '', prim('C', '/D', mesh('MC')) + mesh('MB'))}${prim('D', '', mesh('MD') + prim('E', '/B/C'))}`),
        ['A/MC', 'A/MD', 'B/MB', 'C/MC', 'C/MD', 'D/MD', 'E/MC']);
});

test('a binding to a path outside the referenced prim is dropped, as usdcat does', async () => {
    const files = {
        'http://x/robot.usda': '#usda 1.0\n(\n    defaultPrim = "R"\n)\ndef Xform "R"\n{\n    def Mesh "Body" (\n        prepend apiSchemas = ["MaterialBindingAPI"]\n    )\n    {\n        rel material:binding = </Lib/M>\n        int[] faceVertexCounts = [3]\n        int[] faceVertexIndices = [0, 1, 2]\n        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]\n    }\n}\n',
        'http://x/scene.usda': '#usda 1.0\ndef Xform "World"\n{\n    def "R" (\n        prepend references = @./robot.usda@\n    )\n    {\n    }\n}\ndef Scope "Lib"\n{\n    def Material "M"\n    {\n        token outputs:surface.connect = </Lib/M/S.outputs:surface>\n        def Shader "S"\n        {\n            uniform token info:id = "UsdPreviewSurface"\n            color3f inputs:diffuseColor = (0, 1, 0)\n            token outputs:surface\n        }\n    }\n}\n'
    };
    const read = async url => new TextEncoder().encode(files[url]);
    const { group } = await composeUsd(await read('http://x/scene.usda'), 'http://x/', read);
    assert.notDeepEqual(group.getObjectByName('Body').material.color.toArray(), [0, 1, 0]);
});

test('USDA bools authored as 0 or false switch OmniPBR emission and opacity, and NuRec volumes, off', async () => {
    const stage = on => `#usda 1.0
def Xform "World"
{
    def Mesh "Tri" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        rel material:binding = </World/Looks/M>
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }
    def Scope "Looks"
    {
        def Material "M"
        {
            token outputs:mdl:surface.connect = </World/Looks/M/Shader.outputs:out>
            def Shader "Shader"
            {
                uniform token info:implementationSource = "sourceAsset"
                uniform asset info:mdl:sourceAsset = @OmniPBR.mdl@
                uniform token info:mdl:sourceAsset:subIdentifier = "OmniPBR"
                bool inputs:enable_emission = ${on}
                color3f inputs:emissive_color = (1, 0, 0)
                bool inputs:enable_opacity = ${on}
                float inputs:opacity_constant = 0.5
                token outputs:out
            }
        }
    }
    def Volume "Gauss"
    {
        custom bool omni:nurec:isNuRecVolume = ${on}
        def OmniNuRecFieldAsset "density"
        {
            asset filePath = @./scene.nurec@
        }
    }
}
`;
    for (const [on, enabled] of [['0', false], ['false', false], ['1', true], ['true', true]]) {
        const { group, missing } = await composeUsd(new TextEncoder().encode(stage(on)), 'http://x/');
        const { material } = group.getObjectByName('Tri');
        assert.deepEqual(material.emissive.toArray(), enabled ? [1, 0, 0] : [0, 0, 0], on);
        assert.equal(material.transparent, enabled, on);
        assert.deepEqual(missing, enabled ? ['scene.nurec'] : [], on);
    }
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

test('triangulateTrisQuads matches three for triangles and quads, and leaves the rest to it', () => {
    const indices = [0, 1, 2, 3, 4, 5, 6, 1, 7, 8];
    const counts = [4, 3, 3];
    const three = USDComposer.prototype._triangulateIndicesWithPattern.call(new USDComposer(), indices, counts);
    const fast = triangulateTrisQuads(indices, counts);
    assert.deepEqual(Array.from(fast.indices), three.indices);
    assert.deepEqual(Array.from(fast.pattern), three.pattern);
    assert.equal(triangulateTrisQuads([0, 1, 2, 3, 4], [5]), null);
    assert.equal(triangulateTrisQuads([0, 1, 2], [4]), null);
    assert.equal(triangulateTrisQuads([0, -1, 2], [3]), null);
});

test('unpack reads the MessagePack NuRec uses', () => {
    const bytes = Uint8Array.from([0x83, 0xa1, 0x61, 0x93, 0x01, 0xff, 0xa1, 0x78, 0xa1, 0x62, 0xc4, 0x02, 0x05, 0x06, 0xa1, 0x63, 0xcb, 0x3f, 0xf8, 0, 0, 0, 0, 0, 0]);
    const value = unpack(bytes);
    assert.deepEqual(value.a, [1, -1, 'x']);
    assert.deepEqual([...value.b], [5, 6]);
    assert.equal(value.c, 1.5);
});

test('nurecPly copies raw 3DGUT parameters and regroups SH by channel', () => {
    const half = values => new Uint8Array(Uint16Array.from(values, v => ({ 0: 0, 1: 0x3c00, 2: 0x4000, 3: 0x4200, 4: 0x4400, 5: 0x4500, 6: 0x4600, [-1]: 0xbc00 })[v]).buffer);
    const tensor = (name, values, shape) => ({ [`.gaussians_nodes.gaussians.${name}`]: half(values), [`.gaussians_nodes.gaussians.${name}.shape`]: shape });
    const ply = nurecPly({ nre_data: { state_dict: {
        ...tensor('positions', [1, 2, 3], [1, 3]),
        ...tensor('rotations', [0, 0, 0, 2], [1, 4]),
        ...tensor('scales', [-1, -1, -1], [1, 3]),
        ...tensor('densities', [2], [1, 1]),
        ...tensor('features_albedo', [4, 5, 6], [1, 3]),
        ...tensor('features_specular', [1, 2, 3, 4, 5, 6], [1, 6])
    } } });
    const header = readPlyHeader(ply);
    assert.equal(header.headerLength % 4, 0);
    const [row] = rows(ply);
    assert.deepEqual([row.x, row.y, row.z, row.f_dc_0, row.f_dc_2], [1, 2, 3, 4, 6]);
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(i => row[`f_rest_${i}`]), [1, 4, 2, 5, 3, 6]);
    assert.deepEqual([row.opacity, row.scale_0], [2, -1]);
    assert.deepEqual([row.rot_0, row.rot_1, row.rot_2, row.rot_3], [0, 0, 0, 1]);
});

test('a stage light does not light the view and is listed as not shown', async () => {
    const usda = '#usda 1.0\ndef Cube "Box"\n{\n}\ndef SphereLight "Lamp"\n{\n    float inputs:intensity = 30000\n}\n';
    const { group, notShown } = await composeUsd(new TextEncoder().encode(usda));
    const lit = [];
    group.traverse(object => object.isLight && object.intensity > 0 && lit.push(object.name));
    assert.deepEqual(lit, []);
    assert.deepEqual(notShown, [['SphereLight', 1]]);
});
