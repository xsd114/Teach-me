import { all, one, run } from '../db/index.js'
import { newId, nowIso } from '../lib/id.js'
import { renderPrompt } from '../prompts/index.js'
import { chat, extractJson } from './llm.js'
import { getCourse } from './course.js'
import { getLesson } from './lesson.js'
import { hybridSearch } from './search.js'

export type QuestionType = 'mcq' | 'blank' | 'short' | 'calc'

export type Question = {
  id: string
  courseId: string
  lessonId: string | null
  type: QuestionType
  stem: string
  options: string[]
  answer: string
  explain: string
  source: string
  dueAt: string | null
  createdAt: string
  /** 附带：最近一次答对没 */
  lastCorrect: boolean | null
  attempts: number
}

type Row = {
  id: string
  course_id: string
  lesson_id: string | null
  type: QuestionType
  stem: string
  options_json: string
  answer: string
  explain: string
  source: string
  fsrs_json: string
  due_at: string | null
  created_at: string
}

type FsrsState = { ease: number; interval: number; reps: number; lapses: number }

function parseFsrs(s: string): FsrsState {
  try {
    const o = JSON.parse(s) as Partial<FsrsState>
    return {
      ease: typeof o.ease === 'number' ? o.ease : 2.5,
      interval: typeof o.interval === 'number' ? o.interval : 0,
      reps: typeof o.reps === 'number' ? o.reps : 0,
      lapses: typeof o.lapses === 'number' ? o.lapses : 0,
    }
  } catch {
    return { ease: 2.5, interval: 0, reps: 0, lapses: 0 }
  }
}

function toQuestion(r: Row): Question {
  const last = one<{ correct: number }>(
    `SELECT correct FROM attempt WHERE question_id = ? ORDER BY answered_at DESC LIMIT 1`,
    r.id,
  )
  const cnt = one<{ n: number }>(`SELECT COUNT(*) AS n FROM attempt WHERE question_id = ?`, r.id)
  let options: string[] = []
  try {
    options = JSON.parse(r.options_json)
  } catch {
    options = []
  }
  return {
    id: r.id,
    courseId: r.course_id,
    lessonId: r.lesson_id,
    type: r.type,
    stem: r.stem,
    options,
    answer: r.answer,
    explain: r.explain,
    source: r.source,
    dueAt: r.due_at,
    createdAt: r.created_at,
    lastCorrect: last ? Boolean(last.correct) : null,
    attempts: Number(cnt?.n ?? 0),
  }
}

export function listQuestions(courseId: string, opts: { dueOnly?: boolean; limit?: number } = {}): Question[] {
  const rows = opts.dueOnly
    ? all<Row>(
        `SELECT * FROM question WHERE course_id = ? AND due_at IS NOT NULL AND due_at <= ?
         ORDER BY due_at LIMIT ?`,
        courseId,
        nowIso(),
        opts.limit ?? 50,
      )
    : all<Row>(`SELECT * FROM question WHERE course_id = ? ORDER BY created_at DESC LIMIT ?`, courseId, opts.limit ?? 50)
  return rows.map(toQuestion)
}

/* ------------------------------------------------------------------
   生成
   ------------------------------------------------------------------ */

const GEN_SYSTEM = `你是出题老师。只输出 JSON，不要解释文字。
题目要能检验"真的懂了没有"，不是考记忆力。
选项不要出现"以上都对"这种凑数项。答案必须唯一且可判定。`

export async function generateQuestions(input: {
  courseId: string
  lessonId?: string | null
  count?: number
  types?: QuestionType[]
}): Promise<{ created: Question[]; raw?: string }> {
  const course = getCourse(input.courseId)
  if (!course) throw new Error('课程不存在')

  const lesson = input.lessonId ? getLesson(input.lessonId) : null
  const topic = lesson ? `${lesson.title}：${lesson.summary}` : course.title
  const count = Math.max(1, Math.min(20, input.count ?? 5))
  const types = input.types?.length ? input.types : (['mcq', 'blank', 'short'] as QuestionType[])

  // 用记忆库给点上下文，题目才能贴着教材出
  const sr = await hybridSearch(topic, { courseId: input.courseId, topK: 4 })
  const ctx = sr.hits.map((h) => h.text).join('\n---\n').slice(0, 4000)

  const pGen = renderPrompt('quiz.generate', {
    count,
    courseTitle: course.title,
    topic: lesson ? `${lesson.title}：${lesson.summary}` : course.goal || course.title,
    baseline: course.baseline || '（未填）',
  })
  // 题型与资料是运行时信息，补在模板后面
  const user = `${pGen.user}

参考内容（贴着我给的资料出题，别出资料里没有的）：
${ctx || '（无资料，按你的专业知识出）'}

题型从这些里选：${types.join(' / ')}
- mcq：单选，4 个选项，answer 填选项字母 A/B/C/D
- blank：填空，题干里用 ____ 表示空位，answer 填要填的内容
- short：简答，answer 是关键得分点（用分号分隔，2–3 点）
- calc：计算，answer 写最终结果，explain 写关键步骤`
  const r = await chat(
    [
      { role: 'system', content: pGen.system ?? GEN_SYSTEM },
      { role: 'user', content: user },
    ],
    { json: true, temperature: 0.6, maxTokens: 2500 },
  )

  const parsed = extractJson<{
    questions: {
      type: string
      stem: string
      options?: string[]
      answer: string
      explain?: string
    }[]
  }>(r.text)

  if (!parsed?.questions?.length) {
    throw new Error(`出题失败，模型返回不合法：${r.text.slice(0, 200)}`)
  }

  const ts = nowIso()
  const created: Question[] = []
  for (const q of parsed.questions) {
    const type: QuestionType = (['mcq', 'blank', 'short', 'calc'] as QuestionType[]).includes(
      q.type as QuestionType,
    )
      ? (q.type as QuestionType)
      : 'short'
    if (!q.stem?.trim() || !q.answer?.trim()) continue
    const id = newId('qst')
    run(
      `INSERT INTO question
        (id, course_id, lesson_id, type, stem, options_json, answer, explain, source, source_ref, fsrs_json, due_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?, NULL, ?, NULL, ?)`,
      id,
      input.courseId,
      input.lessonId ?? null,
      type,
      q.stem.trim(),
      JSON.stringify(q.options ?? []),
      String(q.answer).trim(),
      (q.explain ?? '').trim(),
      'generated',
      JSON.stringify({ ease: 2.5, interval: 0, reps: 0, lapses: 0 }),
      ts,
    )
    const row = one<Row>(`SELECT * FROM question WHERE id = ?`, id)
    if (row) created.push(toQuestion(row))
  }

  return { created, raw: created.length === 0 ? r.text.slice(0, 300) : undefined }
}

