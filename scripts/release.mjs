// Publish a new Steez version from this PC:  npm run ship [patch|minor|major]
// Tests → version bump (commit + tag) → build installer → upload to the GitHub release →
// verify all update files are there → push. Every installed copy updates on its next launch.
// Uses the GitHub login of the `gh` CLI (run `gh auth login` once).
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bump = process.argv[2] || 'patch';
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', ...opts });
const out = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

if (!['patch', 'minor', 'major'].includes(bump)) fail('Usage: npm run ship [patch|minor|major]');
if (out('git status --porcelain')) fail('Commit or stash your changes first.');
let token;
try {
  token = out('gh auth token');
} catch {
  fail('Log in to GitHub first:  gh auth login');
}

console.log('\n▸ Tests');
sh('npm test');

console.log(`\n▸ Bumping version (${bump})`);
sh(`npm version ${bump} -m "Steez %s"`);
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const tag = `v${version}`;

console.log('\n▸ Building and publishing the installer');
sh('npx vite build');
fs.rmSync(path.join(root, 'release'), { recursive: true, force: true });
const r = spawnSync('npx', ['electron-builder', '--win', '--publish', 'always'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, GH_TOKEN: token } });
if (r.status !== 0) fail(`Build/publish failed. The version commit and tag ${tag} exist locally only — fix the problem, then run:  git push --follow-tags  and upload with  gh release upload ${tag} release/*.exe release/latest.yml release/*.blockmap`);

console.log('\n▸ Checking the release files');
const files = [`Steez-Setup-${version}.exe`, `Steez-Setup-${version}.exe.blockmap`, 'latest.yml'];
const have = new Set(JSON.parse(out(`gh release view ${tag} --json assets`)).assets.map((a) => a.name));
const missing = files.filter((f) => !have.has(f));
if (missing.length) {
  console.log(`Uploading missing: ${missing.join(', ')}`);
  sh(`gh release upload ${tag} --clobber ${missing.map((f) => `"release/${f}"`).join(' ')}`);
}

console.log('\n▸ Pushing');
sh('git push --follow-tags');
console.log(`\n✓ Steez ${version} is live. Installed copies update the next time they open.\n`);
