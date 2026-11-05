// Publish a new Steez version from this PC:  npm run ship [patch|minor|major]
// Tests → version bump (commit + tag) → build installer locally → push the commit and tag →
// create the GitHub release with all three update files → verify. Installed copies update on
// their next launch. Uses the GitHub login of the `gh` CLI (run `gh auth login` once).
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bump = process.argv[2] || 'patch';
const sh = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const out = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

if (!['patch', 'minor', 'major'].includes(bump)) fail('Usage: npm run ship [patch|minor|major]');
if (out('git status --porcelain')) fail('Commit or stash your changes first.');
try {
  out('gh auth status');
} catch {
  fail('Log in to GitHub first:  gh auth login');
}

console.log('\n▸ Tests');
sh('npm test');

console.log(`\n▸ Bumping version (${bump})`);
sh(`npm version ${bump} -m "Steez %s"`);
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const tag = `v${version}`;
const files = [`Steez-Setup-${version}.exe`, `Steez-Setup-${version}.exe.blockmap`, 'latest.yml'].map((f) => path.join('release', f));

console.log('\n▸ Building the installer');
sh('npx vite build');
fs.rmSync(path.join(root, 'release'), { recursive: true, force: true });
const b = spawnSync('npx', ['electron-builder', '--win', '--publish', 'never'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (b.status !== 0) fail(`Build failed. Nothing was published; the version commit and tag ${tag} exist locally only.`);
for (const f of files) if (!fs.existsSync(path.join(root, f))) fail(`Build did not produce ${f}`);

console.log('\n▸ Pushing the commit and tag');
const branch = out('git rev-parse --abbrev-ref HEAD');
sh(`git push origin ${branch} ${tag}`);

console.log('\n▸ Creating the GitHub release');
const notes = out(`git log -1 --format=%B ${tag}~1`).slice(0, 4000) || `Steez ${version}`;
fs.writeFileSync(path.join(root, 'release', 'notes.md'), notes);
sh(`gh release create ${tag} ${files.map((f) => `"${f}"`).join(' ')} --title "Steez ${version}" --notes-file release/notes.md --latest`);

console.log('\n▸ Checking the release files');
const have = new Set(JSON.parse(out(`gh release view ${tag} --json assets`)).assets.map((a) => a.name));
const missing = files.map((f) => path.basename(f)).filter((f) => !have.has(f));
if (missing.length) {
  console.log(`Re-uploading: ${missing.join(', ')}`);
  sh(`gh release upload ${tag} --clobber ${missing.map((f) => `"release/${f}"`).join(' ')}`);
}
console.log(`\n✓ Steez ${version} is live. Installed copies update the next time they open.\n`);
