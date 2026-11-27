// Real robots expanded by the viewer must match ROS 2 xacro's own output (tests/fixtures/xacro/generate-golden.sh).
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageFiles as filesIn, assertSameUrdf } from './urdf-compare.mjs';

const { XacroAdapter } = await import('../../src/adapters/XacroAdapter.js');
const fixtures = fileURLToPath(new URL('../fixtures/xacro/', import.meta.url));
const packageFiles = name => filesIn(path.join(fixtures, name), name);

test('UR5e from ur_description 4.4.1 expands like ROS 2 xacro', async () => {
    const files = packageFiles('ur_description');
    const primary = '/ur_description/urdf/ur.urdf.xacro';
    const urdf = await XacroAdapter.expand(await files.get(primary).text(), primary, files, { args: { ur_type: 'ur5e', name: 'ur5e' } });
    assertSameUrdf(urdf, fs.readFileSync(path.join(fixtures, 'ur5e.urdf'), 'utf8'));
});

test('FR3 from franka_description 2.9.0 expands like ROS 2 xacro', async () => {
    const files = packageFiles('franka_description');
    const primary = '/franka_description/robots/fr3/fr3.urdf.xacro';
    const urdf = await XacroAdapter.expand(await files.get(primary).text(), primary, files);
    assertSameUrdf(urdf, fs.readFileSync(path.join(fixtures, 'fr3.urdf'), 'utf8'));
});
