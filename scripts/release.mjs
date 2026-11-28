// Sets a package's version, turns its CHANGELOG's "## Unreleased" into that version, and commits and tags it on main; pushing is left to you.
// Usage: node scripts/release.mjs <urdf-mjcf|mesh-splat|usd> <x.y.z>
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const NAMES = { 'urdf-mjcf': 'URDF, Xacro & MJCF', 'mesh-splat': 'Mesh & Splat', usd: 'USD' };
const fail = message => { console.error(message); process.exit(1); };
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const [pkg, version] = process.argv.slice(2);
if (!NAMES[pkg] || !/^\d+\.\d+\.\d+$/.test(version ?? '')) fail('usage: node scripts/release.mjs <urdf-mjcf|mesh-splat|usd> <x.y.z>');
if (git('branch', '--show-current') !== 'main') fail('release from main');
if (git('status', '--porcelain')) fail('the working tree has changes; commit or stash them first');
const tag = `${pkg}-v${version}`;
if (git('tag', '--list', tag)) fail(`${tag} already exists`);

const dir = `packages/${pkg}`;
const manifestPath = `${dir}/package.json`, changelogPath = `${dir}/CHANGELOG.md`;
const manifest = fs.readFileSync(manifestPath, 'utf8');
const current = JSON.parse(manifest).version;
const newer = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
if (!newer(version.split('.').map(Number), current.split('.').map(Number))) fail(`${version} is not newer than ${current}`);
const changelog = fs.readFileSync(changelogPath, 'utf8');
const unreleased = changelog.match(/^## Unreleased\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
if (!unreleased?.[1].trim()) fail(`${changelogPath} has no entries under "## Unreleased"`);

fs.writeFileSync(manifestPath, manifest.replace(`"version": "${current}"`, `"version": "${version}"`));
fs.writeFileSync(changelogPath, changelog.replace(/^## Unreleased$/m, `## ${version}`));
git('commit', '-q', '-m', `chore: release Robot Preview: ${NAMES[pkg]} ${version}`, manifestPath, changelogPath);
git('tag', tag);
console.log(`${git('log', '--oneline', '-1')}\ntag ${tag}\nnext: git push origin main ${tag}`);
