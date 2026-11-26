// Every main-process and script file must parse. Some of them (main.js, preload.cjs, the updater)
// only run inside Electron, so no other test loads them; a typo there would only show up as an
// error dialog when Steez starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(c|m)?js$/.test(e.name)) files.push(p);
  }
};
walk(path.join(root, 'src', 'main'));
walk(path.join(root, 'scripts'));

test('main-process and script files all parse', () => {
  // one node process checks them all: much faster than one `node --check` per file
  const script = `const { readFileSync } = require('fs'); const vm = require('vm'); const bad = [];
for (const f of JSON.parse(process.argv[1])) {
  const src = readFileSync(f, 'utf8');
  try {
    if (f.endsWith('.cjs')) new vm.Script(require('module').wrap(src), { filename: f });
    else new vm.SourceTextModule(src, { identifier: f });
  } catch (e) { bad.push(f + ': ' + e.message); }
}
console.log(JSON.stringify(bad));`;
  const out = execFileSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '-e', script, JSON.stringify(files)], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), []);
  assert.ok(files.length > 50);
});
