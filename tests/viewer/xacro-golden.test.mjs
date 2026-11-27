// Real robots expanded by the viewer must match ROS 2 xacro's own output (tests/fixtures/xacro/generate-golden.sh).
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageFiles as filesIn, assertSameUrdf } from './urdf-compare.mjs';

const { XacroAdapter } = await import('../../src/adapters/XacroAdapter.js');
const fixtures = fileURLToPath(new URL('../fixtures/xacro/', import.meta.url));
const packageFiles = name => filesIn(path.join(fixtures, name), name);

// [robot, primary file, golden, xacro arguments, other packages it includes]
const ROBOTS = [
    ['UR5e from ur_description 4.4.1', 'ur_description/urdf/ur.urdf.xacro', 'ur5e.urdf', { ur_type: 'ur5e', name: 'ur5e' }],
    ['FR3 from franka_description 2.9.0', 'franka_description/robots/fr3/fr3.urdf.xacro', 'fr3.urdf'],
    ['TurtleBot3 Burger from turtlebot3_description 2.3.7, a .urdf containing xacro', 'turtlebot3_description/urdf/turtlebot3_burger.urdf', 'turtlebot3_burger.urdf'],
    ['Kinova Gen3 from kortex_description 0.2.5', 'kortex_description/robots/gen3.xacro', 'gen3.urdf', { dof: '7' }],
    ['xArm from xarm_description (xarm_ros2 humble)', 'xarm_description/urdf/xarm_device.urdf.xacro', 'xarm_device.urdf'],
    ['PMB2 from pmb2_description 5.12.3', 'pmb2_description/robots/pmb2.urdf.xacro', 'pmb2.urdf', {}, ['pal_urdf_utils']]
];

for (const [robot, primary, golden, args = {}, includes = []] of ROBOTS) {
    test(`${robot} expands like ROS 2 xacro`, async () => {
        const files = new Map([primary.split('/')[0], ...includes].flatMap(name => [...packageFiles(name)]));
        const urdf = await XacroAdapter.expand(await files.get(`/${primary}`).text(), `/${primary}`, files, { args });
        assertSameUrdf(urdf, fs.readFileSync(path.join(fixtures, golden), 'utf8'));
    });
}

for (const name of fs.readdirSync(path.join(fixtures, 'expressions')).filter(file => file.endsWith('.urdf.xacro'))) {
    test(`expressions/${name} expands like ROS 2 xacro`, async () => {
        const files = packageFiles('expressions');
        const primary = `/expressions/${name}`;
        const urdf = await XacroAdapter.expand(await files.get(primary).text(), primary, files);
        assertSameUrdf(urdf, fs.readFileSync(path.join(fixtures, 'expressions', name.replace(/\.xacro$/, '')), 'utf8'));
    });
}
