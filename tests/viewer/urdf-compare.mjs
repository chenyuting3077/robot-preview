// Compares two expanded URDFs as ROS 2 xacro's own output would be; used by the golden test and scripts/xacro-vs-ros.mjs.
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

// The model files of a package directory, keyed as the webview keys them (/<name>/<path>).
export function packageFiles(dir, name) {
    return new Map(fs.readdirSync(dir, { recursive: true })
        .filter(rel => /\.(xacro|urdf|ya?ml)$|(^|[\\/])package\.xml$/i.test(rel) && !rel.split(path.sep).some(part => part.startsWith('.')))
        .map(rel => [`/${name}/${rel.split(path.sep).join('/')}`, new File([fs.readFileSync(path.join(dir, rel))], path.basename(rel))]));
}

// Attributes sorted and text trimmed: order and whitespace never matter, text content (ros2_control params) does.
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

// Python and JavaScript print floats differently (1e-05 vs 0.00001).
function sameValue(a, b) {
    const x = a.trim().split(/\s+/);
    const y = b.trim().split(/\s+/);
    return x.length === y.length && x.every((token, i) => token === y[i]
        || (token !== '' && !isNaN(token) && !isNaN(y[i]) && Math.abs(Number(token) - Number(y[i])) <= 1e-9 * Math.max(1, Math.abs(Number(token)))));
}

export function assertSameUrdf(actual, expected) {
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
