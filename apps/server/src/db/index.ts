import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { DB_PATH, ensureDirs } from '../config.js'
import { runMigrations } from './migrate-lib.js'

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (_db) return _db

  ensureDirs()
  // allowExtension 是加载 sqlite-vec 的前提；不传会报 "extension loading is not allowed"
  const db = new DatabaseSync(DB_PATH, { allowExtension: true })

  // WAL：读写并发不互相阻塞；外键必须显式打开
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA synchronous = NORMAL')

  runMigrations(db)

  // 向量扩展：失败也不阻塞启动，检索会自动退化为纯全文
  void (async () => {
    try {
      const { initVectorStore } = await import('../services/vectorStore.js')
      const ok = initVectorStore(db)
      if (!ok) console.warn('[db] sqlite-vec 未能加载，向量检索关闭（关键词检索照常）')
    } catch (e) {
      console.warn('[db] sqlite-vec 初始化异常：', e instanceof Error ? e.message : e)
    }
  })()

  _db = db
  return db
}

export function closeDb(): void {
  if (_db) {
    try {
      _db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      _db.close()
    } catch {
      /* ignore */
    }
    _db = null
  }
}

/** 便利包装：单条查询 */
export function one<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...(params as never[])) as T | undefined
}

/** 便利包装：多行查询 */
export function all<T = unknown>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...(params as never[])) as T[]
}

/** 便利包装：写入（返回变更行数） */
export function run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
  const r = getDb().prepare(sql).run(...(params as never[]))
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
}

/** 数据库自检，给 /api/health 用 */
export function dbStatus(): { ok: boolean; path: string; version: number; sizeBytes: number } {
  try {
    const db = getDb()
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_migration').get() as { v: number | null }
    const size = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0
    return { ok: true, path: DB_PATH, version: Number(row?.v ?? 0), sizeBytes: size }
  } catch (err) {
    return {
      ok: false,
      path: DB_PATH,
      version: 0,
      sizeBytes: 0,
    }
  }
}

/** 判断库里有没有数据（给 Demo / 首次启动用） */
export function isEmptyLibrary(): boolean {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM course').get() as { c: number }
  return Number(row?.c ?? 0) === 0
}
