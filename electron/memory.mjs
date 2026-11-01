import { app } from 'electron'
import { execFile } from 'node:child_process'
import os from 'node:os'

// How much memory the computer has, for the page, which a browser only knows roughly (decisions 14 and 28). Electron knows
// the graphics card's name but not its memory, which Windows keeps in the registry, one key for each display card

const CARDS_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'
const READING_MS = 3000 // a registry that doesn't answer leaves the memory unknown, and the window can't wait for it

function queryCards(value) {
  return new Promise(resolve => {
    const args = ['query', CARDS_KEY, '/s', '/v', value]
    execFile('reg', args, { timeout: READING_MS, windowsHide: true }, (_error, output) => resolve(output ?? ''))
  })
}

// The value in each key of what "reg query" says: a line with the key, and an indented one with its name, type and value
function valuesByKey(output) {
  const values = new Map()
  let key = null
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('HKEY_')) key = line
    const value = line.match(/REG_\w+\s+(.+)$/)
    if (key && value) values.set(key, value[1].trim())
  }
  return values
}

async function activeCardName() {
  const { gpuDevice = [] } = await app.getGPUInfo('basic').catch(() => ({}))
  return gpuDevice.find(device => device.active)?.deviceString
}

// In bytes. A laptop has two cards: the one drawing the window, or the biggest if that one can't be told
async function windowsCardMemory() {
  const [names, sizes, activeName] = await Promise.all([
    queryCards('DriverDesc').then(valuesByKey),
    queryCards('HardwareInformation.qwMemorySize').then(valuesByKey),
    activeCardName(),
  ])
  const cards = [...sizes].map(([key, size]) => ({ name: names.get(key), size: Number(size) }))
  const usable = cards.filter(({ size }) => size > 0)
  const active = usable.find(({ name }) => name === activeName)
  return active?.size ?? (usable.length > 0 ? Math.max(...usable.map(({ size }) => size)) : null)
}

// "card": null where it can't be told. A Mac has none of its own: the graphics card shares the RAM
export async function readMemory() {
  const card = process.platform === 'win32' ? await windowsCardMemory().catch(() => null) : null
  return { ram: os.totalmem(), card }
}
