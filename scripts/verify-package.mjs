import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const executable = join(root, 'dist', 'win-unpacked', 'To-Do List.exe')
if (!process.versions.electron) {
  const result = spawnSync(executable, [fileURLToPath(import.meta.url)], {
    stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
} else {
  const require = createRequire(import.meta.url)
  const { extractFile } = require('@electron/asar')
  const archive = join(root, 'dist', 'win-unpacked', 'resources', 'app.asar')
  for (const relative of ['out/main/index.js', 'out/preload/index.cjs', 'out/renderer/index.html', 'resources/app-icon.png', 'resources/licenses/NotoSansSC-OFL.txt']) {
    assert(extractFile(archive, join(...relative.split('/'))).equals(readFileSync(join(root, relative))), `Packaged resource differs from current source/build: ${relative}`)
  }
  const main = extractFile(archive, join('out', 'main', 'index.js')).toString('utf8')
  assert(main.includes('创建你的第一个任务') && main.includes('欢迎使用 To-Do List'), 'The packaged main process is missing its starter tasks')
  assert(main.includes('seedInitialTasks: app.isPackaged'), 'The packaged-only initialization guard is missing')
  const packagedRequire = createRequire(join(archive, 'package.json'))
  const Database = packagedRequire('better-sqlite3')
  const database = new Database(':memory:')
  const version = database.prepare('SELECT sqlite_version() AS version').get().version
  database.close()
  console.log(`Packaged resources, starter tasks, icon and license verified; SQLite ${version} loaded by shipped Electron ${process.versions.electron}.`)
}
