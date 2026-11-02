// CareSchedule desktop app: shows ../CareSchedule.html in a window and keeps its data in a file
// (Documents/CareSchedule/careschedule-data.json) with a daily backup copy.
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

const KEEP_BACKUPS = 30;
let dataDir, dataFile, backupDir;
let notice = null; // message for the page, e.g. when the data file had to be restored from a backup

function setPaths() {
  dataDir = process.env.CARESCHEDULE_DATA_DIR || path.join(app.getPath('documents'), 'CareSchedule');
  dataFile = path.join(dataDir, 'careschedule-data.json');
  backupDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
}

const today = () => new Date().toISOString().slice(0, 10);
const backups = () => fs.readdirSync(backupDir).filter(f => /^careschedule-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  JSON.parse(raw); // throws if damaged
  return raw;
}

function loadData() {
  if (!fs.existsSync(dataFile)) return null;
  try {
    return readJson(dataFile);
  } catch (e) {
    // keep the damaged file aside and fall back to the newest good backup
    const aside = dataFile.replace(/\.json$/, `.damaged-${Date.now()}.json`);
    fs.renameSync(dataFile, aside);
    for (const f of backups().reverse()) {
      try {
        const raw = readJson(path.join(backupDir, f));
        fs.writeFileSync(dataFile, raw);
        notice = `Your data file could not be read, so it was restored from the backup made on ${f.slice(13, 23)}.\n` +
          `Any changes after that will need re-entering. The damaged file was kept as ${path.basename(aside)}.`;
        return raw;
      } catch (_) { /* try an older one */ }
    }
    notice = `Your data file could not be read and no backup was found. The damaged file was kept as ${path.basename(aside)}.`;
    return null;
  }
}

function saveData(json) {
  JSON.parse(json);
  // first save of the day: keep yesterday's file as a backup, then trim old backups
  const todays = path.join(backupDir, `careschedule-${today()}.json`);
  if (fs.existsSync(dataFile) && !fs.existsSync(todays)) fs.copyFileSync(dataFile, todays);
  const old = backups();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) fs.unlinkSync(path.join(backupDir, f));
  // write to a temporary file and swap it in, so a crash mid-write can't leave a half-written file
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, dataFile);
}

ipcMain.on('data:load', e => { e.returnValue = loadData(); });
ipcMain.on('data:save', (e, json) => {
  try { saveData(json); e.returnValue = true; } catch (err) { e.returnValue = err.message; }
});
ipcMain.on('data:info', e => { e.returnValue = { file: dataFile, keep: KEEP_BACKUPS, notice }; });
ipcMain.on('data:openFolder', () => { shell.openPath(dataDir); });

function pagePath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'CareSchedule.html') : path.join(__dirname, '..', 'CareSchedule.html');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600, title: 'CareSchedule',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // the page is local and offline: never navigate away or open other windows
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(pagePath());
  return win;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ label: 'Open data folder', click: () => shell.openPath(dataDir) }, { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
}

// only one copy at a time, so two windows can't overwrite each other's changes
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win;
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    setPaths();
    buildMenu();
    win = createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) win = createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
