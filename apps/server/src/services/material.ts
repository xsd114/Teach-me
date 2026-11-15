import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { UPLOADS_DIR, CACHE_DIR } from '../config.js'
import { all, getDb, one, run } from '../db/index.js'
import { newId, nowIso } from '../lib/id.js'
import { parseFile, extOf } from './parse.js'
import { chunkText, docStats } from './chunk.js'
import { embedTexts, embedProvider } from './vector.js'
import { deleteVectors, upsertVectors, vectorStatus } from './vectorStore.js'

export type Material = {
  id: string
  courseId: string | null
  name: string
  kind: string
  origin: 'local' | 'web' | 'generated'
  sourceUrl: string | null
  filePath: string | null
  byteSize: number
  charCount: number
  parser: string | null
  degraded: boolean
  inMemory: boolean
  status: 'pending' | 'parsed' | 'indexed' | 'failed' | 'excluded'
  stage: string
  progress: number
  chunkCount: number
  error: string | null
  createdAt: string
  updatedAt: string
}

type Row = {
  id: string
  course_id: string | null
  name: string
  kind: string
  origin: 'local' | 'web' | 'generated'
  source_url: string | null
  file_path: string | null
  byte_size: number
  char_count: number
  parser: string | null
  degraded: number
  in_memory: number
  status: Material['status']
  stage: string
  progress: number
  chunk_count: number
  error: string | null
  created_at: string
  updated_at: string
}

function toMaterial(r: Row): Material {
  return {
    id: r.id,
    courseId: r.course_id,
    name: r.name,
    kind: r.kind,
    origin: r.origin,
    sourceUrl: r.source_url,
    filePath: r.file_path,
    byteSize: r.byte_size,
    charCount: r.char_count,
    parser: r.parser,
    degraded: Boolean(r.degraded),
    inMemory: Boolean(r.in_memory),
    status: r.status,
    stage: r.stage,
    progress: r.progress,
    chunkCount: r.chunk_count,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function listMaterials(courseId?: string | null): Material[] {
  const rows = courseId
    ? all<Row>(`SELECT * FROM material WHERE course_id = ? ORDER BY created_at DESC`, courseId)
    : all<Row>(`SELECT * FROM material ORDER BY created_at DESC`)
  return rows.map(toMaterial)
}

export function getMaterial(id: string): Material | null {
  const r = one<Row>(`SELECT * FROM material WHERE id = ?`, id)
  return r ? toMaterial(r) : null
}

function setStage(id: string, stage: string, progress: number, extra?: { status?: Material['status']; error?: string | null }) {
  const sets = ['stage = ?', 'progress = ?', 'updated_at = ?']
  const vals: unknown[] = [stage, progress, nowIso()]
  if (extra?.status) {
    sets.push('status = ?')
    vals.push(extra.status)
  }
  if (extra?.error !== undefined) {
    sets.push('error = ?')
    vals.push(extra.error)
  }
  vals.push(id)
  run(`UPDATE material SET ${sets.join(', ')} WHERE id = ?`, ...vals)
}

/* ------------------------------------------------------------------
   导入
   ------------------------------------------------------------------ */

export type ImportInput = {
  /** 本地文件路径（已存在） */
  filePath: string
  name?: string
  courseId?: string | null
  origin?: Material['origin']
  sourceUrl?: string
  /** 复制到 uploads 还是就地引用 */
  copy?: boolean
}

export function importFile(input: ImportInput): Material {
  const src = path.resolve(input.filePath)
  if (!fs.existsSync(src)) throw new Error(`文件不存在：${src}`)
  const st = fs.statSync(src)
  const name = input.name?.trim() || path.basename(src)
  const id = newId('mat')

  // 去重：同一课程内相同内容只留一份
  const hash = crypto.createHash('sha1').update(fs.readFileSync(src)).digest('hex')
  const dup = one<{ id: string }>(
    `SELECT id FROM material WHERE hash = ? AND IFNULL(course_id,'') = IFNULL(?,'')`,
    hash,
    input.courseId ?? null,
  )
  if (dup) {
    const existing = getMaterial(dup.id)
    if (existing) return existing
  }

  const dir = path.join(UPLOADS_DIR, input.courseId ?? '_library')
  fs.mkdirSync(dir, { recursive: true })
  let stored = src
  if (input.copy !== false) {
    stored = path.join(dir, `${id}${extOf(src) || '.bin'}`)
    fs.copyFileSync(src, stored)
  }

  const ts = nowIso()
  run(
    `INSERT INTO material
      (id, course_id, name, kind, origin, source_url, file_path, byte_size, char_count,
       parser, degraded, in_memory, status, stage, progress, chunk_count, error, hash, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?, NULL, 0, 1, 'pending', 'queued', 0, 0, NULL, ?, ?, ?)`,
    id,
    input.courseId ?? null,
    name,
    extOf(src).replace('.', '') || 'txt',
    input.origin ?? 'local',
    input.sourceUrl ?? null,
    stored,
    st.size,
    0,
    hash,
    ts,
    ts,
  )

  enqueue(id)
  return getMaterial(id)!
}

/** 把一段纯文本作为资料导入（网页抓取、AI 生成内容都走这里） */
export function importText(input: {
  name: string
  text: string
  courseId?: string | null
  origin?: Material['origin']
  sourceUrl?: string
}): Material {
  const id = newId('mat')
  const dir = path.join(UPLOADS_DIR, input.courseId ?? '_library')
  fs.mkdirSync(dir, { recursive: true })
  const stored = path.join(dir, `${id}.md`)
  fs.writeFileSync(stored, input.text, 'utf8')

  const hash = crypto.createHash('sha1').update(input.text).digest('hex')
  const ts = nowIso()
  run(
    `INSERT INTO material
      (id, course_id, name, kind, origin, source_url, file_path, byte_size, char_count,
       parser, degraded, in_memory, status, stage, progress, chunk_count, error, hash, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?, NULL, 0, 1, 'pending', 'queued', 0, 0, NULL, ?, ?, ?)`,
    id,
    input.courseId ?? null,
    input.name,
    'md',
    input.origin ?? 'web',
    input.sourceUrl ?? null,
    stored,
    Buffer.byteLength(input.text, 'utf8'),
    0,
    hash,
    ts,
    ts,
  )
  enqueue(id)
  return getMaterial(id)!
}

/* ------------------------------------------------------------------
   任务队列（串行，避免 CPU/内存被打满）
   ------------------------------------------------------------------ */

const queue: string[] = []
let running = false

export function enqueue(materialId: string): void {
  if (!queue.includes(materialId)) queue.push(materialId)
  void drain()
}

async function drain(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.length > 0) {
      const id = queue.shift()!
      try {
        await processMaterial(id)
      } catch (e) {
        setStage(id, 'failed', 100, { status: 'failed', error: e instanceof Error ? e.message : '处理失败' })
      }
    }
  } finally {
    running = false
  }
}

