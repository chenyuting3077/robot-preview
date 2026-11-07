import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';

globalThis.DOMParser ??= DOMParser;
globalThis.XMLSerializer ??= class {
    serializeToString(node) {
        return node.toString();
    }
};

const { XacroAdapter } = await import('../../src/adapters/XacroAdapter.js');

const robot = body => `<?xml version="1.0"?>\n<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro">\n${body}\n</robot>`;
const files = entries => new Map(Object.entries(entries).map(([key, text]) => [key, new File([text], key.split('/').pop())]));
const expand = (body, { extra = {}, args = {}, env = {} } = {}) => XacroAdapter.expand(robot(body), '/pkg/urdf/robot.urdf.xacro', files({ '/pkg/urdf/robot.urdf.xacro': robot(body), ...extra }), args, { env });
const linkName = urdf => urdf.match(/<link name="([^"]*)"/)?.[1];

test('plain xacro expands', async () => {
    assert.equal(linkName(await expand('<xacro:property name="w" value="2"/><link name="l${w * 3}"/>')), 'l6');
});

test('$(env) substitutes an environment variable', async () => {
    assert.equal(linkName(await expand('<link name="$(env ROBOT)"/>', { env: { ROBOT: 'from_env' } })), 'from_env');
});

test('$(optenv) falls back to its default, which may contain spaces', async () => {
    assert.equal(linkName(await expand('<link name="$(optenv ROBOT fallback)"/>', { env: { ROBOT: 'set' } })), 'set');
    assert.equal(linkName(await expand('<link name="$(optenv ROBOT two words)"/>')), 'two words');
    assert.equal(linkName(await expand('<link name="x$(optenv ROBOT)y"/>')), 'xy');
});

test('$(eval) evaluates an expression over the xacro arguments', async () => {
    assert.equal(linkName(await expand('<xacro:arg name="n" default="4"/><link name="l$(eval n + 1)"/>')), 'l5');
    assert.equal(linkName(await expand('<xacro:arg name="n" default="4"/><link name="l$(eval n * 2)"/>', { args: { n: '3' } })), 'l6');
});

