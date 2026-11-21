import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { customEditors, commands, menus } = JSON.parse(fs.readFileSync(new URL('../../packages/mesh-splat/package.json', import.meta.url), 'utf8')).contributes;
const patterns = priority => customEditors.filter(editor => editor.priority === priority).flatMap(editor => editor.selector.map(s => s.filenamePattern));

test('.bin and map .yaml / .yml open only through Reopen Editor With, so other binaries and YAML keep their editor', () => {
    assert.deepEqual(patterns('option').sort(), ['*.asc', '*.bin', '*.yaml', '*.yml']);
    assert.ok(!patterns('default').some(pattern => /^\*\.(bin|asc|ya?ml)$/.test(pattern)));
});

test('a nuScenes .pcd.bin opens in the viewer by default: no other file is named that way', () => {
    assert.ok(patterns('default').includes('*.pcd.bin'));
});

test('a .bin or .asc editor has a title button and an Explorer entry that open it as points', () => {
    // The same icon as the URDF preview button, not a codicon shared with other extensions.
    const { icon } = commands.find(({ command }) => command === 'robotPreviewMeshSplat.openAsPoints');
    for (const theme of ['light', 'dark']) {
        const own = fs.readFileSync(new URL(`../../packages/mesh-splat/${icon[theme]}`, import.meta.url), 'utf8');
        assert.equal(own, fs.readFileSync(new URL(`../../packages/urdf-mjcf/images/preview-${theme}.svg`, import.meta.url), 'utf8'), theme);
    }
    for (const place of ['editor/title', 'explorer/context']) {
        const item = menus[place].find(({ command }) => command === 'robotPreviewMeshSplat.openAsPoints');
        assert.ok(item, place);
        const shownFor = ext => new RegExp(item.when.match(/resourceExtname =~ \/(.*)\/i/)[1], 'i').test(ext);
        assert.ok(shownFor('.bin') && shownFor('.BIN') && shownFor('.asc') && !shownFor('.yaml') && !shownFor('.pcd'), `${place}: ${item.when}`);
    }
});

test('a .pgm opens in the viewer by default', () => {
    assert.ok(patterns('default').includes('*.pgm'));
});

test('Add to Point Cloud View shows on files the view takes, not on folders, YAML or STEP', () => {
    const item = menus['explorer/context'].find(({ command }) => command === 'robotPreviewMeshSplat.addToView');
    assert.ok(item && /!explorerResourceIsFolder/.test(item.when), item?.when);
    const shownFor = ext => new RegExp(item.when.match(/resourceExtname =~ \/(.*)\/i/)[1], 'i').test(ext);
    for (const ext of ['.pcd', '.PLY', '.bin', '.splat', '.pgm', '.stl']) assert.ok(shownFor(ext), ext);
    for (const ext of ['.yaml', '.step', '.igs', '.txt', '.pcdx']) assert.ok(!shownFor(ext), ext);
});
