import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const result = spawnSync(require('electron'), [fileURLToPath(new URL('./native-check.mjs', import.meta.url))], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit'
})
process.exit(result.status ?? 1)
