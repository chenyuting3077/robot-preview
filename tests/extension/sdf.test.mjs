// An SDF file previews like a URDF: its model:// includes and <uri> meshes
// reach the webview, and Problems and navigation point into the SDF.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startPreview, waitFor } from './vscode-mock.mjs';
import { write } from './path-fixture.mjs';

let ws, primary, wheel, env, load;
const saved = process.env.GZ_SIM_RESOURCE_PATH;

before(async () => {
    ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-sdf-')));
    write(path.join(ws, 'src/sim/package.xml'), '<package><name>sim</name></package>');
    primary = path.join(ws, 'src/sim/worlds/demo.sdf');
    write(primary, `<?xml version="1.0"?>
<sdf version="1.9">
  <model name="car">
    <link name="chassis">
      <visual name="v"><geometry><mesh><uri>meshes/missing.dae</uri></mesh></geometry></visual>
    </link>
    <include><uri>model://wheel</uri><name>front</name></include>
    <joint name="axle" type="revolute"><parent>chassis</parent><child>front::rim</child>
      <axis><xyz>0 1 0</xyz><limit><lower>-1</lower><upper>1</upper></limit></axis></joint>
  </model>
</sdf>
`);
    const models = path.join(ws, 'models');
    wheel = path.join(models, 'wheel/model.sdf');
    write(path.join(models, 'wheel/model.config'), '<model><sdf version="1.9">model.sdf</sdf></model>');
    write(wheel, '<sdf version="1.9"><model name="wheel">\n<link name="rim"><visual name="v"><geometry><mesh><uri>meshes/rim.stl</uri></mesh></geometry></visual></link>\n</model></sdf>');
    write(path.join(models, 'wheel/meshes/rim.stl'), 'solid rim\nendsolid rim\n');
    process.env.GZ_SIM_RESOURCE_PATH = models;
    ({ env, load } = await startPreview(ws, primary));
});

after(() => {
    if (saved === undefined) delete process.env.GZ_SIM_RESOURCE_PATH;
    else process.env.GZ_SIM_RESOURCE_PATH = saved;
});

test('the SDF, its model:// model.config, model.sdf and meshes are sent', () => {
    const sent = load.files.map(file => file.path);
    for (const key of ['/sim/worlds/demo.sdf', '/wheel/model.config', '/wheel/model.sdf', '/wheel/meshes/rim.stl']) {
        assert.ok(sent.includes(key), `${key} not sent; got ${sent.join(', ')}`);
    }
    assert.equal(load.primary, '/sim/worlds/demo.sdf');
});

test('a missing <uri> mesh is reported on the <uri> text', async () => {
    env.state.panels[0].receive({ type: 'diagnostics', syntax: {}, loadError: null, missingMeshes: ['sim/worlds/meshes/missing.dae'], guessedMeshes: [] });
    const [diagnostic] = await waitFor(() => env.state.diagnostics.get(primary)?.length && env.state.diagnostics.get(primary));
    assert.match(diagnostic.message, /Mesh not found: meshes\/missing\.dae/);
    assert.equal(diagnostic.range.start.line, 4);
});

test('a scoped link name from a nested model reveals its definition in the included file', async () => {
    env.state.revealed = null;
    env.state.panels[0].receive({ type: 'reveal', kind: 'link', name: 'front::rim' });
    await waitFor(() => env.state.revealed);
    assert.equal(env.state.revealed.fsPath, wheel);
    assert.equal(env.state.revealed.line, 1);
});

test('joint limits are not written into SDF', async () => {
    env.state.panels[0].receive({ type: 'editLimits', joint: 'axle', limits: { upper: 2 } });
    await waitFor(() => env.state.status.some(message => message.includes('cannot write limits')));
    assert.equal(env.state.applied.length, 0);
});
