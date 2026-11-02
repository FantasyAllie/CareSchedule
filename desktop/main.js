// CareSchedule desktop app: shows ../CareSchedule.html in a window and keeps its data in a file with daily
// backups. The data folder can be moved (e.g. into Google Drive) so an office can share it; a lock file in
// that folder lets only one computer edit at a time while others see it view-only.
const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KEEP_BACKUPS = 30;
const HEARTBEAT_MS = 30 * 1000;       // the editing computer refreshes its lock this often
const LOCK_STALE_MS = 3 * 60 * 1000;  // a lock not refreshed for this long is treated as left behind
const WATCH_MS = 3000;                // how often the data file is checked for changes from other computers

let win = null;
let dataDir, dataFile, backupDir, lockFile;
let notice = null;          // message for the page, e.g. when the data file had to be restored from a backup
let mode = 'edit';          // 'edit' or 'view' (someone else has the lock)
let holder = null;          // who has the lock when we're view-only
let lastWritten = null;     // content we last read or wrote, to spot changes made elsewhere
const me = { id: crypto.randomUUID(), user: os.userInfo().username, computer: os.hostname() };

const configFile = () => path.join(app.getPath('userData'), 'config.json');
function readConfig() { try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch (_) { return {}; } }
function writeConfig(cfg) { fs.mkdirSync(path.dirname(configFile()), { recursive: true }); fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2)); }

function setPaths(dir) {
  dataDir = dir;
  dataFile = path.join(dataDir, 'careschedule-data.json');
  backupDir = path.join(dataDir, 'backups');
  lockFile = path.join(dataDir, 'careschedule.lock');
  fs.mkdirSync(backupDir, { recursive: true });
}
const defaultDir = () => process.env.CARESCHEDULE_DATA_DIR || readConfig().dataDir || path.join(app.getPath('documents'), 'CareSchedule');

const today = () => new Date().toISOString().slice(0, 10);
const backups = () => fs.readdirSync(backupDir).filter(f => /^careschedule-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
const cloudName = dir => /google ?drive|my drive|shared drives/i.test(dir) ? 'Google Drive' : /onedrive/i.test(dir) ? 'OneDrive' : /dropbox/i.test(dir) ? 'Dropbox' : null;

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  JSON.parse(raw); // throws if damaged
  return raw;
}

function loadData() {
  if (!fs.existsSync(dataFile)) return null;
  try {
    return (lastWritten = readJson(dataFile));
  } catch (e) {
    if (mode === 'view') return null; // leave repairs to the computer that is editing
    // keep the damaged file aside and fall back to the newest good backup
    const aside = dataFile.replace(/\.json$/, `.damaged-${Date.now()}.json`);
    fs.renameSync(dataFile, aside);
    for (const f of backups().reverse()) {
      try {
        const raw = readJson(path.join(backupDir, f));
        fs.writeFileSync(dataFile, raw);
        notice = `Your data file could not be read, so it was restored from the backup made on ${f.slice(13, 23)}.\n` +
          `Any changes after that will need re-entering. The damaged file was kept as ${path.basename(aside)}.`;
        return (lastWritten = raw);
      } catch (_) { /* try an older one */ }
    }
    notice = `Your data file could not be read and no backup was found. The damaged file was kept as ${path.basename(aside)}.`;
    return null;
  }
}

function saveData(json) {
  JSON.parse(json);
  // first save of the day: keep the previous file as a backup, then trim old backups
  const todays = path.join(backupDir, `careschedule-${today()}.json`);
  if (fs.existsSync(dataFile) && !fs.existsSync(todays)) fs.copyFileSync(dataFile, todays);
  const old = backups();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) fs.unlinkSync(path.join(backupDir, f));
  // write to a temporary file and swap it in, so a crash mid-write can't leave a half-written file
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, dataFile);
  lastWritten = json;
}