export function queueStatus(): { pending: number; running: boolean } {
  return { pending: queue.length, running }
}

/** 解析 → 分片 → 向量化，全流程 */
export async function processMaterial(id: string): Promise<void> {
  const m = getMaterial(id)
  if (!m) throw new Error('资料不存在')
  if (!m.filePath || !fs.existsSync(m.filePath)) throw new Error('源文件已丢失')

  // 1. 解析
  setStage(id, 'parsing', 10, { status: 'parsed', error: null })
  const parsed = await parseFile(m.filePath)
  if (!parsed.ok) {
    setStage(id, 'failed', 100, { status: 'failed', error: parsed.error ?? '解析失败' })
    return
  }

  const cachePath = path.join(CACHE_DIR, `${id}.md`)
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(cachePath, parsed.text, 'utf8')

  const stats = docStats(parsed.text)
  run(
    `UPDATE material SET parser = ?, degraded = ?, char_count = ?, updated_at = ? WHERE id = ?`,
    parsed.parser,
    parsed.degraded ? 1 : 0,
    stats.chars,
    nowIso(),
    id,
  )

  // 2. 分片（先清掉旧的）
  setStage(id, 'chunking', 35)
  const oldIds = all<{ id: number }>(`SELECT id FROM chunk WHERE material_id = ?`, id).map((r) =>
    Number(r.id),
  )
  deleteVectors(getDb(), oldIds)
  run(`DELETE FROM chunk WHERE material_id = ?`, id)

  const chunks = chunkText(parsed.text)
  const ins = getDb().prepare(
    `INSERT INTO chunk (material_id, course_id, order_index, text, heading_path, page, char_count, token_est)
     VALUES (?,?,?,?,?, NULL, ?, ?)`,
  )
  const newIds: number[] = []
  getDb().exec('BEGIN')
  try {
    for (const c of chunks) {
      // 参数顺序必须与上面的列名一致：material_id, course_id, order_index, text, heading_path, char_count, token_est
      const r = ins.run(id, m.courseId, c.orderIndex, c.text, c.headingPath, c.charCount, c.tokenEst)
      newIds.push(Number(r.lastInsertRowid))
    }
    getDb().exec('COMMIT')
  } catch (e) {
    getDb().exec('ROLLBACK')
    throw e
  }
  run(`UPDATE material SET chunk_count = ? WHERE id = ?`, chunks.length, id)

  // 3. 向量化（memory 关掉或 vec 不可用就跳过）
  const vs = vectorStatus()
  if (m.inMemory && vs.ready && chunks.length > 0) {
    setStage(id, 'embedding', 55)
    const batchRow = one<{ value: string }>(`SELECT value FROM setting WHERE key = 'embed.batch'`)
    const batch = Math.max(1, Math.min(64, Number(batchRow?.value ?? 16)))
    const total = chunks.length
    let done = 0

    for (let i = 0; i < chunks.length; i += batch) {
      const slice = chunks.slice(i, i + batch)
      const texts = slice.map((c) => c.text)
      const r = await embedTexts(texts)

      // 维度不一致说明换了模型，索引需要重建：直接跳过并记一次错误
      if (r.dims !== vs.dims) {
        run(
          `UPDATE material SET error = ?, updated_at = ? WHERE id = ?`,
          `向量维度不一致（模型 ${r.model} 输出 ${r.dims}，索引表是 ${vs.dims}）。请在设置里重建索引。`,
          nowIso(),
          id,
        )
        break
      }

      upsertVectors(
        getDb(),
        r.vectors.map((v, k) => ({ chunkId: newIds[i + k], vec: v })),
      )
      done += slice.length
      setStage(id, 'embedding', 55 + Math.round((done / total) * 40))
    }
  }

  setStage(id, 'done', 100, { status: 'indexed' })
}

