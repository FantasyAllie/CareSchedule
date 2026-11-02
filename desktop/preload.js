// Gives the page (CareSchedule.html) a small, fixed set of calls for its data file – nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('careDesktop', {
  load: () => ipcRenderer.sendSync('data:load'),
  save: json => ipcRenderer.sendSync('data:save', json),
  info: () => ipcRenderer.sendSync('data:info'),
  openFolder: () => ipcRenderer.send('data:openFolder'),
  chooseFolder: () => ipcRenderer.invoke('data:chooseFolder'),
  retryLock: () => ipcRenderer.sendSync('lock:retry'),
  savePdf: opts => ipcRenderer.invoke('pdf:save', opts),
  onChanged: cb => ipcRenderer.on('data:changed', () => cb()),
  onConflict: cb => ipcRenderer.on('data:conflict', (_, name) => cb(name)),
  onLockChanged: cb => ipcRenderer.on('lock:changed', (_, info) => cb(info)),
});
