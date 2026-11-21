import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../packages/urdf-mjcf/', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

// Only the `resourceExtname =~ /…/flags` form is used in this manifest.
function matches(when, extname) {
    const [, source, flags] = when.match(/resourceExtname =~ \/(.+)\/(\w*)$/);
    return new RegExp(source.replace(/\\\\/g, '\\'), flags).test(extname);
}

test('the preview button shows for upper-case extensions too', () => {
    const { when } = manifest.contributes.menus['editor/title'].find(item => item.command === 'robotPreviewUrdf.open');
    for (const ext of ['.urdf', '.URDF', '.xacro', '.Xacro', '.xml', '.XML', '.sdf', '.SDF', '.world']) assert.ok(matches(when, ext), ext);
    for (const ext of ['.urdf.in', '.xyz', '.stl']) assert.ok(!matches(when, ext), ext);
});

test('every menu condition on the extension name ignores case', () => {
    for (const items of Object.values(manifest.contributes.menus)) {
        for (const { when } of items) if (when?.includes('resourceExtname')) assert.match(when, /=~ \/.+\/i$/, when);
    }
});

test('the preview icon has a light and a dark SVG that ship with the package', () => {
    const { icon } = manifest.contributes.commands.find(item => item.command === 'robotPreviewUrdf.open');
    const ignored = fs.readFileSync(path.join(dir, '.vscodeignore'), 'utf8').split('\n').map(line => line.trim());
    for (const file of [icon.light, icon.dark]) {
        assert.match(fs.readFileSync(path.join(dir, file), 'utf8'), /^<svg [^>]*viewBox="0 0 16 16"/);
        assert.ok(!ignored.includes(file), `${file} is left out of the package`);
    }
});