/* ------------------------------------------------------------------
   判分 + 排程（简化 SM-2 / FSRS 混合）
   ------------------------------------------------------------------ */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s，。、；：""''（）()【】\[\]·,.!?！？:;]/g, '')
}

export function judge(type: QuestionType, answer: string, userAnswer: string): boolean {
  const a = normalize(answer)
  const u = normalize(userAnswer)
  if (!u) return false
  if (type === 'mcq') return u.startsWith(a) || a.startsWith(u)
  if (type === 'blank' || type === 'calc') {
    if (a === u) return true
    // 计算题允许包含关系（只要核心结果对就行）
    return a.length >= 2 && (u.includes(a) || a.includes(u))
  }
  // 简答：命中关键点一半以上就算过
  const points = answer
    .split(/[;；]/)
    .map((p) => normalize(p))
    .filter((p) => p.length >= 2)
  if (points.length === 0) return u.includes(a) || a.includes(u)
  const hit = points.filter((p) => u.includes(p)).length
  return hit >= Math.ceil(points.length * 0.5)
}

export function submitAnswer(
  questionId: string,
  userAnswer: string,
  elapsedMs = 0,
): { correct: boolean; nextDueAt: string; state: FsrsState; question: Question } {
  const row = one<Row>(`SELECT * FROM question WHERE id = ?`, questionId)
  if (!row) throw new Error('题目不存在')

  const correct = judge(row.type, row.answer, userAnswer)
  const st = parseFsrs(row.fsrs_json)

  if (correct) {
    st.reps += 1
    st.interval = st.interval === 0 ? 1 : Math.round(st.interval * st.ease)
    st.ease = Math.min(3.0, st.ease + 0.05)
  } else {
    st.lapses += 1
    st.reps = 0
    st.interval = 0
    st.ease = Math.max(1.3, st.ease - 0.2)
  }

  // 答错的今天就复习（10 分钟后再来），答对的按间隔推
  const dueMs = correct
    ? Date.now() + st.interval * 86_400_000
    : Date.now() + 10 * 60_000
  const dueAt = new Date(dueMs).toISOString()

  run(
    `UPDATE question SET fsrs_json = ?, due_at = ? WHERE id = ?`,
    JSON.stringify(st),
    dueAt,
    questionId,
  )
  run(
    `INSERT INTO attempt(id, question_id, answered_at, user_answer, correct, elapsed_ms)
     VALUES (?,?,?,?,?,?)`,
    newId('att'),
    questionId,
    nowIso(),
    userAnswer,
    correct ? 1 : 0,
    elapsedMs,
  )

  const fresh = one<Row>(`SELECT * FROM question WHERE id = ?`, questionId)!
  return { correct, nextDueAt: dueAt, state: st, question: toQuestion(fresh) }
}

export function questionStats(courseId: string): {
  total: number
  due: number
  wrong: number
  accuracy: number
} {
  const t = one<{ n: number }>(`SELECT COUNT(*) AS n FROM question WHERE course_id = ?`, courseId)
  const d = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM question WHERE course_id = ? AND due_at IS NOT NULL AND due_at <= ?`,
    courseId,
    nowIso(),
  )
  const w = one<{ n: number }>(
    `SELECT COUNT(DISTINCT q.id) AS n FROM question q
      JOIN attempt a ON a.question_id = q.id
     WHERE q.course_id = ? AND a.correct = 0`,
    courseId,
  )
  const acc = one<{ c: number; n: number }>(
    `SELECT COALESCE(SUM(a.correct),0) AS c, COUNT(*) AS n FROM attempt a
      JOIN question q ON q.id = a.question_id WHERE q.course_id = ?`,
    courseId,
  )
  return {
    total: Number(t?.n ?? 0),
    due: Number(d?.n ?? 0),
    wrong: Number(w?.n ?? 0),
    accuracy: Number(acc?.n ?? 0) > 0 ? Number(acc?.c ?? 0) / Number(acc?.n ?? 1) : 0,
  }
}

export function deleteQuestion(id: string): boolean {
  return run(`DELETE FROM question WHERE id = ?`, id).changes > 0
}
