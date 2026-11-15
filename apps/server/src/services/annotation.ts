import { all, one, run } from '../db/index.js'
import { newId, nowIso } from '../lib/id.js'

export type Annotation = {
  id: string
  courseId: string
  sourceKind: 'chapter' | 'material' | 'qa' | 'note'
  sourceId: string | null
  text: string
  note: string
  color: 'yellow' | 'white' | 'blue'
  startOffset: number
  endOffset: number
  inMemory: boolean
  createdAt: string
}

type Row = {
  id: string
  course_id: string
  source_kind: string
  source_id: string | null
  text: string
  note: string
  color: string
  start_offset: number
  end_offset: number
  in_memory: number
  created_at: string
}

function toAnnotation(r: Row): Annotation {
  return {
    id: r.id,
    courseId: r.course_id,
    sourceKind: (r.source_kind as Annotation['sourceKind']) ?? 'chapter',
    sourceId: r.source_id,
    text: r.text,
    note: r.note,
    color: (['yellow', 'white', 'blue'].includes(r.color) ? r.color : 'yellow') as Annotation['color'],
    startOffset: r.start_offset,
    endOffset: r.end_offset,
    inMemory: Boolean(r.in_memory),
    createdAt: r.created_at,
  }
}

export function listAnnotations(courseId: string, sourceId?: string | null): Annotation[] {
  const rows = sourceId
    ? all<Row>(`SELECT * FROM annotation WHERE course_id = ? AND source_id = ? ORDER BY start_offset`, courseId, sourceId)
    : all<Row>(`SELECT * FROM annotation WHERE course_id = ? ORDER BY created_at DESC`, courseId)
  return rows.map(toAnnotation)
}

export function createAnnotation(input: {
  courseId: string
  sourceKind?: Annotation['sourceKind']
  sourceId?: string | null
  text: string
  note?: string
  color?: Annotation['color']
  startOffset?: number
  endOffset?: number
  inMemory?: boolean
}): Annotation {
  const id = newId('ann')
  run(
    `INSERT INTO annotation
      (id, course_id, source_kind, source_id, text, note, color, start_offset, end_offset, in_memory, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    input.courseId,
    input.sourceKind ?? 'chapter',
    input.sourceId ?? null,
    input.text.trim(),
    input.note?.trim() ?? '',
    input.color ?? 'yellow',
    input.startOffset ?? -1,
    input.endOffset ?? -1,
    input.inMemory ? 1 : 0,
    nowIso(),
  )
  const r = one<Row>(`SELECT * FROM annotation WHERE id = ?`, id)!
  return toAnnotation(r)
}

/** 改一条标记的颜色（点已标记的文字换色） */
export function setAnnotationColor(id: string, color: string): boolean {
  const ok = ['yellow', 'white', 'blue'].includes(color) ? color : 'yellow'
  const r = run(`UPDATE annotation SET color = ? WHERE id = ?`, ok, id)
  return r.changes > 0
}

export function deleteAnnotation(id: string): boolean {
  return run(`DELETE FROM annotation WHERE id = ?`, id).changes > 0
}

/** 把标记用到的文字汇成一段"学生关心的点"，教学时可以作为上下文 */
export function memorySnippets(courseId: string, limit = 12): string[] {
  const rows = all<{ text: string; note: string }>(
    `SELECT text, note FROM annotation WHERE course_id = ? ORDER BY created_at DESC LIMIT ?`,
    courseId,
    limit,
  )
  return rows.map((r) => (r.note ? `${r.text}（${r.note}）` : r.text))
}

/* ------------------------------------------------------------------
   划词问答：临时对话 → 一键转"待处理"
   ------------------------------------------------------------------ */

export function markThreadPending(
  threadId: string,
  opts: { courseId: string; quote: string; sourceRef?: string | null },
): { ok: boolean; annotationId?: string } {
  const th = one<{ id: string; course_id: string | null; title: string }>(
    `SELECT id, course_id, title FROM qa_thread WHERE id = ?`,
    threadId,
  )
  if (!th) return { ok: false }

  run(
    `UPDATE qa_thread SET origin = 'selection', pending = 1, quote = ?, source_ref = ?, updated_at = ? WHERE id = ?`,
    opts.quote,
    opts.sourceRef ?? null,
    nowIso(),
    threadId,
  )

  // 同时在标记库里留一条，教学检索时能用到
  const ann = createAnnotation({
    courseId: opts.courseId,
    sourceKind: 'qa',
    sourceId: threadId,
    text: opts.quote,
    note: th.title,
    color: 'blue',
    inMemory: true,
  })

  return { ok: true, annotationId: ann.id }
}

export function listPendingThreads(courseId: string): {
  id: string
  title: string
  quote: string
  updatedAt: string
}[] {
  return all<{ id: string; title: string; quote: string; updated_at: string }>(
    `SELECT id, title, quote, updated_at FROM qa_thread
      WHERE course_id = ? AND pending = 1 ORDER BY updated_at DESC LIMIT 50`,
    courseId,
  ).map((r) => ({ id: r.id, title: r.title, quote: r.quote, updatedAt: r.updated_at }))
}

export function clearPending(threadId: string): boolean {
  return run(`UPDATE qa_thread SET pending = 0 WHERE id = ?`, threadId).changes > 0
}
