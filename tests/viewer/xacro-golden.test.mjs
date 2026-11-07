// Real robots expanded by the viewer must match ROS 2 xacro's own output
// (tests/fixtures/xacro/generate-golden.sh). Numbers compare with a tolerance
// because Python and JavaScript print floats differently (1e-05 vs 0.00001).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from 'linkedom';

globalThis.DOMParser ??= DOMParser;
globalThis.XMLSerializer ??= class {
    serializeToString(node) {
        return node.toString();
    }
};

const { XacroAdapter } = await import('../../src/adapters/XacroAdapter.js');
const fixtures = new URL('../fixtures/xacro/', import.meta.url).pathname;

function packageFiles(name) {
    const dir = path.join(fixtures, name);
    return new Map(fs.readdirSync(dir, { recursive: true })
        .filter(rel => fs.statSync(path.join(dir, rel)).isFile())
        .map(rel => [`/${name}/${rel.split(path.sep).join('/')}`, new File([fs.readFileSync(path.join(dir, rel))], path.basename(rel))]));
}

// Each element with its attributes sorted and its own text trimmed, so order
// and whitespace never matter but text content (e.g. ros2_control params) does.
function elements(xml) {
    const out = [];
    const walk = (node, trail) => {
        for (const child of node.children) {
            const here = `${trail}/${child.tagName}`;
            const attrs = Array.from(child.attributes, a => [a.name, a.value]).filter(([name]) => !name.startsWith('xmlns')).sort(([a], [b]) => a.localeCompare(b));
            const text = Array.from(child.childNodes).filter(node => node.nodeType === 3).map(node => node.nodeValue).join('').trim();
            out.push({ here, attrs, text });
            walk(child, here);
        }
    };
    walk(new DOMParser().parseFromString(xml, 'text/xml'), '');
    return out;
}

function sameValue(a, b) {
    const x = a.trim().split(/\s+/);
    const y = b.trim().split(/\s+/);
    return x.length === y.length && x.every((token, i) => token === y[i]
        || (token !== '' && !isNaN(token) && !isNaN(y[i]) && Math.abs(Number(token) - Number(y[i])) <= 1e-9 * Math.max(1, Math.abs(Number(token)))));
}

function assertSameUrdf(actual, expected) {
    const got = elements(actual);
    const want = elements(expected);
    assert.deepEqual(got.map(e => e.here), want.map(e => e.here), 'element structure differs');
    want.forEach((element, i) => {
        const mine = Object.fromEntries(got[i].attrs);
        assert.deepEqual(got[i].attrs.map(([name]) => name), element.attrs.map(([name]) => name), `attributes of ${element.here} #${i}`);
        for (const [name, value] of element.attrs) {
            assert.ok(sameValue(mine[name], value), `${element.here} #${i} ${name}: ${mine[name]} != ${value}`);
        }
        assert.ok(sameValue(got[i].text, element.text), `${element.here} #${i} text: ${got[i].text} != ${element.text}`);
    });
}

test('UR5e from ur_description 4.4.1 expands like ROS 2 xacro', async () => {
    const files = packageFiles('ur_description');
    const primary = '/ur_description/urdf/ur.urdf.xacro';
    const urdf = await XacroAdapter.expand(await files.get(primary).text(), primary, files, { ur_type: 'ur5e', name: 'ur5e' });
    assertSameUrdf(urdf, fs.readFileSync(path.join(fixtures, 'ur5e.urdf'), 'utf8'));
});
