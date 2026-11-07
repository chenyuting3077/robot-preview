import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startPreview, waitFor } from './vscode-mock.mjs';
import { robotWorkspace } from './path-fixture.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

async function startRobotPreview() {
    const { ws, primary } = robotWorkspace('<robot name="ur5e"><link name="base"/></robot>\n', 'robot.urdf.xacro');
    return { primary, ...(await startPreview(ws, primary)) };
}

test('the command asks the webview for a screenshot', async () => {
    const { env } = await startRobotPreview();
    await env.state.commands['robotPreviewUrdf.saveScreenshot']();
    assert.ok(env.lastOf('captureScreenshot'));
});

test('a screenshot is saved as <robot name>.png beside the model, through the save dialog', async () => {
    const { panel, primary } = await startRobotPreview();
    panel.receive({ type: 'screenshot', name: 'ur5e', data: PNG.toString('base64') });
    const saved = path.join(path.dirname(primary), 'ur5e.png');
    await waitFor(() => fs.existsSync(saved));
    assert.deepEqual(fs.readFileSync(saved), PNG);
});

test('without a robot name the file is named after the model file', async () => {
    const { panel, primary } = await startRobotPreview();
    panel.receive({ type: 'screenshot', name: '', data: PNG.toString('base64') });
    await waitFor(() => fs.existsSync(path.join(path.dirname(primary), 'robot.png')));
});
