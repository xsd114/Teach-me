import { all, one, run } from '../db/index.js'
import { newId, nowIso } from '../lib/id.js'

export type LessonState = 'todo' | 'doing' | 'review' | 'done'

type LessonRow = {
  id: string
  course_id: string
  order_index: number
  title: string
  summary: string
  state: LessonState
  mastery: number
  created_at: string
  updated_at: string
}

export type Lesson = {
  id: string
  courseId: string
  orderIndex: number
  title: string
  summary: string
  state: LessonState
  mastery: number
  createdAt: string
  updatedAt: string
}

function toLesson(r: LessonRow): Lesson {
  return {
    id: r.id,
    courseId: r.course_id,
    orderIndex: r.order_index,
    title: r.title,
    summary: r.summary,
    state: r.state,
    mastery: r.mastery,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function listLessons(courseId: string): Lesson[] {
  return all<LessonRow>(
    `SELECT * FROM lesson WHERE course_id = ? ORDER BY order_index`,
    courseId,
  ).map(toLesson)
}

export function getLesson(id: string): Lesson | null {
  const r = one<LessonRow>(`SELECT * FROM lesson WHERE id = ?`, id)
  return r ? toLesson(r) : null
}

export type CreateLessonInput = {
  title: string
  summary?: string
  orderIndex?: number
}

export function createLesson(courseId: string, input: CreateLessonInput): Lesson {
  const ts = nowIso()
  const max = one<{ m: number | null }>(
    `SELECT MAX(order_index) AS m FROM lesson WHERE course_id = ?`,
    courseId,
  )
  const orderIndex = input.orderIndex ?? Number(max?.m ?? -1) + 1
  const id = newId('lsn')
  run(
    `INSERT INTO lesson (id, course_id, order_index, title, summary, state, mastery, created_at, updated_at)
     VALUES (?,?,?,?,?, 'todo', 0, ?, ?)`,
    id,
    courseId,
    orderIndex,
    input.title.trim(),
    input.summary ?? '',
    ts,
    ts,
  )
  return getLesson(id)!
}

export type UpdateLessonInput = {
  title?: string
  summary?: string
  state?: LessonState
  mastery?: number
  orderIndex?: number
}

const STATES: LessonState[] = ['todo', 'doing', 'review', 'done']

export function updateLesson(id: string, patch: UpdateLessonInput): Lesson | null {
  const existing = one<LessonRow>(`SELECT * FROM lesson WHERE id = ?`, id)
  if (!existing) return null

  const sets: string[] = []
  const vals: unknown[] = []
  if (typeof patch.title === 'string' && patch.title.trim()) {
    sets.push('title = ?')
    vals.push(patch.title.trim())
  }
  if (typeof patch.summary === 'string') {
    sets.push('summary = ?')
    vals.push(patch.summary)
  }
  if (patch.state && STATES.includes(patch.state)) {
    sets.push('state = ?')
    vals.push(patch.state)
  }
  if (typeof patch.mastery === 'number') {
    sets.push('mastery = ?')
    vals.push(Math.max(0, Math.min(1, patch.mastery)))
  }
  if (typeof patch.orderIndex === 'number') {
    sets.push('order_index = ?')
    vals.push(Math.round(patch.orderIndex))
  }
  if (sets.length === 0) return getLesson(id)

  sets.push('updated_at = ?')
  vals.push(nowIso(), id)
  run(`UPDATE lesson SET ${sets.join(', ')} WHERE id = ?`, ...vals)
  return getLesson(id)
}

export function deleteLesson(id: string): boolean {
  return run(`DELETE FROM lesson WHERE id = ?`, id).changes > 0
}
