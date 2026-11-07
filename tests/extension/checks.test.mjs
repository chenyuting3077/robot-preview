// Model-check results from the webview land on the source that defines the
// element, once per macro, with quick fixes for literal joints only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startPreview, waitFor } from './vscode-mock.mjs';
import { write } from './path-fixture.mjs';

async function workspaceWith(urdf, name = 'robot.urdf') {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'robot-preview-checks-')));
    write(path.join(ws, 'src/pkg/package.xml'), '<package><name>pkg</name></package>');
    const primary = path.join(ws, 'src/pkg/urdf', name);
    write(primary, urdf);
    return { ws, primary };
}

async function diagnose(urdf, checks, { name, config } = {}) {
    const { primary } = await workspaceWith(urdf, name);
    const { env, panel } = await startPreview(path.dirname(path.dirname(path.dirname(primary))), primary, config);
    panel.receive({ type: 'diagnostics', syntax: {}, loadError: null, missingMeshes: [], guessedMeshes: [], checks });
    await waitFor(() => env.state.diagnostics.has(primary), 1500).catch(() => {});
    const doc = await env.vscode.workspace.openTextDocument(primary);
    const fixes = diagnostic => env.state.codeActions.provideCodeActions(doc, diagnostic.range, { diagnostics: [diagnostic] });
    const applied = action => {
        let text = doc.getText();
        for (const { range, text: replacement } of [...action.edit.edits].reverse()) {
            text = text.slice(0, doc.offsetAt(range.start)) + replacement + text.slice(doc.offsetAt(range.end));
        }
        return text;
    };
    return { env, primary, diagnostics: env.state.diagnostics.get(primary) || [], fixes, applied, text: doc.getText() };
}

const issue = (rule, severity, kind, name) => ({ rule, severity, kind, name, message: `${kind} "${name}" broke ${rule}` });
const lineOf = (text, needle) => text.split('\n').findIndex(line => line.includes(needle));

const JOINT = (type, limit) => `<robot name="r">
<link name="base"/>
<link name="arm"/>
<joint name="j" type="${type}">
  <parent link="base"/>
  <child link="arm"/>
${limit}
</joint>
</robot>
`;

test('a check lands on the element definition with its rule as the code', async () => {
    const { diagnostics, text } = await diagnose(JOINT('revolute', '  <limit lower="1" upper="-1" effort="1" velocity="1"/>'), [issue('inverted-limit', 'warning', 'joint', 'j')]);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, 'inverted-limit');
    assert.equal(diagnostics[0].severity, 1);
    assert.equal(diagnostics[0].range.start.line, lineOf(text, '<joint name="j"'));
});

test('quick fix swaps an inverted limit', async () => {
    const { diagnostics, fixes, applied } = await diagnose(JOINT('revolute', '  <limit lower="1" upper="-1" effort="1" velocity="1"/>'), [issue('inverted-limit', 'warning', 'joint', 'j')]);
    const [action] = fixes(diagnostics[0]);
    assert.match(applied(action), /<limit lower="-1" upper="1" effort="1" velocity="1"\/>/);
});

test('a continuous joint with bounds offers revolute or dropping the bounds', async () => {
    const { diagnostics, fixes, applied } = await diagnose(JOINT('continuous', '  <limit lower="-1" upper="1" effort="1" velocity="1"/>'), [issue('continuous-with-limits', 'warning', 'joint', 'j')]);
    const actions = fixes(diagnostics[0]);
    assert.equal(actions.length, 2);
    assert.match(applied(actions[0]), /<joint name="j" type="revolute">/);
    assert.match(applied(actions[1]), /<limit effort="1" velocity="1"\/>/);
});

test('a missing limit is an error whose fix inserts a marked placeholder', async () => {
    const { diagnostics, fixes, applied } = await diagnose(JOINT('revolute', '  <axis xyz="0 0 1"/>'), [issue('missing-limit', 'error', 'joint', 'j')]);
    assert.equal(diagnostics[0].severity, 0);
    const fixed = applied(fixes(diagnostics[0])[0]);
    assert.match(fixed, /  <axis xyz="0 0 1"\/>\n  <!-- TODO: set real limits -->\n  <limit lower="-3.14" upper="3.14" effort="1" velocity="1"\/>\n<\/joint>/);
});

const MACRO = `<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro">
<link name="base"/>
<xacro:macro name="arm" params="side">
  <link name="\${side}_arm"><visual><geometry><box size="1 1 1"/></geometry></visual></link>
</xacro:macro>
<xacro:arm side="left"/>
<xacro:arm side="right"/>
</robot>
`;

