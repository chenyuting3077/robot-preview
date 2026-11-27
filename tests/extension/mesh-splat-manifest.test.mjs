import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { customEditors, commands, menus } = JSON.parse(fs.readFileSync(new URL('../../packages/mesh-splat/package.json', import.meta.url), 'utf8')).contributes;
const patterns = priority => customEditors.filter(editor => editor.priority === priority).flatMap(editor => editor.selector.map(s => s.filenamePattern));

test('.bin, map .yaml / .yml and text formats people edit open only on request, so those files keep their editor', () => {
    assert.deepEqual(patterns('option').sort(), ['*.asc', '*.bin', '*.dae', '*.gltf', '*.obj', '*.wrl', '*.xyz', '*.yaml', '*.yml']);
    assert.ok(!patterns('default').some(pattern => /^\*\.(bin|asc|ya?ml|obj|gltf|dae|wrl|xyz)$/.test(pattern)));
});

test('an OBJ, glTF, DAE or VRML editor has a title button and an Explorer entry that open the 3D preview', () => {
    const { icon } = commands.find(({ command }) => command === 'robotPreviewMeshSplat.open3D');
    assert.deepEqual(icon, commands.find(({ command }) => command === 'robotPreviewMeshSplat.openAsPoints').icon);
    for (const place of ['editor/title', 'explorer/context']) {
        const item = menus[place].find(({ command }) => command === 'robotPreviewMeshSplat.open3D');
        assert.ok(item, place);
        const shownFor = ext => new RegExp(item.when.match(/resourceExtname =~ \/(.*)\/i/)[1], 'i').test(ext);
        for (const ext of ['.obj', '.OBJ', '.gltf', '.dae', '.wrl']) assert.ok(shownFor(ext), `${place}: ${ext}`);
        for (const ext of ['.glb', '.stl', '.xyz', '.bin']) assert.ok(!shownFor(ext), `${place}: ${ext}`);
    }
});

test('a nuScenes .pcd.bin opens in the viewer by default: no other file is named that way', () => {
    assert.ok(patterns('default').includes('*.pcd.bin'));
});

test('a .bin, .asc or .xyz editor has a title button and an Explorer entry that open it as points', () => {
    // Its own icon, drawn from this extension's (a mesh triangle and a splat), in the URDF button's style; not a
    // codicon shared with other extensions, nor the URDF one.
    const { icon } = commands.find(({ command }) => command === 'robotPreviewMeshSplat.openAsPoints');
    for (const theme of ['light', 'dark']) {
        const own = fs.readFileSync(new URL(`../../packages/mesh-splat/${icon[theme]}`, import.meta.url), 'utf8');
        assert.match(own, /viewBox="0 0 16 16"/, theme);
        assert.notEqual(own, fs.readFileSync(new URL(`../../packages/urdf-mjcf/images/preview-${theme}.svg`, import.meta.url), 'utf8'), theme);
    }
    for (const place of ['editor/title', 'explorer/context']) {
        const item = menus[place].find(({ command }) => command === 'robotPreviewMeshSplat.openAsPoints');
        assert.ok(item, place);
        const shownFor = ext => new RegExp(item.when.match(/resourceExtname =~ \/(.*)\/i/)[1], 'i').test(ext);
        assert.ok(shownFor('.bin') && shownFor('.BIN') && shownFor('.asc') && shownFor('.xyz') && !shownFor('.yaml') && !shownFor('.obj') && !shownFor('.pcd'), `${place}: ${item.when}`);
    }
});

test('a .pgm, a .las and a .laz open in the viewer by default', () => {
    for (const pattern of ['*.pgm', '*.las', '*.laz']) assert.ok(patterns('default').includes(pattern), pattern);
});

test('Add to Point Cloud View shows on files the view takes, not on folders, YAML or STEP', () => {
    const item = menus['explorer/context'].find(({ command }) => command === 'robotPreviewMeshSplat.addToView');
    assert.ok(item && /!explorerResourceIsFolder/.test(item.when), item?.when);
    const shownFor = ext => new RegExp(item.when.match(/resourceExtname =~ \/(.*)\/i/)[1], 'i').test(ext);
    for (const ext of ['.pcd', '.PLY', '.bin', '.splat', '.pgm', '.stl', '.las', '.LAZ']) assert.ok(shownFor(ext), ext);
    for (const ext of ['.yaml', '.step', '.igs', '.txt', '.pcdx']) assert.ok(!shownFor(ext), ext);
});
