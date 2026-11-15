import { all, one, run } from '../db/index.js'
import { newId } from '../lib/id.js'

export type DailyPoint = { date: string; minutes: number; sessions: number; questions: number }
export type MasteryPoint = { date: string; value: number; lessonId: string | null }
export type HeatCell = { date: string; minutes: number; level: 0 | 1 | 2 | 3 | 4 }

export type ProgressPayload = {
  daily: DailyPoint[]
  mastery: MasteryPoint[]
  heatmap: HeatCell[]
  totals: { minutes: number; sessions: number; days: number; streak: number }
  lessons: { id: string; title: string; state: string; mastery: number }[]
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function progressFor(courseId: string | null, days = 30): ProgressPayload {
  const since = new Date(Date.now() - days * 86_400_000)
  const sinceIso = since.toISOString()

  const where = courseId ? 'course_id = ? AND started_at >= ?' : 'started_at >= ?'
  const args = courseId ? [courseId, sinceIso] : [sinceIso]

  const dailyRows = all<{ day: string; sec: number; n: number }>(
    `SELECT substr(started_at, 1, 10) AS day,
            COALESCE(SUM(duration_sec),0) AS sec,
            COUNT(*) AS n
       FROM teaching_log
      WHERE ${where}
      GROUP BY day ORDER BY day`,
    ...args,
  )

  const qRows = all<{ day: string; n: number }>(
    `SELECT substr(a.answered_at,1,10) AS day, COUNT(*) AS n
       FROM attempt a
       JOIN question q ON q.id = a.question_id
      WHERE ${courseId ? 'q.course_id = ? AND a.answered_at >= ?' : 'a.answered_at >= ?'}
      GROUP BY day`,
    ...args,
  )
  const qMap = new Map(qRows.map((r) => [r.day, Number(r.n)]))

  const daily: DailyPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = ymd(new Date(Date.now() - i * 86_400_000))
    const hit = dailyRows.find((r) => r.day === d)
    daily.push({
      date: d,
      minutes: Math.round(Number(hit?.sec ?? 0) / 60),
      sessions: Number(hit?.n ?? 0),
      questions: qMap.get(d) ?? 0,
    })
  }

  const masteryRows = all<{ started_at: string; mastery_after: number | null; lesson_id: string | null }>(
    `SELECT started_at, mastery_after, lesson_id FROM teaching_log
      WHERE ${where} AND mastery_after IS NOT NULL
      ORDER BY started_at`,
    ...args,
  )
  const mastery: MasteryPoint[] = masteryRows.map((r) => ({
    date: r.started_at.slice(0, 10),
    value: Number(r.mastery_after ?? 0),
    lessonId: r.lesson_id,
  }))

  // 热力图：最近 12 周（84 天）
  const heatDays = 84
  const heatRows = all<{ day: string; sec: number }>(
    `SELECT substr(started_at,1,10) AS day, COALESCE(SUM(duration_sec),0) AS sec
       FROM teaching_log
      WHERE ${courseId ? 'course_id = ? AND started_at >= ?' : 'started_at >= ?'}
      GROUP BY day`,
    ...(courseId
      ? [courseId, new Date(Date.now() - heatDays * 86_400_000).toISOString()]
      : [new Date(Date.now() - heatDays * 86_400_000).toISOString()]),
  )
  const heatMap = new Map(heatRows.map((r) => [r.day, Math.round(Number(r.sec) / 60)]))

  const heatmap: HeatCell[] = []
  for (let i = heatDays - 1; i >= 0; i--) {
    const d = ymd(new Date(Date.now() - i * 86_400_000))
    const m = heatMap.get(d) ?? 0
    const level: HeatCell['level'] = m === 0 ? 0 : m < 15 ? 1 : m < 30 ? 2 : m < 60 ? 3 : 4
    heatmap.push({ date: d, minutes: m, level })
  }

  const totalsRow = one<{ sec: number; n: number }>(
    `SELECT COALESCE(SUM(duration_sec),0) AS sec, COUNT(*) AS n FROM teaching_log WHERE ${where}`,
    ...args,
  )

  const activeDays = daily.filter((d) => d.minutes > 0).length

  // 连续天数（从今天往前数）
  let streak = 0
  for (let i = daily.length - 1; i >= 0; i--) {
    if (daily[i].minutes > 0) streak++
    else break
  }

  const lessons = courseId
    ? all<{ id: string; title: string; state: string; mastery: number }>(
        `SELECT id, title, state, mastery FROM lesson WHERE course_id = ? ORDER BY order_index`,
        courseId,
      )
    : []

  return {
    daily,
    mastery,
    heatmap,
    totals: {
      minutes: Math.round(Number(totalsRow?.sec ?? 0) / 60),
      sessions: Number(totalsRow?.n ?? 0),
      days: activeDays,
      streak,
    },
    lessons,
  }
}

/**
 * 生成一段模拟历史，用于 Demo / 截图 / 新用户先看到图表长什么样。
 * 只在用户主动点击时执行，且明确标记 note 含 "示例数据"。
 */
export function seedDemoProgress(courseId: string, days = 14): number {
  const course = one<{ verbosity: number }>(`SELECT verbosity FROM course WHERE id = ?`, courseId)
  if (!course) return 0

  const lessons = all<{ id: string; title: string }>(
    `SELECT id, title FROM lesson WHERE course_id = ? ORDER BY order_index`,
    courseId,
  )
  let n = 0
  let seed = 7
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }

  for (let i = days; i >= 1; i--) {
    // 隔几天休息一次，看起来才像真人
    if (rnd() < 0.25) continue
    const started = new Date(Date.now() - i * 86_400_000)
    started.setHours(19 + Math.floor(rnd() * 3), Math.floor(rnd() * 50), 0, 0)
    const duration = 480 + Math.floor(rnd() * 1600)
    const lesson = lessons[Math.floor(rnd() * Math.max(1, lessons.length))]
    const before = Number((rnd() * 0.4).toFixed(2))
    const after = Math.min(0.98, Number((before + 0.15 + rnd() * 0.3).toFixed(2)))

    run(
      `INSERT INTO teaching_log
        (id, course_id, lesson_id, started_at, ended_at, duration_sec, covered_json,
         mastery_before, mastery_after, pace_action, pace_reason, next_hint, fatigue_json, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      newId('tlg'),
      courseId,
      lesson?.id ?? null,
      started.toISOString(),
      new Date(started.getTime() + duration * 1000).toISOString(),
      duration,
      JSON.stringify(['示例步骤']),
      before,
      after,
      rnd() > 0.6 ? 'faster' : rnd() > 0.3 ? 'hold' : 'slower',
      '示例数据',
      '示例建议',
      '{}',
      '示例数据（用于预览图表）',
    )
    n++
  }
  return n
}
