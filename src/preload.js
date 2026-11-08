const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  platform: process.platform,
  load: () => ipcRenderer.invoke('data:load'),
  save: (text) => ipcRenderer.invoke('data:save', text),
  dataLocation: () => ipcRenderer.invoke('data:location'),
  revealData: () => ipcRenderer.invoke('data:reveal'),
  exportHtml: (title, html) => ipcRenderer.invoke('export:html', { title, html }),
  exportPdf: (title, html) => ipcRenderer.invoke('export:pdf', { title, html }),
  showFile: (p) => ipcRenderer.invoke('shell:open', p),
  pickImage: () => ipcRenderer.invoke('image:pick'),
  onFlush: (cb) => ipcRenderer.on('app:flush', () => cb()),
  flushed: () => ipcRenderer.send('app:flushed'),
});
