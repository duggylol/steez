// Builds ChestTracker.exe (native/chest-tracker/host) into resources/bin/win32-x64, where Steez finds
// it in dev and electron-builder packs it. Needs the .NET 10 SDK. Skips the build when the exe is
// newer than every source file, unless --force.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'native', 'chest-tracker');
const outDir = path.join(root, 'resources', 'bin', 'win32-x64');
const exe = path.join(outDir, 'ChestTracker.exe');
const force = process.argv.includes('--force');

function newest(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'bin' || e.name === 'obj') continue;
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}

if (!force && fs.existsSync(exe) && fs.statSync(exe).mtimeMs > newest(src)) {
  console.log('ChestTracker.exe is up to date.');
  process.exit(0);
}
const tmp = path.join(src, 'host', 'bin', 'publish');
const r = spawnSync(
  'dotnet',
  ['publish', path.join(src, 'host', 'ChestTracker.csproj'), '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
    '-p:PublishSingleFile=true', '-p:EnableCompressionInSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true', '-p:DebugType=none', '-o', tmp],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (r.status !== 0) {
  console.error('\nChestTracker.exe failed to build. Is the .NET 10 SDK installed? https://dotnet.microsoft.com/download');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(path.join(tmp, 'ChestTracker.exe'), exe);
console.log('Built ' + path.relative(root, exe));