const MACRO_JOINTS = `<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro">
<link name="base"/>
<xacro:macro name="arm" params="side">
  <link name="\${side}_arm"/>
  <joint name="\${side}_shoulder" type="revolute">
    <parent link="base"/>
    <child link="\${side}_arm"/>
    <limit lower="1" upper="-1" effort="1" velocity="1"/>
  </joint>
</xacro:macro>
<xacro:macro name="tool">
  <link name="tool"/>
  <joint name="tool_joint" type="revolute">
    <parent link="base"/>
    <child link="tool"/>
    <limit lower="1" upper="-1" effort="1" velocity="1"/>
  </joint>
</xacro:macro>
<xacro:arm side="left"/>
<xacro:arm side="right"/>
<xacro:tool/>
</robot>
`;

test('instances of one macro share a single diagnostic, without a fix even for a fixable rule', async () => {
    const { diagnostics, fixes, text } = await diagnose(MACRO_JOINTS, [issue('inverted-limit', 'warning', 'joint', 'left_shoulder'), issue('inverted-limit', 'warning', 'joint', 'right_shoulder')], { name: 'robot.urdf.xacro' });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].range.start.line, lineOf(text, '${side}_shoulder'));
    assert.match(diagnostics[0].message, /right_shoulder/);
    assert.equal(fixes(diagnostics[0]).length, 0);
});

test('a literally named element inside a macro gets no fix either', async () => {
    const { diagnostics, fixes } = await diagnose(MACRO_JOINTS, [issue('inverted-limit', 'warning', 'joint', 'tool_joint')], { name: 'robot.urdf.xacro' });
    assert.equal(diagnostics.length, 1);
    assert.equal(fixes(diagnostics[0]).length, 0);
});

test('the range covers the name value, not an earlier match inside the tag', async () => {
    const { diagnostics, text } = await diagnose(JOINT('revolute', '  <limit lower="1" upper="-1" effort="1" velocity="1"/>'), [issue('inverted-limit', 'warning', 'joint', 'j')]);
    const line = text.split('\n')[diagnostics[0].range.start.line];
    assert.equal(line.slice(diagnostics[0].range.start.character, diagnostics[0].range.end.character), 'j');
    assert.equal(diagnostics[0].range.start.character, line.indexOf('"j"') + 1);
});

test('a missing limit on a one-line joint is inserted inside it', async () => {
    const urdf = '<robot name="r"><link name="base"/><link name="arm"/>\n<joint name="j" type="revolute"><parent link="base"/><child link="arm"/></joint>\n</robot>\n';
    const { diagnostics, fixes, applied } = await diagnose(urdf, [issue('missing-limit', 'error', 'joint', 'j')]);
    assert.match(applied(fixes(diagnostics[0])[0]), /<child link="arm"\/><!-- TODO: set real limits --><limit lower="-3.14" upper="3.14" effort="1" velocity="1"\/><\/joint>/);
});

test('a limit lacking effort gets no insert-limit fix', async () => {
    const { diagnostics, fixes } = await diagnose(JOINT('revolute', '  <limit lower="-1" upper="1"/>'), [issue('missing-limit', 'error', 'joint', 'j')]);
    assert.equal(fixes(diagnostics[0]).length, 0);
});

test('a same-named element in a file outside the loaded model is not marked', async () => {
    const urdf = JOINT('revolute', '  <limit lower="-1" upper="1" effort="1" velocity="1"/>');
    const { primary } = await workspaceWith(urdf);
    write(path.join(path.dirname(primary), 'other.urdf'), '<robot name="o"><link name="base"/></robot>\n');
    const { env, panel } = await startPreview(path.dirname(path.dirname(path.dirname(primary))), primary);
    panel.receive({ type: 'diagnostics', syntax: {}, loadError: null, missingMeshes: [], guessedMeshes: [], checks: [issue('duplicate-name', 'error', 'link', 'base')] });
    await waitFor(() => env.state.diagnostics.size > 0);
    assert.deepEqual([...env.state.diagnostics.keys()], [primary]);
});

test('disabled rules are not reported', async () => {
    const { diagnostics } = await diagnose(MACRO, [issue('missing-inertial', 'warning', 'link', 'left_arm')], { name: 'robot.urdf.xacro', config: { 'checks.disabled': ['missing-inertial'] } });
    assert.equal(diagnostics.length, 0);
});
