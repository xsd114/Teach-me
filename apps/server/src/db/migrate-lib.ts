import { MIGRATIONS, type Migration } from './schema.js'

type Db = import('node:sqlite').DatabaseSync

/**
 * 极简迁移器：按 version 顺序执行，每个版本一个事务。
 * 已执行的记录在 schema_migration 表里，重复调用是安全的。
 */
export function runMigrations(db: Db, opts: { quiet?: boolean } = {}): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const rows = db.prepare('SELECT version FROM schema_migration').all() as { version: number }[]
  const applied = new Set(rows.map((r) => Number(r.version)))
  const pending = MIGRATIONS.filter((m: Migration) => !applied.has(m.version)).sort(
    (a, b) => a.version - b.version,
  )

  if (pending.length === 0) {
    if (!opts.quiet) console.log(`[db] schema up to date (v${Math.max(0, ...applied)})`)
    return
  }

  for (const m of pending) {
    const t0 = Date.now()
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migration(version, applied_at) VALUES (?, ?)').run(
        m.version,
        new Date().toISOString(),
      )
      db.exec('COMMIT')
      if (!opts.quiet) console.log(`[db] migration v${m.version} (${m.name}) applied in ${Date.now() - t0}ms`)
    } catch (err) {
      db.exec('ROLLBACK')
      console.error(`[db] migration v${m.version} (${m.name}) FAILED — rolled back`)
      throw err
    }
  }
}
