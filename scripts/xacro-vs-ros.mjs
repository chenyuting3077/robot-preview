// Expands xacro files with ROS 2 xacro (PyPI, in a venv under test-files/) and with the viewer, and compares them element by element.
// Usage: node scripts/xacro-vs-ros.mjs <package dir> <xacro relative to it>... [name:=value]...; ROS_OUT=<file> also writes ROS's output of the first xacro.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageFiles, assertSameUrdf } from '../tests/viewer/urdf-compare.mjs';

const XACRO_VERSION = '2.1.1';
const venv = fileURLToPath(new URL('../test-files/.xacro-venv/', import.meta.url));
const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.filter(a => a.includes(':=')).map(a => [a.slice(0, a.indexOf(':=')), a.slice(a.indexOf(':=') + 2)]));
const [dir, ...xacros] = argv.filter(a => !a.includes(':='));
if (!dir || !xacros.length) {
    console.error('usage: node scripts/xacro-vs-ros.mjs <package dir> <xacro relative to it>... [name:=value]...');
    process.exit(2);
}
const name = /<name>\s*([^<\s]+)\s*<\/name>/.exec(fs.readFileSync(path.join(dir, 'package.xml'), 'utf8'))[1];

// $(find) in ROS xacro goes through ament_index_python, which is not on PyPI; this stand-in maps the one package.
const shim = path.join(venv, 'shim', 'ament_index_python');
// Written last, so an interrupted setup or a new XACRO_VERSION builds the venv again.
const ready = path.join(venv, `xacro-${XACRO_VERSION}.ok`);
if (!fs.existsSync(ready)) {
    fs.rmSync(venv, { recursive: true, force: true });
    execFileSync('python3', ['-m', 'venv', venv], { stdio: 'inherit' });
    execFileSync(path.join(venv, 'bin', 'pip'), ['install', '-q', '--disable-pip-version-check', `xacro==${XACRO_VERSION}`], { stdio: 'inherit' });
    fs.mkdirSync(shim, { recursive: true });
    fs.writeFileSync(path.join(shim, '__init__.py'), '');
    fs.writeFileSync(path.join(shim, 'packages.py'), `import os
class PackageNotFoundError(KeyError): pass
def get_package_share_directory(name):
    if name != os.environ['XACRO_PACKAGE']: raise PackageNotFoundError(name)
    return os.environ['XACRO_PACKAGE_DIR']
`);
    fs.writeFileSync(ready, '');
}

const { XacroAdapter } = await import('../src/adapters/XacroAdapter.js');
const files = packageFiles(dir, name);
let failed = 0;
for (const xacro of xacros) {
    let ros;
    try {
        ros = execFileSync(path.join(venv, 'bin', 'xacro'), [path.join(dir, xacro), ...Object.entries(args).map(([k, v]) => `${k}:=${v}`)], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONPATH: path.dirname(shim), XACRO_PACKAGE: name, XACRO_PACKAGE_DIR: path.resolve(dir) }
        });
    } catch (error) {
        failed++;
        const lines = String(error.stderr).replace(/\x1b\[[\d;]*m/g, '').trim().split('\n');
        console.log(`ROS FAILED ${xacro}: ${lines.findLast(line => /error/i.test(line)) ?? lines.at(-1)}`);
        continue;
    }
    if (process.env.ROS_OUT && xacro === xacros[0]) fs.writeFileSync(process.env.ROS_OUT, ros);
    const key = `/${name}/${xacro.split(path.sep).join('/')}`;
    try {
        assertSameUrdf(await XacroAdapter.expand(await files.get(key).text(), key, files, { args }), ros);
        console.log(`same    ${xacro}`);
    } catch (error) {
        failed++;
        console.log(`DIFFERS ${xacro}: ${error.message.split('\n')[0]}`);
    }
}
process.exit(failed ? 1 : 0);
