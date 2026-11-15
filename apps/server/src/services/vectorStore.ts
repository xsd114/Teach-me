import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { one } from '../db/index.js'

// 打包后是 CJS（__dirname 有），开发态是 ESM（没有）——两边都要能跑
declare const __dirname: string | undefined
const HERE = typeof __dirname === 'string' ? __dirname : process.cwd()

let ready = false
let dims = 512
let lastError = ''

const DLL_NAME = process.platform === 'win32' ? 'vec0.dll' : process.platform === 'darwin' ? 'vec0.dylib' : 'vec0.so'

/** 在某层的 node_modules 里找 vec0 扩展（含 pnpm 的 .pnpm 布局） */
function probeNodeModules(base: string): string | null {
  const direct = path.join(base, 'node_modules', 'sqlite-vec-windows-x64', DLL_NAME)
  if (fs.existsSync(direct)) return direct

  const pnpmDir = path.join(base, 'node_modules', '.pnpm')
  if (fs.existsSync(pnpmDir)) {
    try {
      for (const d of fs.readdirSync(pnpmDir)) {
        if (!d.startsWith('sqlite-vec-windows-x64@') && !d.startsWith('sqlite-vec-windows-x64')) continue
        const p = path.join(pnpmDir, d, 'node_modules', 'sqlite-vec-windows-x64', DLL_NAME)
        if (fs.existsSync(p)) return p
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

/**
 * 找 vec0 扩展文件。**不依赖 npm 的模块解析**——
 * 打包后 node_modules 往往不可靠，所以一律按文件路径找。
 *
 * 顺序：环境变量 → 打包目录 vendor/ → 当前目录 vendor/ → 向上最多 5 层的 node_modules
 */
function resolveVecPath(): string | null {
  if (process.env.ALP_VEC_DLL && fs.existsSync(process.env.ALP_VEC_DLL)) return process.env.ALP_VEC_DLL

  for (const c of [
    path.join(HERE, 'vendor', DLL_NAME),
    path.join(HERE, '..', 'vendor', DLL_NAME),
    path.join(process.cwd(), 'vendor', DLL_NAME),
  ]) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }

  let dir = HERE
  for (let i = 0; i < 5; i++) {
    const hit = probeNodeModules(dir)
    if (hit) return hit
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // 再从 cwd 试一遍（开发态 cwd 通常在仓库根）
  const fromCwd = probeNodeModules(process.cwd())
  if (fromCwd) return fromCwd

  return null
}

/** 读取配置的向量维度（改模型时要同步改 setting 并重建表） */
export function configuredDims(): number {
  const row = one<{ value: string }>(`SELECT value FROM setting WHERE key = 'embed.dims'`)
  const n = Number(row?.value)
  return Number.isFinite(n) && n > 0 ? n : 512
}

/**
 * 启动时初始化：加载 sqlite-vec 扩展 + 建 vec0 虚拟表。
 *
 * node:sqlite 的扩展加载必须用 `{ allowExtension: true }` 构造，
 * 否则 loadExtension 会报 "extension loading is not allowed"（实测踩过）。
 * 这里做成"可选能力"：加载失败不影响主流程，检索自动退化为纯 FTS。
 */
export function initVectorStore(db: DatabaseSync): boolean {
  try {
    const p = resolveVecPath()
    if (!p) throw new Error('找不到 vec0 扩展文件')
    db.loadExtension(p)
    dims = configuredDims()
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding float[${dims}]
      )
    `)
    ready = true
    lastError = ''
  } catch (e) {
    ready = false
    lastError = e instanceof Error ? e.message : String(e)
  }
  return ready
}

export function vectorStatus(): { ready: boolean; dims: number; error: string } {
  return { ready, dims, error: lastError }
}

/** 批量写入向量（先删后插，天然幂等） */
export function upsertVectors(db: DatabaseSync, items: { chunkId: number; vec: Float32Array }[]): void {
  if (!ready || items.length === 0) return
  const del = db.prepare(`DELETE FROM chunk_vec WHERE chunk_id = ?`)
  const ins = db.prepare(`INSERT INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)`)
  db.exec('BEGIN')
  try {
    for (const it of items) {
      del.run(BigInt(it.chunkId))
      ins.run(BigInt(it.chunkId), new Uint8Array(it.vec.buffer.slice(0)))
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function deleteVectors(db: DatabaseSync, chunkIds: number[]): void {
  if (!ready || chunkIds.length === 0) return
  const del = db.prepare(`DELETE FROM chunk_vec WHERE chunk_id = ?`)
  db.exec('BEGIN')
  try {
    for (const id of chunkIds) del.run(BigInt(id))
    db.exec('COMMIT')
  } catch {
    db.exec('ROLLBACK')
  }
}

/** KNN 检索，返回 chunkId 与距离（越小越像） */
export function knn(
  db: DatabaseSync,
  vec: Float32Array,
  k: number,
): { chunkId: number; distance: number }[] {
  if (!ready) return []
  try {
    const rows = db
      .prepare(
        `SELECT chunk_id AS chunkId, distance FROM chunk_vec
         WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
      )
      .all(new Uint8Array(vec.buffer.slice(0)), k) as { chunkId: number | bigint; distance: number }[]
    return rows.map((r) => ({ chunkId: Number(r.chunkId), distance: Number(r.distance) }))
  } catch {
    return []
  }
}

export function vectorCount(db: DatabaseSync): number {
  if (!ready) return 0
  try {
    const r = db.prepare(`SELECT COUNT(*) AS c FROM chunk_vec`).get() as { c: number }
    return Number(r?.c ?? 0)
  } catch {
    return 0
  }
}
