// npm run desktop: the desktop app on Vite's server, so changes to the pages show as in the browser. Changes to the
// electron folder need this started again
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const electron = createRequire(import.meta.url)('electron')

const server = await createServer({ server: { port: 5174 } })
await server.listen()
const address = server.resolvedUrls.local[0]
console.log(`Lydia at ${address}`)

// Some terminals inside editors set this, and Electron would start as plain Node
const env = { ...process.env, LYDIA_DEV_URL: address }
delete env.ELECTRON_RUN_AS_NODE
const app = spawn(electron, ['.'], { stdio: 'inherit', env })
app.on('close', async code => {
  await server.close()
  process.exit(code ?? 0)
})