/* ------------------------------------------------------------------
   编出记忆库 / 重建
   ------------------------------------------------------------------ */

/** 把某份资料"编出记忆库"：删 chunk、删向量，保留文件与元数据 */
export function excludeFromMemory(id: string): boolean {
  const m = getMaterial(id)
  if (!m) return false
  const ids = all<{ id: number }>(`SELECT id FROM chunk WHERE material_id = ?`, id).map((r) => Number(r.id))
  deleteVectors(getDb(), ids)
  run(`DELETE FROM chunk WHERE material_id = ?`, id)
  run(
    `UPDATE material SET in_memory = 0, status = 'excluded', chunk_count = 0, stage = 'excluded', progress = 100, updated_at = ? WHERE id = ?`,
    nowIso(),
    id,
  )
  return true
}

/** 重新编入记忆库 */
export function reincludeInMemory(id: string): boolean {
  const m = getMaterial(id)
  if (!m) return false
  run(`UPDATE material SET in_memory = 1, status = 'pending', stage = 'queued', progress = 0, updated_at = ? WHERE id = ?`, nowIso(), id)
  enqueue(id)
  return true
}

export function deleteMaterial(id: string): boolean {
  const m = getMaterial(id)
  if (!m) return false
  const ids = all<{ id: number }>(`SELECT id FROM chunk WHERE material_id = ?`, id).map((r) => Number(r.id))
  deleteVectors(getDb(), ids)
  try {
    if (m.filePath && fs.existsSync(m.filePath)) fs.rmSync(m.filePath)
    const cache = path.join(CACHE_DIR, `${id}.md`)
    if (fs.existsSync(cache)) fs.rmSync(cache)
  } catch {
    /* ignore */
  }
  return run(`DELETE FROM material WHERE id = ?`, id).changes > 0
}

/** 全库重建索引 */
export function reindexAll(courseId?: string | null): number {
  const list = courseId
    ? listMaterials(courseId)
    : listMaterials().filter((m) => m.courseId === null)
  let n = 0
  for (const m of list) {
    if (!m.inMemory) continue
    run(`UPDATE material SET status = 'pending', stage = 'queued', progress = 0, updated_at = ? WHERE id = ?`, nowIso(), m.id)
    enqueue(m.id)
    n++
  }
  return n
}

export function memoryStats(courseId?: string | null): {
  materials: number
  indexed: number
  chunks: number
  vectors: number
  chars: number
  provider: string
} {
  const where = courseId ? `WHERE m.course_id = ?` : ''
  const args = courseId ? [courseId] : []
  const r = one<{ materials: number; indexed: number; chars: number }>(
    `SELECT COUNT(*) AS materials,
            SUM(CASE WHEN m.status = 'indexed' THEN 1 ELSE 0 END) AS indexed,
            COALESCE(SUM(m.char_count),0) AS chars
       FROM material m ${where}`,
    ...args,
  )
  const c = one<{ chunks: number }>(
    `SELECT COUNT(*) AS chunks FROM chunk ${courseId ? 'WHERE course_id = ?' : ''}`,
    ...args,
  )
  const v = one<{ vectors: number }>(`SELECT COUNT(*) AS vectors FROM chunk_vec`)
  return {
    materials: Number(r?.materials ?? 0),
    indexed: Number(r?.indexed ?? 0),
    chunks: Number(c?.chunks ?? 0),
    vectors: Number(v?.vectors ?? 0),
    chars: Number(r?.chars ?? 0),
    provider: embedProvider(),
  }
}
