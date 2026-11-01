// What only the desktop app can do (see electron/preload.cjs). It is undefined in a browser
type Desktop = {
  platform: string
  setInterfaceSize: (percent: number) => void
}

export const desktop = (window as unknown as { lydiaDesktop?: Desktop }).lydiaDesktop
