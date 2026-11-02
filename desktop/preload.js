// Gives the page (CareSchedule.html) a small, fixed set of calls for its data file – nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('careDesktop', {
  load: () => ipcRenderer.sendSync('data:load'),
  save: json => ipcRenderer.sendSync('data:save', json),
  info: () => ipcRenderer.sendSync('data:info'),
  openFolder: () => ipcRenderer.send('data:openFolder'),
});
