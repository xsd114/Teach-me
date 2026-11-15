import { all, one, run } from '../db/index.js'
import { newId, nowIso } from '../lib/id.js'

export type CourseKind = 'skill' | 'academic'
export type MemoryMode = 'auto' | 'on' | 'off'
export type CourseStatus = 'active' | 'archived'

/** 数据库行（snake_case） */
type CourseRow = {
  id: string
  title: string
  kind: CourseKind
  goal: string
  baseline: string
  cover: string
  per_day_minutes: number
  per_day_items: number
  deadline: string | null
  memory_mode: MemoryMode
  verbosity: number
  status: CourseStatus
  sort_index: number
  created_at: string
  updated_at: string
}

/** 对外 JSON（camelCase） */
export type Course = {
  id: string
  title: string
  kind: CourseKind
  goal: string
  baseline: string
  cover: string
  perDayMinutes: number
  perDayItems: number
  deadline: string | null
  memoryMode: MemoryMode
  verbosity: number
  status: CourseStatus
  sortIndex: number
  createdAt: string
  updatedAt: string
  options?: CourseOptions
  stats: {
    lessonTotal: number
    lessonDone: number
    mastery: number
    lastStudiedAt: string | null
  }
}

function toCourse(row: CourseRow, stats?: Course['stats']): Course {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    goal: row.goal,
    baseline: row.baseline,
    cover: row.cover,
    perDayMinutes: row.per_day_minutes,
    perDayItems: row.per_day_items,
    deadline: row.deadline,
    memoryMode: row.memory_mode,
    verbosity: row.verbosity,
    status: row.status,
    sortIndex: row.sort_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stats: stats ?? { lessonTotal: 0, lessonDone: 0, mastery: 0, lastStudiedAt: null },
  }
}

