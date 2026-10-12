// The desktop app's bridge to the page: what src/desktop.ts describes as window.bridgeDesktop.
// Preloads run sandboxed, so this is CommonJS and talks to the main process only through IPC.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridgeDesktop', {
  version: ipcRenderer.sendSync('bridge:version'),
  saveFile: (name, data) => ipcRenderer.invoke('bridge:save-file', name, data),
});
