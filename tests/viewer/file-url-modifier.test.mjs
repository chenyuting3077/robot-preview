import test from 'node:test';
import assert from 'node:assert/strict';
import { fileUrlModifier } from '../../src/utils/FileUtils.js';

const files = new Map([
    ['/robot_b/meshes/tip.bin', new File(['bin'], 'tip.bin')],
    ['/robot_b/meshes/tex.png', new File(['png'], 'tex.png')]
]);
const modify = fileUrlModifier(files, '/robot_a/urdf');

test('real blob URLs pass through', () => {
    assert.equal(modify('blob:http://host/123e4567-e89b'), 'blob:http://host/123e4567-e89b');
});

test('blob URLs carrying a sent file name resolve to that file', () => {
    const url = modify('blob:vscode-webview://abc/tip.bin');
    assert.match(url, /^blob:/);
    assert.notEqual(url, 'blob:vscode-webview://abc/tip.bin');
});

test('package paths resolve and unknown paths are left alone', () => {
    assert.match(modify('package://robot_b/meshes/tex.png'), /^blob:/);
    assert.equal(modify('package://robot_b/meshes/missing.stl'), 'package://robot_b/meshes/missing.stl');
});
