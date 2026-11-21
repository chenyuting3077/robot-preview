import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { customEditors } = JSON.parse(fs.readFileSync(new URL('../../packages/mesh-splat/package.json', import.meta.url), 'utf8')).contributes;
const patterns = priority => customEditors.filter(editor => editor.priority === priority).flatMap(editor => editor.selector.map(s => s.filenamePattern));

test('.bin and map .yaml / .yml open only through Reopen Editor With, so other binaries and YAML keep their editor', () => {
    assert.deepEqual(patterns('option').sort(), ['*.asc', '*.bin', '*.yaml', '*.yml']);
    assert.ok(!patterns('default').some(pattern => /bin|asc|ya?ml/.test(pattern)));
});

test('a .pgm opens in the viewer by default', () => {
    assert.ok(patterns('default').includes('*.pgm'));
});
