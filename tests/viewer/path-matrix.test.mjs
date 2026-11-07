// Every way a URDF / xacro / MJCF file is seen referencing a mesh in the wild.
// Each target has a same-named decoy elsewhere, so a row only passes when the
// path itself resolves, never through the unique-basename fallback.
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveFileFromMap } from '../../src/utils/FileUtils.js';

const KEYS = [
    '/pkg/meshes/a.stl',
    '/pkg/meshes/my part.stl',
    '/pkg/meshes/B.STL',
    '/other/meshes/c.stl',
    '/home/u/outside/d.stl',
    '/model_x/meshes/e.dae',
    '/decoy/meshes/a.stl',
    '/decoy/meshes/my part.stl',
    '/decoy/meshes/B.STL',
    '/decoy/meshes/c.stl',
    '/decoy/outside/d.stl',
    '/decoy/meshes/e.dae'
];
const fileMap = new Map(KEYS.map(key => [key, { key }]));

const ROWS = [
    ['package:// URI', 'package://pkg/meshes/a.stl', '/pkg/urdf/', '/pkg/meshes/a.stl'],
    ['relative to the URDF directory', '../meshes/a.stl', '/pkg/urdf/', '/pkg/meshes/a.stl'],
    ['relative from a URDF at the package root', 'meshes/a.stl', '/pkg/', '/pkg/meshes/a.stl'],
    ['Windows backslashes', '..\\meshes\\a.stl', '/pkg/urdf/', '/pkg/meshes/a.stl'],
    ['extension case differs from the file', 'package://pkg/meshes/b.stl', '/pkg/urdf/', '/pkg/meshes/B.STL'],
    ['space written literally', 'package://pkg/meshes/my part.stl', '/pkg/urdf/', '/pkg/meshes/my part.stl'],
    ['space URL-encoded', 'package://pkg/meshes/my%20part.stl', '/pkg/urdf/', '/pkg/meshes/my part.stl'],
    ['relative path leaving the package', '../../other/meshes/c.stl', '/pkg/urdf/', '/other/meshes/c.stl'],
    ['absolute path', '/home/u/outside/d.stl', '/pkg/urdf/', '/home/u/outside/d.stl'],
    ['file:// URI', 'file:///home/u/outside/d.stl', '/pkg/urdf/', '/home/u/outside/d.stl'],
    ['Gazebo model:// URI', 'model://model_x/meshes/e.dae', '/pkg/urdf/', '/model_x/meshes/e.dae']
];

for (const [name, reference, baseDir, expected] of ROWS) {
    test(`path matrix: ${name}`, () => {
        assert.equal(resolveFileFromMap(reference, fileMap, { baseDir })?.key, expected);
    });
}

// MJCF resolves assets through its <compiler> directories and textual <include>s.
const { DOMParser } = await import('linkedom');
globalThis.DOMParser ??= DOMParser;
globalThis.XMLSerializer ??= class { serializeToString(node) { return node.toString(); } };
const { MJCFAdapter } = await import('../../src/adapters/MJCFAdapter.js');
const mjcfMap = new Map([
    '/robot/mjcf/assets/m.stl', '/robot/mjcf/shared/m.stl', '/robot/mjcf/tex/t.png', '/robot/mjcf/parts/arm.xml',
    '/decoy/assets/m.stl', '/decoy/shared/m.stl', '/decoy/tex/t.png', '/decoy/parts/arm.xml'
].map(key => [key, { key, text: async () => `<mujoco><worldbody><body name="${key.startsWith('/robot') ? 'arm' : 'decoy'}"/></worldbody></mujoco>` }]));
const meshPath = compiler => MJCFAdapter.parseAssets(new DOMParser().parseFromString(`<mujoco>${compiler}<asset><mesh file="m.stl"/></asset></mujoco>`, 'text/xml'), null, null, '/robot/mjcf').get('m').path;

test('path matrix: MJCF meshdir', () => {
    assert.equal(resolveFileFromMap(meshPath('<compiler meshdir="assets"/>'), mjcfMap)?.key, '/robot/mjcf/assets/m.stl');
});

test('path matrix: MJCF assetdir when meshdir is absent', () => {
    assert.equal(resolveFileFromMap(meshPath('<compiler assetdir="shared"/>'), mjcfMap)?.key, '/robot/mjcf/shared/m.stl');
});

test('path matrix: MJCF texturedir', () => {
    assert.equal(resolveFileFromMap(MJCFAdapter.resolveAssetFilePath('t.png', '/robot/mjcf', 'tex'), mjcfMap)?.key, '/robot/mjcf/tex/t.png');
});

test('path matrix: MJCF <include> relative to the including file', async () => {
    const expanded = await MJCFAdapter.processIncludes('<mujoco><include file="parts/arm.xml"/></mujoco>', mjcfMap, '/robot/mjcf');
    assert.match(expanded, /name="arm"/);
    assert.doesNotMatch(expanded, /name="decoy"/);
});
