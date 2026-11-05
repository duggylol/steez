// Renders build/icon.svg to build/icon.png (512x512) using Electron. Run: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../build/icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;overflow:hidden">${svg}</body></html>`));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(path.join(__dirname, '../build/icon.png'), img.resize({ width: 512, height: 512 }).toPNG());
  console.log('build/icon.png written');
  app.quit();
});