test('$(dirname) is the directory of the file being processed, inside includes too', async () => {
    const part = robot('<link name="$(dirname)"/>');
    const urdf = await expand('<link name="$(dirname)"/><xacro:include filename="inc/part.xacro"/>', { extra: { '/pkg/urdf/inc/part.xacro': part } });
    assert.deepEqual(Array.from(urdf.matchAll(/<link name="([^"]*)"/g), m => m[1]), ['/pkg/urdf', '/pkg/urdf/inc']);
});

const yamlConfig = { '/pkg/config/limits.yaml': 'arm:\n  name: elbow\n  upper: 1.5\n' };

test('xacro.load_yaml reads a yaml file into a dictionary', async () => {
    const urdf = await expand(`
<xacro:property name="file" value="$(find pkg)/config/limits.yaml"/>
<xacro:property name="cfg" value="\${xacro.load_yaml(file)}"/>
<link name="\${cfg['arm']['name']}"/>`, { extra: yamlConfig });
    assert.equal(linkName(urdf), 'elbow');
});

const jointLimit = urdf => Number(urdf.match(/<limit upper="([^"]*)"/)?.[1]);

test('yaml unit tags convert to radians and metres, evaluating their expression', async () => {
    const extra = { '/pkg/config/units.yaml': 'a: !degrees 180\nb: !millimeters 2 * 5\nc: !radians pi / 2\nd: !inches 1\ne: !meters 1.5\nf: !foot 2\n' };
    for (const [key, expected] of [['a', Math.PI], ['b', 0.01], ['c', Math.PI / 2], ['d', 0.0254], ['e', 1.5], ['f', 0.6096]]) {
        const urdf = await expand(`<xacro:property name="u" value="\${xacro.load_yaml('$(find pkg)/config/units.yaml')}"/><limit upper="\${u['${key}']}"/>`, { extra });
        assert.ok(Math.abs(jointLimit(urdf) - expected) < 1e-9, `${key}: ${jointLimit(urdf)}`);
    }
});

test('a relative load_yaml path starts at the including file, not the opened one', async () => {
    const part = robot(`<xacro:property name="cfg" value="\${load_yaml('../config/limits.yaml')}"/><link name="\${cfg['arm']['name']}"/>`);
    const urdf = await expand('<xacro:include filename="inc/part.xacro"/>', {
        extra: { ...yamlConfig, '/pkg/urdf/inc/part.xacro': part, '/pkg/urdf/config/limits.yaml': 'arm:\n  name: beside_include\n' }
    });
    assert.equal(linkName(urdf), 'beside_include');
});

test("Python's 'key in dict' and 'a if cond else b' work on yaml dictionaries", async () => {
    const load = `<xacro:property name="cfg" value="\${xacro.load_yaml('$(find pkg)/config/limits.yaml')}"/>`;
    assert.equal(linkName(await expand(`${load}<link name="\${cfg['arm']['name'] if 'arm' in cfg else 'none'}"/>`, { extra: yamlConfig })), 'elbow');
    assert.equal(linkName(await expand(`${load}<link name="\${cfg['leg'] if 'leg' in cfg else 'none'}"/>`, { extra: yamlConfig })), 'none');
});

test('macro defaults inherit from the calling scope with ^ and ^|default', async () => {
    const urdf = await expand(`
<xacro:macro name="inner" params="name:=^ kind:=^|plain"><link name="\${name}_\${kind}"/></xacro:macro>
<xacro:macro name="outer" params="name kind:=^|unused"><xacro:inner/></xacro:macro>
<xacro:outer name="arm"/>
<xacro:property name="kind" value="fancy"/>
<xacro:macro name="outer2" params="name"><xacro:inner/></xacro:macro>
<xacro:outer2 name="leg"/>`);
    assert.deepEqual(Array.from(urdf.matchAll(/<link name="([^"]*)"/g), m => m[1]), ['arm_unused', 'leg_fancy']);
});

test('a property set with scope="parent" is visible to the rest of the macro body', async () => {
    const urdf = await expand(`
<xacro:macro name="setup"><xacro:property name="a" value="7" scope="parent"/><xacro:property name="b" value="\${a * 2}" scope="parent"/></xacro:macro>
<xacro:macro name="robot"><xacro:setup/><link name="l\${b}"/></xacro:macro>
<xacro:robot/>`);
    assert.equal(linkName(urdf), 'l14');
});

test('xacro:arg defaults may be empty or contain substitutions', async () => {
    assert.equal(linkName(await expand('<xacro:arg name="prefix" default=""/><link name="$(arg prefix)base"/>')), 'base');
    assert.equal(linkName(await expand('<xacro:arg name="type" default="ur5e"/><xacro:arg name="file" default="$(find pkg)/$(arg type)"/><link name="$(arg file)"/>')), '/pkg/ur5e');
});

const links = urdf => Array.from(urdf.matchAll(/<link name="([^"]*)"/g), m => m[1]);

test('booleans follow Python: False is false in conditions and prints as False', async () => {
    const ifs = ['False', 'false', '${False}', '0', 'True', 'true', '${True}', '1']
        .map((value, i) => `<xacro:if value="${value}"><link name="c${i}"/></xacro:if>`).join('');
    assert.deepEqual(links(await expand(ifs)), ['c4', 'c5', 'c6', 'c7']);
    assert.equal(linkName(await expand(`<link name="\${'a' if False else 'b'}"/>`)), 'b');
    assert.equal(linkName(await expand('<link name="${True}"/>')), 'True');
});

test('a "True" argument compares equal to True, as xacro reads literals', async () => {
    const body = '<xacro:arg name="flag" default="false"/><xacro:property name="flag" value="$(arg flag)"/><xacro:if value="${flag == True}"><link name="on"/></xacro:if><xacro:unless value="${flag}"><link name="off"/></xacro:unless>';
    assert.deepEqual(links(await expand(body, { args: { flag: 'True' } })), ['on']);
    assert.deepEqual(links(await expand(body)), ['off']);
});

test('Python conditionals nest inside parentheses and leave strings alone', async () => {
    const props = '<xacro:property name="radius" value="3"/><xacro:property name="double" value="true"/><xacro:property name="p" value="false"/>';
    assert.equal(linkName(await expand(`${props}<link name="l\${radius * (2 if double else 1)}"/>`)), 'l6');
    assert.equal(linkName(await expand(`${props}<link name="\${'mode if x else y'}"/>`)), 'mode if x else y');
    assert.equal(linkName(await expand(`${props}<link name="\${'a' if (p if double else True) else 'b'}"/>`)), 'b');
    assert.equal(linkName(await expand(`${props}<link name="\${'k[0]' if double else 'n'}"/>`)), 'k[0]');
});

test('load_yaml finds only the exact path, as ROS does, never a same-named file elsewhere', async () => {
    await assert.rejects(
        expand(`<xacro:property name="cfg" value="\${xacro.load_yaml('$(find pkg)/config/wrongdir/limits.yaml')}"/><link name="\${cfg['arm']['name']}"/>`, { extra: yamlConfig }),
        /cannot find/
    );
});

test('$(eval) sees arguments declared in included files and defaults built from substitutions', async () => {
    const common = robot('<xacro:arg name="scale" default="2"/>');
    const urdf = await expand('<xacro:include filename="common.xacro"/><xacro:arg name="base" default="$(arg scale)"/><link name="l$(eval scale * 3 + base)"/>', { extra: { '/pkg/urdf/common.xacro': common } });
    assert.equal(linkName(urdf), 'l8');
});

test('yaml files are not read when nothing calls load_yaml', async () => {
    let reads = 0;
    const map = files({ '/pkg/urdf/robot.urdf.xacro': robot('<link name="a"/>') });
    map.set('/pkg/config/big.yaml', { text: async () => { reads++; return 'a: 1\n'; } });
    await XacroAdapter.expand(robot('<link name="a"/>'), '/pkg/urdf/robot.urdf.xacro', map, {});
    assert.equal(reads, 0);
});
