const { contextBridge, ipcRenderer, webFrame } = require('electron')

// What the page can ask of the desktop app. The page runs like any web page, with no access to the computer, and this
// is the only door. window.lydiaDesktop is missing in a browser
contextBridge.exposeInMainWorld('lydiaDesktop', {
  platform: process.platform,
  memory: ipcRenderer.sendSync('memory'),
  setInterfaceSize: percent => webFrame.setZoomFactor(percent / 100),
  minimize: () => ipcRenderer.send('minimize'),
  setCloseTexts: texts => ipcRenderer.send('close-texts', texts),
  chooseToSave: name => ipcRenderer.invoke('choose-to-save', name),
  chooseToOpen: () => ipcRenderer.invoke('choose-to-open'),
  exportPath: name => ipcRenderer.invoke('export-path', name),
  listKept: kind => ipcRenderer.invoke('list-kept', kind),
  placeToKeep: (kind, name) => ipcRenderer.invoke('place-to-keep', kind, name),
  keptFile: (kind, name) => ipcRenderer.invoke('kept-file', kind, name),
  removeKept: (kind, name) => ipcRenderer.invoke('remove-kept', kind, name),
  startWriting: file => ipcRenderer.invoke('start-writing', file),
  writeChunk: (id, bytes) => ipcRenderer.invoke('write-chunk', id, bytes),
  finishWriting: id => ipcRenderer.invoke('finish-writing', id),
  abortWriting: id => ipcRenderer.invoke('abort-writing', id),
  sizeOf: file => ipcRenderer.invoke('size-of', file),
  readChunk: (file, offset, length) => ipcRenderer.invoke('read-chunk', file, offset, length),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  // A project the system asked Lydia to open: the one it started with, and any later
  takeOpenedFile: () => ipcRenderer.invoke('take-opened-file'),
  onFileOpened: listener => ipcRenderer.on('file-opened', (_event, file) => listener(file)),
})
