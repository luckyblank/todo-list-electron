import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const require = createRequire(import.meta.url)
const electron = require('electron')
const vitestCli = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
// Execute tests with the same Node ABI as the shipped SQLite binary.
const result = spawnSync(electron, [vitestCli, ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
process.exit(result.status ?? 1)
