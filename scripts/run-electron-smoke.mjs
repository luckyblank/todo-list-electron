import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const result = spawnSync(require('electron'), [fileURLToPath(new URL('./electron-smoke.mjs', import.meta.url)), ...process.argv.slice(2)], {
  stdio: 'inherit', env: environment
})
process.exit(result.status ?? 1)
