// Builds the Fortnite chest tracker programs (needs the .NET 10 SDK):
//   ChestTracker.exe       -> resources/bin/win32-x64 (Steez finds it there in dev; electron-builder packs it)
//   SteezChestBridge.zip   -> native/chest-tracker/out (the game PC tray app + README, a release download)
// Skips whatever is newer than every source file, unless --force.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'native', 'chest-tracker');
const force = process.argv.includes('--force');

function newest(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['bin', 'obj', 'out'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}
const upToDate = (file) => !force && fs.existsSync(file) && fs.statSync(file).mtimeMs > newest(src);

function publish(project, outDir) {
  const r = spawnSync(
    'dotnet',
    ['publish', project, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
      '-p:PublishSingleFile=true', '-p:EnableCompressionInSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true', '-p:DebugType=none', '-o', outDir],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) {
    console.error('\nBuild failed. Is the .NET 10 SDK installed? https://dotnet.microsoft.com/download');
    process.exit(1);
  }
}

// Same-PC helper
const exe = path.join(root, 'resources', 'bin', 'win32-x64', 'ChestTracker.exe');
if (upToDate(exe)) console.log('ChestTracker.exe is up to date.');
else {
  const tmp = path.join(src, 'host', 'bin', 'publish');
  publish(path.join(src, 'host', 'ChestTracker.csproj'), tmp);
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.copyFileSync(path.join(tmp, 'ChestTracker.exe'), exe);
  console.log('Built ' + path.relative(root, exe));
}

// Game PC bridge, zipped with its README
const zip = path.join(src, 'out', 'SteezChestBridge.zip');
if (upToDate(zip)) console.log('SteezChestBridge.zip is up to date.');
else {
  const tmp = path.join(src, 'bridge', 'bin', 'publish');
  publish(path.join(src, 'bridge', 'SteezChestBridge.csproj'), tmp);
  const stage = path.join(src, 'out', 'stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.copyFileSync(path.join(tmp, 'SteezChestBridge.exe'), path.join(stage, 'SteezChestBridge.exe'));
  fs.copyFileSync(path.join(src, 'bridge', 'README.txt'), path.join(stage, 'README.txt'));
  fs.rmSync(zip, { force: true });
  const r = spawnSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal`], { stdio: 'inherit' });
  if (r.status !== 0 || !fs.existsSync(zip)) {
    console.error('Could not make SteezChestBridge.zip');
    process.exit(1);
  }
  fs.rmSync(stage, { recursive: true, force: true });
  console.log('Built ' + path.relative(root, zip));
}
