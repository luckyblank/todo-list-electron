import Database from 'better-sqlite3'
const database = new Database(':memory:')
const result = database.prepare('SELECT sqlite_version() AS version').get()
database.close()
console.log(`SQLite ${result.version} verified in Electron ${process.versions.electron}`)
