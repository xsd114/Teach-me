/**
 * 迁移 CLI：
 *   pnpm db:migrate           跑一次迁移
 *   pnpm db:reset             删库重建（会问一次，且自动备份旧库）
 */
import fs from 'node:fs'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { ALP_HOME, DB_PATH, ensureDirs } from '../config.js'
import { runMigrations } from './migrate-lib.js'

async function main() {
  ensureDirs()
  const reset = process.argv.includes('--reset')

  if (reset && fs.existsSync(DB_PATH)) {
    const rl = readline.createInterface({ input: stdin, output: stdout })
    const ans = await rl.question(`即将删除 ${DB_PATH}\n确认？(yes/N) `)
    rl.close()
    if (ans.trim().toLowerCase() !== 'yes') {
      console.log('已取消')
      return
    }
    const backup = `${ALP_HOME}/alp-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
    fs.copyFileSync(DB_PATH, backup)
    console.log(`[db] 旧库已备份 → ${backup}`)
    for (const suffix of ['', '-wal', '-shm']) {
      const f = DB_PATH + suffix
      if (fs.existsSync(f)) fs.rmSync(f)
    }
    console.log('[db] 旧库已删除')
  }

  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(db)

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[]
  console.log(`[db] ${DB_PATH}`)
  console.log(`[db] ${tables.length} 张表：${tables.map((t) => t.name).join(', ')}`)
  db.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
