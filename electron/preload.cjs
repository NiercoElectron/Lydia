const { contextBridge, webFrame } = require('electron')

// What the page can ask of the desktop app. The page runs like any web page, with no access to the computer, and this
// is the only door. window.lydiaDesktop is missing in a browser
contextBridge.exposeInMainWorld('lydiaDesktop', {
  platform: process.platform,
  setInterfaceSize: percent => webFrame.setZoomFactor(percent / 100),
})