// ---- one editor at a time ----
function readLock() { try { return JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch (_) { return null; } }
const lockIsLive = l => l && l.id !== me.id && Date.now() - l.heartbeat < LOCK_STALE_MS;
function writeLock(since) { fs.writeFileSync(lockFile, JSON.stringify({ ...me, since, heartbeat: Date.now() })); }

function tryLock() {
  const l = readLock();
  if (lockIsLive(l)) { mode = 'view'; holder = l; return false; }
  writeLock(l && l.id === me.id ? l.since : Date.now());
  mode = 'edit'; holder = null;
  return true;
}

function releaseLock() {
  const l = readLock();
  if (l && l.id === me.id) { try { fs.unlinkSync(lockFile); } catch (_) { /* already gone */ } }
}

function heartbeat() {
  if (mode !== 'edit') {
    // view-only: take over once the other computer has finished (lock removed or left behind)
    if (!lockIsLive(readLock())) {
      tryLock();
      if (mode === 'edit' && win) win.webContents.send('lock:changed', info());
    }
    return;
  }
  const l = readLock();
  if (lockIsLive(l)) {
    // another computer took the lock (both opened at once before the shared folder synced): they keep it
    mode = 'view'; holder = l;
    if (win) win.webContents.send('lock:changed', info());
    return;
  }
  writeLock(l && l.id === me.id ? l.since : Date.now());
}

// ---- changes made on another computer ----
function checkForChanges() {
  if (!fs.existsSync(dataFile)) return;
  let raw;
  try { raw = readJson(dataFile); } catch (_) { return; } // mid-sync or damaged: try again next time
  if (raw === lastWritten) return;
  if (mode === 'view') {
    lastWritten = raw;
    if (win) win.webContents.send('data:changed');
  } else {
    // someone else's copy arrived while we were editing: keep ours, put theirs to one side
    const aside = dataFile.replace(/\.json$/, `.from-another-computer-${Date.now()}.json`);
    fs.writeFileSync(aside, raw);
    fs.writeFileSync(dataFile, lastWritten);
    if (win) win.webContents.send('data:conflict', path.basename(aside));
  }
}

function info() {
  return { file: dataFile, folder: dataDir, keep: KEEP_BACKUPS, notice, mode, holder, me, cloud: cloudName(dataDir) };
}

ipcMain.on('data:load', e => { e.returnValue = loadData(); });
ipcMain.on('data:save', (e, json) => {
  if (mode !== 'edit') { e.returnValue = 'view-only'; return; }
  try { saveData(json); e.returnValue = true; } catch (err) { e.returnValue = err.message; }
});
ipcMain.on('data:info', e => { e.returnValue = info(); });
ipcMain.on('data:openFolder', () => { shell.openPath(dataDir); });
ipcMain.on('lock:retry', e => { if (mode !== 'edit') tryLock(); e.returnValue = info(); });

ipcMain.handle('data:chooseFolder', async () => {
  const pick = await dialog.showOpenDialog(win, {
    title: 'Choose where to keep the CareSchedule data', defaultPath: dataDir, properties: ['openDirectory', 'createDirectory'],
    message: 'To share with your office, choose a folder in Google Drive (or another shared drive).',
  });
  if (pick.canceled || !pick.filePaths[0] || path.resolve(pick.filePaths[0]) === path.resolve(dataDir)) return { changed: false };
  const newDir = pick.filePaths[0];
  const newFile = path.join(newDir, 'careschedule-data.json');
  let useTheirs = false;
  if (fs.existsSync(newFile)) {
    const when = fs.statSync(newFile).mtime.toLocaleString();
    const answer = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Use the data in that folder', 'Replace it with the data on this computer', 'Cancel'], defaultId: 0, cancelId: 2,
      message: 'That folder already has CareSchedule data', detail: `It was last changed ${when}. If your office already shares this folder, use the data in it.`,
    });
    if (answer.response === 2) return { changed: false };
    useTheirs = answer.response === 0;
  }
  const current = mode === 'edit' && fs.existsSync(dataFile) ? fs.readFileSync(dataFile, 'utf8') : null;
  releaseLock();
  setPaths(newDir);
  if (!useTheirs && current) saveData(current);
  writeConfig({ ...readConfig(), dataDir: newDir });
  tryLock();
  lastWritten = null;
  notice = null;
  return { changed: true, info: info() };
});

// Save the page's current print layout (a rota designed for carers) as a PDF.
ipcMain.handle('pdf:save', async (_, { name, landscape }) => {
  const pick = await dialog.showSaveDialog(win, {
    title: 'Save rota as PDF', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (pick.canceled || !pick.filePath) return { saved: false };
  const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, landscape: !!landscape });
  fs.writeFileSync(pick.filePath, pdf);
  shell.showItemInFolder(pick.filePath);
  return { saved: true, file: pick.filePath };
});

function pagePath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'CareSchedule.html') : path.join(__dirname, '..', 'CareSchedule.html');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600, title: 'CareSchedule',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // the page is local and offline: never navigate away or open other windows
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(pagePath());
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

// only one copy per computer, so two windows can't overwrite each other's changes
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    setPaths(defaultDir());
    tryLock();
    buildMenu();
    createWindow();
    setInterval(heartbeat, HEARTBEAT_MS);
    setInterval(checkForChanges, WATCH_MS);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('will-quit', releaseLock);
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