function statsFor(courseId: string): Course['stats'] {
  const ls = one<{ total: number; done: number; mastery: number | null }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN state = 'done' THEN 1 ELSE 0 END) AS done,
            AVG(mastery) AS mastery
       FROM lesson WHERE course_id = ?`,
    courseId,
  )
  const last = one<{ at: string | null }>(
    `SELECT MAX(started_at) AS at FROM teaching_log WHERE course_id = ?`,
    courseId,
  )
  return {
    lessonTotal: Number(ls?.total ?? 0),
    lessonDone: Number(ls?.done ?? 0),
    mastery: Number(ls?.mastery ?? 0),
    lastStudiedAt: last?.at ?? null,
  }
}

export function listCourses(status: CourseStatus | 'all' = 'active'): Course[] {
  const rows =
    status === 'all'
      ? all<CourseRow>(`SELECT * FROM course ORDER BY sort_index, created_at`)
      : all<CourseRow>(`SELECT * FROM course WHERE status = ? ORDER BY sort_index, created_at`, status)
  return rows.map((r) => toCourse(r, statsFor(r.id)))
}

export function getCourse(id: string): Course | null {
  const row = one<CourseRow>(`SELECT * FROM course WHERE id = ?`, id)
  return row ? toCourse(row, statsFor(id)) : null
}

export type CourseOptions = {
  /** course = AI 给你写一本；book = 按你导入的书来教 */
  mode?: 'course' | 'book'
  /** 要不要去网上找补充材料 */
  searchMore?: boolean
  /** 要不要整理关键词与参考文档 */
  withKeywords?: boolean
}

export type CreateCourseInput = {
  options?: CourseOptions
  title: string
  kind: CourseKind
  goal?: string
  baseline?: string
  cover?: string
  perDayMinutes?: number
  perDayItems?: number
  deadline?: string | null
  memoryMode?: MemoryMode
  verbosity?: number
}

export function createCourse(input: CreateCourseInput): Course {
  const id = newId('crs')
  const ts = nowIso()
  const maxRow = one<{ m: number | null }>(`SELECT MAX(sort_index) AS m FROM course`)
  const sortIndex = Number(maxRow?.m ?? -1) + 1

  run(
    `INSERT INTO course
      (id, title, kind, goal, baseline, cover, per_day_minutes, per_day_items, deadline,
       memory_mode, verbosity, status, sort_index, options_json, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'active', ?,?,?,?)`,
    id,
    input.title.trim(),
    input.kind,
    input.goal ?? '',
    input.baseline ?? '',
    input.cover ?? '',
    clampInt(input.perDayMinutes ?? 30, 5, 600),
    clampInt(input.perDayItems ?? 0, 0, 500),
    input.deadline ?? null,
    input.memoryMode ?? 'auto',
    clampInt(input.verbosity ?? 3, 1, 5),
    sortIndex,
    JSON.stringify(input.options ?? {}),
    ts,
    ts,
  )

  // 每门课都有且只有一条"优先阅读条目"
  run(`INSERT INTO course_memory_pin(course_id, content, auto_updated_at) VALUES (?,?,?)`, id, '', ts)

  return getCourse(id)!
}

export type UpdateCourseInput = Partial<CreateCourseInput> & { status?: CourseStatus; sortIndex?: number }

export function updateCourse(id: string, patch: UpdateCourseInput): Course | null {
  const existing = one<CourseRow>(`SELECT * FROM course WHERE id = ?`, id)
  if (!existing) return null

  const map: Record<string, string> = {
    title: 'title',
    kind: 'kind',
    goal: 'goal',
    baseline: 'baseline',
    cover: 'cover',
    perDayMinutes: 'per_day_minutes',
    perDayItems: 'per_day_items',
    deadline: 'deadline',
    memoryMode: 'memory_mode',
    status: 'status',
    sortIndex: 'sort_index',
  }

  const sets: string[] = []
  const vals: unknown[] = []

  for (const [k, col] of Object.entries(map)) {
    if (!(k in patch)) continue
    let v = (patch as Record<string, unknown>)[k]
    if (k === 'verbosity') continue
    if (k === 'perDayMinutes') v = clampInt(Number(v), 5, 600)
    if (k === 'perDayItems') v = clampInt(Number(v), 0, 500)
    sets.push(`${col} = ?`)
    vals.push(v)
  }
  if (typeof patch.verbosity === 'number') {
    sets.push('verbosity = ?')
    vals.push(clampInt(patch.verbosity, 1, 5))
  }
  if (sets.length === 0) return getCourse(id)

  sets.push('updated_at = ?')
  vals.push(nowIso(), id)
  run(`UPDATE course SET ${sets.join(', ')} WHERE id = ?`, ...vals)
  return getCourse(id)
}

/**
 * 删除课程。
 *
 * purgeMemory = false 时，先把这门课的资料从课程上摘下来变成全局书库，
 * 这样外键 CASCADE 不会把它们的 chunk 和向量一起带走 —— 记忆库保住。
 * 其余挂在课程上的东西（课时、教材、题目、教学记录）照常删。
 */
export function deleteCourse(id: string, purgeMemory = true): boolean {
  if (!purgeMemory) {
    run(`UPDATE material SET course_id = NULL WHERE course_id = ?`, id)
    run(`UPDATE chunk SET course_id = NULL WHERE course_id = ?`, id)
  }
  const r = run(`DELETE FROM course WHERE id = ?`, id)
  return r.changes > 0
}

/** 删之前先告诉用户这门课的记忆库有多大 */
export function courseMemoryStat(id: string): { materials: number; chunks: number } {
  const m = one<{ c: number }>(`SELECT COUNT(*) AS c FROM material WHERE course_id = ?`, id)
  const c = one<{ c: number }>(`SELECT COUNT(*) AS c FROM chunk WHERE course_id = ?`, id)
  return { materials: Number(m?.c ?? 0), chunks: Number(c?.c ?? 0) }
}

export function reorderCourses(orderedIds: string[]): void {
  const ts = nowIso()
  orderedIds.forEach((id, i) => {
    run(`UPDATE course SET sort_index = ?, updated_at = ? WHERE id = ?`, i, ts, id)
  })
}

function clampInt(n: number, min: number, max: number): number {
  const v = Math.round(Number.isFinite(n) ? n : min)
  return Math.min(max, Math.max(min, v))
}
