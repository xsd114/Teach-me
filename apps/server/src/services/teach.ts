import { all, one, run } from '../db/index.js'
import { newId, nowIso } from '../lib/id.js'
import { clampText, VERBOSITY_MAX_CHARS, type Verbosity } from '../lib/verbosity.js'
import { chat, extractJson } from './llm.js'
import {
  outlinePrompt,
  lessonPlanPrompt,
  teachStepPrompt,
  teachChapterPrompt,
  followupPrompt,
  memoryPinPrompt,
  recapPrompt,
  maxCharsFor,
  type CourseCtx,
} from './prompts.js'
import { listLessons, createLesson, getLesson, updateLesson, type Lesson } from './lesson.js'
import { getCourse, type Course } from './course.js'
import { hybridSearch } from './search.js'
import { listMaterials } from './material.js'

/* ------------------------------------------------------------------
   类型
   ------------------------------------------------------------------ */

export type PlanStep = {
  kind: 'point' | 'example' | 'practice' | 'check'
  title: string
  goal: string
  hint: string
}

export type SessionState = {
  steps: PlanStep[]
  stepIndex: number
  lastContent: string
  /** 学生在本节的表现信号 */
  signals: { action: string; at: string }[]
}

export type Session = {
  id: string
  courseId: string
  lessonId: string | null
  chapterId: string | null
  startedAt: string
  endedAt: string | null
  stepIndex: number
  turnIndex: number
  pace: 'faster' | 'hold' | 'slower'
  state: SessionState
  masteryStart: number | null
  masteryEnd: number | null
}

type SessionRow = {
  id: string
  course_id: string
  lesson_id: string | null
  chapter_id: string | null
  started_at: string
  ended_at: string | null
  step_index: number
  turn_index: number
  pace: 'faster' | 'hold' | 'slower'
  state_json: string
  history_json: string
  signals_json: string
  mastery_start: number | null
  mastery_end: number | null
}

function toSession(r: SessionRow): Session {
  let state: SessionState = { steps: [], stepIndex: 0, lastContent: '', signals: [] }
  try {
    state = JSON.parse(r.state_json) as SessionState
  } catch {
    /* ignore */
  }
  return {
    id: r.id,
    courseId: r.course_id,
    lessonId: r.lesson_id,
    chapterId: r.chapter_id ?? null,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    stepIndex: r.step_index,
    turnIndex: r.turn_index,
    pace: r.pace,
    state,
    masteryStart: r.mastery_start,
    masteryEnd: r.mastery_end,
  }
}

function courseCtx(c: Course): CourseCtx {
  return {
    title: c.title,
    kind: c.kind,
    goal: c.goal,
    baseline: c.baseline,
    verbosity: c.verbosity,
  }
}

/* ------------------------------------------------------------------
   大纲
   ------------------------------------------------------------------ */

export async function generateOutline(courseId: string): Promise<{
  lessons: Lesson[]
  added: number
  raw?: string
}> {
  const course = getCourse(courseId)
  if (!course) throw new Error('课程不存在')

  const mats = listMaterials(courseId).filter((m) => m.status === 'indexed' || m.status === 'parsed')
  const materials = mats.map((m) => ({
    name: m.name,
    chars: m.charCount,
    headings: all<{ heading_path: string }>(
      `SELECT DISTINCT heading_path FROM chunk WHERE material_id = ? AND heading_path != '' LIMIT 20`,
      m.id,
    ).map((r) => r.heading_path),
  }))

  const existing = listLessons(courseId)
  const { system, user } = outlinePrompt(
    courseCtx(course),
    materials,
    existing.map((l) => l.title),
  )

  const r = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    // 12 个课时 × 三段字段的 JSON，2000 token 常要 60–90s；默认 90s 会踩线 abort
    { json: true, temperature: 0.5, maxTokens: 2000, timeoutMs: 180_000 },
  )

  const parsed = extractJson<{ lessons: { title: string; summary: string; focus: string }[] }>(r.text)
  if (!parsed?.lessons?.length) {
    throw new Error(`大纲生成失败，模型返回不合法：${r.text.slice(0, 200)}`)
  }

  let added = 0
  const base = existing.length
  for (const [i, l] of parsed.lessons.entries()) {
    const title = (l.title ?? '').trim()
    if (!title) continue
    if (existing.some((e) => e.title === title)) continue
    createLesson(courseId, {
      title,
      summary: `${(l.summary ?? '').trim()}${l.focus ? `\n核心：${l.focus.trim()}` : ''}`,
      orderIndex: base + i,
    })
    added++
  }

  return { lessons: listLessons(courseId), added, raw: added === 0 ? r.text.slice(0, 300) : undefined }
}

/* ------------------------------------------------------------------
   课时脚本
   ------------------------------------------------------------------ */

type ChapterRow = {
  id: string
  textbook_id: string
  order_index: number
  title: string
  summary: string
  content_md: string
  goal: string
  self_check: string
  figures_json: string
}

export function getChapter(chapterId: string): ChapterRow | null {
  const r = one<ChapterRow>(
    `SELECT id, textbook_id, order_index, title, summary, content_md, goal, self_check, figures_json
       FROM textbook_chapter WHERE id = ?`,
    chapterId,
  )
  return r ?? null
}

/**
 * 为教材的一章生成教学步骤。
 *
 * 和课时不同：章节正文已经是写好的、针对这个学生的，所以**不检索资料**，
 * 直接把正文当唯一上下文——避免检索进来一堆无关片段把章节自己的逻辑冲散。
 */
export async function buildPlanForChapter(chapterId: string): Promise<PlanStep[]> {
  const ch = getChapter(chapterId)
  if (!ch) throw new Error('章节不存在')

  const book = one<{ course_id: string }>(`SELECT course_id FROM textbook WHERE id = ?`, ch.textbook_id)
  const course = book ? getCourse(book.course_id) : null
  if (!course) throw new Error('课程不存在')

  const { system, user } = lessonPlanPrompt(
    courseCtx(course),
    ch.title,
    `${ch.goal || ch.summary}\n\n这一章已经写好的正文（按它的顺序拆步骤，不要另起炉灶）：\n${ch.content_md.slice(0, 6000)}`,
    '',
  )
  const r = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { json: true, temperature: 0.35, maxTokens: 1200 },
  )
  const parsed = extractJson<{ steps: PlanStep[] }>(r.text)
  let steps = parsed?.steps ?? []
  if (steps.length === 0) {
    steps = [
      { kind: 'point', title: '先看这一章的图', goal: '建立直观印象', hint: '' },
      { kind: 'point', title: '核心那一步', goal: '知道该怎么做', hint: '' },
      { kind: 'practice', title: '你来试', goal: '动手一次', hint: '' },
      { kind: 'check', title: '自检', goal: '确认过关', hint: ch.self_check },
    ]
  }
  return steps
}
export async function getOrBuildPlan(lessonId: string, opts: { force?: boolean } = {}): Promise<PlanStep[]> {
  const row = one<{ steps_json: string }>(`SELECT steps_json FROM lesson_plan WHERE lesson_id = ?`, lessonId)
  if (row && !opts.force) {
    try {
      const steps = JSON.parse(row.steps_json) as PlanStep[]
      if (Array.isArray(steps) && steps.length > 0) return steps
    } catch {
      /* 重建 */
    }
  }

  const lesson = getLesson(lessonId)
  if (!lesson) throw new Error('课时不存在')
  const course = getCourse(lesson.courseId)
  if (!course) throw new Error('课程不存在')

  // 取与本课相关的资料片段做参考
  const sr = await hybridSearch(lesson.title + ' ' + lesson.summary, {
    courseId: course.id,
    topK: 5,
  })
  const context = sr.hits.map((h) => h.text).join('\n---\n')

  const { system, user } = lessonPlanPrompt(
    courseCtx(course),
    lesson.title,
    lesson.summary,
    context,
  )
  const r = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { json: true, temperature: 0.4, maxTokens: 1200 },
  )

  const parsed = extractJson<{ steps: PlanStep[] }>(r.text)
  let steps = parsed?.steps ?? []
  if (steps.length === 0) {
    // 兜底：不让流程卡死
    steps = [
      { kind: 'point', title: '先看一个最小例子', goal: '建立直观印象', hint: '不要一上来讲全面' },
      { kind: 'point', title: '关键动作', goal: '知道该怎么做', hint: '' },
      { kind: 'practice', title: '你来试一次', goal: '动手一次', hint: '' },
      { kind: 'check', title: '检验理解', goal: '能说清为什么', hint: '' },
    ]
  }

  run(
    `INSERT INTO lesson_plan(lesson_id, steps_json, updated_at) VALUES (?,?,?)
     ON CONFLICT(lesson_id) DO UPDATE SET steps_json = excluded.steps_json, updated_at = excluded.updated_at`,
    lessonId,
    JSON.stringify(steps),
    nowIso(),
  )
  return steps
}

/* ------------------------------------------------------------------
   优先阅读条目（开课速览卡）
   ------------------------------------------------------------------ */

export function getPin(courseId: string): string {
  const r = one<{ content: string; auto_updated_at: string | null }>(
    `SELECT content, auto_updated_at FROM course_memory_pin WHERE course_id = ?`,
    courseId,
  )
  return r?.content ?? ''
}

export async function refreshPin(courseId: string): Promise<string> {
  const course = getCourse(courseId)
  if (!course) return ''

  const lessons = listLessons(courseId).map((l) => ({ title: l.title, state: l.state, mastery: l.mastery }))
  const logs = all<{ started_at: string; pace_action: string | null; pace_reason: string | null; next_hint: string | null }>(
    `SELECT started_at, pace_action, pace_reason, next_hint FROM teaching_log
     WHERE course_id = ? ORDER BY started_at DESC LIMIT 5`,
    courseId,
  ).map((r) => ({
    at: r.started_at,
    pace: r.pace_action ?? 'hold',
    reason: r.pace_reason ?? '',
    hint: r.next_hint ?? '',
  }))

  const prev = getPin(courseId)

  // 没配模型时用规则生成，保证功能不瘫
  if (!logs.length && !lessons.length) {
    return prev
  }

  try {
    const { system, user } = memoryPinPrompt(courseCtx(course), lessons, logs, prev)
    const r = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { json: true, temperature: 0.4, maxTokens: 300 },
    )
    const parsed = extractJson<{ pin: string }>(r.text)
    const pin = clampText(parsed?.pin ?? '', 200)
    if (pin) {
      run(
        `INSERT INTO course_memory_pin(course_id, content, auto_updated_at) VALUES (?,?,?)
         ON CONFLICT(course_id) DO UPDATE SET content = excluded.content, auto_updated_at = excluded.auto_updated_at`,
        courseId,
        pin,
        nowIso(),
      )
      return pin
    }
    return prev
  } catch {
    return prev
  }
}

/* ------------------------------------------------------------------
   会话
   ------------------------------------------------------------------ */

export async function startSession(
  courseId: string,
  lessonId?: string | null,
  chapterId?: string | null,
): Promise<{
  session: Session
  opening: string
  pin: string
  lesson: Lesson | null
  chapter: { id: string; title: string; goal: string; selfCheck: string; figures: unknown[] } | null
}> {
  const course = getCourse(courseId)
  if (!course) throw new Error('课程不存在')

  // ── 逐章讲：以教材那一章为纲 ──
  if (chapterId) {
    const ch = getChapter(chapterId)
    if (!ch) throw new Error('章节不存在')

    const steps = await buildPlanForChapter(chapterId)
    const pin = getPin(courseId)
    const id = newId('tss')
    const ts = nowIso()
    const state: SessionState = { steps, stepIndex: 0, lastContent: '', signals: [] }

    run(
      `INSERT INTO teach_session
        (id, course_id, lesson_id, chapter_id, started_at, step_index, turn_index, pace, state_json, history_json, signals_json, mastery_start)
       VALUES (?,?,NULL,?,?,0,0,'hold',?,'[]','[]',NULL)`,
      id,
      courseId,
      chapterId,
      ts,
      JSON.stringify(state),
    )

    let figures: unknown[] = []
    try {
      figures = JSON.parse(ch.figures_json || '[]')
    } catch {
      figures = []
    }

    const first = await renderChapterStep(course, ch, steps[0], [])
    state.lastContent = first
    run(`UPDATE teach_session SET state_json = ? WHERE id = ?`, JSON.stringify(state), id)

    const opening = pin ? `${pin}\n\n第 ${ch.order_index + 1} 章「${ch.title}」。` : `第 ${ch.order_index + 1} 章「${ch.title}」。`

    return {
      session: getSession(id)!,
      opening,
      pin,
      lesson: null,
      chapter: {
        id: ch.id,
        title: ch.title,
        goal: ch.goal,
        selfCheck: ch.self_check,
        figures,
      },
    }
  }

  const lessons = listLessons(courseId)
  // 选课：指定的 > 第一个没掌握的 > 第一个
  const lesson =
    (lessonId ? lessons.find((l) => l.id === lessonId) : undefined) ??
    lessons.find((l) => l.state !== 'done') ??
    lessons[0] ??
    null

  if (!lesson) {
    throw new Error('这门课还没有课时。先在教材页开始第一章，或者导入资料后生成大纲。')
  }

  const pin = getPin(courseId)
  const steps = await getOrBuildPlan(lesson.id)

  const id = newId('tss')
  const ts = nowIso()
  const state: SessionState = { steps, stepIndex: 0, lastContent: '', signals: [] }

  run(
    `INSERT INTO teach_session
      (id, course_id, lesson_id, started_at, step_index, turn_index, pace, state_json, history_json, signals_json, mastery_start)
     VALUES (?,?,?,?,0,0,'hold',?,'[]','[]',?)`,
    id,
    courseId,
    lesson.id,
    ts,
    JSON.stringify(state),
    lesson.mastery,
  )

  const first = await renderStep(course, lesson, steps[0], state, [])
  state.lastContent = first
  run(`UPDATE teach_session SET state_json = ? WHERE id = ?`, JSON.stringify(state), id)

  const opening = pin
    ? `${pin}\n\n我们从「${lesson.title}」开始。`
    : `我们从「${lesson.title}」开始。`

  return { session: getSession(id)!, opening, pin, lesson, chapter: null }
}

/**
 * 按章节讲一步：以章节正文为准，允许模型引用正文里的措辞。
 * 不检索资料——章节本身就是最好的上下文。
 */
async function renderChapterStep(
  course: Course,
  ch: ChapterRow,
  step: PlanStep | undefined,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const maxChars = maxCharsFor(course.verbosity)
  if (!step) {
    return '这一章讲完了。要对着自检清单过一遍，还是先出两道题？'
  }

  const { system, user } = teachChapterPrompt(
    courseCtx(course),
    ch.order_index + 1,
    ch.title,
    ch.content_md,
    step,
    maxChars,
  )

  const r = await chat(
    [
      { role: 'system', content: system },
      ...history.slice(-6),
      { role: 'user', content: user },
    ],
    { temperature: 0.6, maxTokens: 8000, timeoutMs: 300000 },
  )
  return clampText(r.text, maxChars)
}

export function getSession(id: string): Session | null {
  const r = one<SessionRow>(`SELECT * FROM teach_session WHERE id = ?`, id)
  return r ? toSession(r) : null
}

async function renderStep(
  course: Course,
  lesson: Lesson,
  step: PlanStep | undefined,
  state: SessionState,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const maxChars = maxCharsFor(course.verbosity)

  if (!step) {
    return '这一节的步骤都走完了。要不要我出两道题检验一下？'
  }

  const sr = await hybridSearch(`${lesson.title} ${step.title}`, { courseId: course.id, topK: 4 })
  const context = sr.hits.map((h) => `〔${h.headingPath || h.materialName}〕${h.text}`).join('\n---\n')

  const { system, user } = teachStepPrompt(
    courseCtx(course),
    lesson.title,
    step.title,
    step.goal,
    context,
    history,
    maxChars,
  )

  const r = await chat(
    [
      { role: 'system', content: system },
      ...history.slice(-6),
      { role: 'user', content: user },
    ],
    { temperature: 0.65, maxTokens: 8000, timeoutMs: 300000 },
  )

  void state
  return clampText(r.text, maxChars)
}

export type TeachIntent = 'next' | 'explain' | 'example' | 'simpler' | 'confused' | 'more'

/** 推进一次交互 */
export async function advance(
  sessionId: string,
  intent: TeachIntent,
  question = '',
): Promise<{ session: Session; content: string; done: boolean }> {
  const s = getSession(sessionId)
  if (!s) throw new Error('会话不存在')
  const course = getCourse(s.courseId)
  if (!course) throw new Error('课程不存在')

  const chapter = s.chapterId ? getChapter(s.chapterId) : null
  const lesson = s.lessonId ? getLesson(s.lessonId) : null
  if (!lesson && !chapter) throw new Error('这个会话既没有课时也没有章节')

  const historyRow = one<{ history_json: string }>(`SELECT history_json FROM teach_session WHERE id = ?`, sessionId)
  let history: { role: 'user' | 'assistant'; content: string }[] = []
  try {
    history = JSON.parse(historyRow?.history_json ?? '[]')
  } catch {
    history = []
  }

  const state = s.state
  state.signals.push({ action: intent, at: nowIso() })

  // 'next' 才推进步骤，其余都是围绕当前步的追问
  if (intent === 'next' || intent === 'more') {
    state.stepIndex = Math.min(state.stepIndex + 1, state.steps.length)
  }

  const step = state.steps[state.stepIndex]
  const maxChars = maxCharsFor(course.verbosity)
  const topic = chapter ? chapter.title : lesson!.title

  let content: string
  if (intent === 'next' && !step) {
    content = '这一节的内容都走完了。要不要我出两道题，或者结束这次课？'
  } else if (intent === 'next' || intent === 'more') {
    content = chapter
      ? await renderChapterStep(course, chapter, step, history)
      : await renderStep(course, lesson!, step, state, history)
  } else {
    const sr = await hybridSearch(`${topic} ${question || step?.title || ''}`, {
      courseId: course.id,
      topK: 4,
    })
    const context = sr.hits.map((h) => `〔${h.headingPath || h.materialName}〕${h.text}`).join('\n---\n')
    const { system, user } = followupPrompt(
      courseCtx(course),
      intent === 'explain' ? 'explain' : intent === 'example' ? 'example' : intent === 'simpler' ? 'simpler' : intent === 'confused' ? 'confused' : 'more',
      question,
      chapter ? `本章正文：\n${chapter.content_md.slice(0, 3000)}\n\n${context}` : context,
      maxChars,
    )
    const r = await chat(
      [
        { role: 'system', content: system },
        ...history.slice(-6),
        { role: 'user', content: user },
      ],
      { temperature: 0.7, maxTokens: 8000, timeoutMs: 300000 },
    )
    content = clampText(r.text, maxChars)
  }

  state.lastContent = content
  history.push({ role: 'assistant', content })

  const pace = decidePace(state.signals)

  run(
    `UPDATE teach_session SET state_json = ?, history_json = ?, signals_json = ?, step_index = ?, turn_index = turn_index + 1, pace = ? WHERE id = ?`,
    JSON.stringify(state),
    JSON.stringify(history.slice(-40)),
    JSON.stringify(state.signals),
    state.stepIndex,
    pace,
    sessionId,
  )

  return { session: getSession(sessionId)!, content, done: !step }
}

/** 规则调速：不烧 token，也足够解释得清 */
export function decidePace(signals: { action: string }[]): 'faster' | 'hold' | 'slower' {
  const recent = signals.slice(-6)
  if (recent.length === 0) return 'hold'
  const slow = recent.filter((s) => s.action === 'confused' || s.action === 'simpler').length
  const fast = recent.filter((s) => s.action === 'next' || s.action === 'more').length
  if (slow >= 2) return 'slower'
  if (fast >= 4 && slow === 0) return 'faster'
  return 'hold'
}

/** 结束并落库 */
export async function endSession(
  sessionId: string,
  feedback?: { rating?: number; note?: string },
): Promise<{
  log: { id: string; pace: string; reason: string; summary: string; nextHint: string }
  session: Session
}> {
  const s = getSession(sessionId)
  if (!s) throw new Error('会话不存在')
  const course = getCourse(s.courseId)
  const lesson = s.lessonId ? getLesson(s.lessonId) : null
  if (!course) throw new Error('课程不存在')

  const signals = s.state.signals
  const counts = new Map<string, number>()
  for (const sg of signals) counts.set(sg.action, (counts.get(sg.action) ?? 0) + 1)
  const signalList = [...counts.entries()].map(([action, count]) => ({ action, count }))

  const covered = s.state.steps.slice(0, s.state.stepIndex + 1).map((p) => p.title)

  let summary = ''
  let nextHint = ''
  let mastery = lesson?.mastery ?? 0

  try {
    const { system, user } = recapPrompt(courseCtx(course), covered, signalList)
    const r = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { json: true, temperature: 0.4, maxTokens: 300 },
    )
    const parsed = extractJson<{ summary: string; nextHint: string; mastery: number }>(r.text)
    summary = clampText(parsed?.summary ?? '', 80)
    nextHint = clampText(parsed?.nextHint ?? '', 40)
    if (typeof parsed?.mastery === 'number') mastery = Math.max(0, Math.min(1, parsed.mastery))
  } catch {
    summary = covered.length ? `覆盖了 ${covered.length} 个步骤` : '本次课未记录内容'
    nextHint = '接着上一节继续'
  }

  const pace = decidePace(signals)
  const reason =
    pace === 'slower'
      ? '最近几次都表示没听懂或要求简化'
      : pace === 'faster'
        ? '连续多次直接推进，没有卡点'
        : '节奏正常'

  const logId = newId('tlg')
  const ts = nowIso()
  const duration = Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000)

  run(
    `INSERT INTO teaching_log
      (id, course_id, lesson_id, started_at, ended_at, duration_sec, covered_json,
       mastery_before, mastery_after, pace_action, pace_reason, next_hint, fatigue_json, note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    logId,
    s.courseId,
    s.lessonId,
    s.startedAt,
    ts,
    duration,
    JSON.stringify(covered),
    s.masteryStart,
    mastery,
    pace,
    reason,
    nextHint,
    JSON.stringify({ signals: signalList }),
    feedback?.note ?? '',
  )

  run(`UPDATE teach_session SET ended_at = ?, mastery_end = ?, pace = ? WHERE id = ?`, ts, mastery, pace, sessionId)

  // 更新课时状态
  if (lesson) {
    const nextState = mastery >= 0.8 ? 'done' : mastery >= 0.4 ? 'review' : 'doing'
    updateLesson(lesson.id, { mastery, state: nextState })
  }

  // 刷新"优先阅读条目"，下次开课直接用
  void refreshPin(s.courseId)

  return {
    log: { id: logId, pace, reason, summary, nextHint },
    session: getSession(sessionId)!,
  }
}

/** 课程最近的教学记录 */
export function recentLogs(courseId: string, limit = 20) {
  return all<{
    id: string
    started_at: string
    ended_at: string | null
    duration_sec: number
    covered_json: string
    mastery_before: number | null
    mastery_after: number | null
    pace_action: string | null
    pace_reason: string | null
    next_hint: string | null
    lesson_id: string | null
  }>(
    `SELECT * FROM teaching_log WHERE course_id = ? ORDER BY started_at DESC LIMIT ?`,
    courseId,
    limit,
  ).map((r) => {
    let covered: string[] = []
    try {
      covered = JSON.parse(r.covered_json)
    } catch {
      covered = []
    }
    return {
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      durationSec: r.duration_sec,
      covered,
      masteryBefore: r.mastery_before,
      masteryAfter: r.mastery_after,
      pace: r.pace_action,
      reason: r.pace_reason,
      nextHint: r.next_hint,
      lessonId: r.lesson_id,
    }
  })
}

/** 给前端展示的字数预算 */
export function charBudget(verbosity: number): number {
  const v = Math.round(verbosity) as Verbosity
  return VERBOSITY_MAX_CHARS[v >= 1 && v <= 5 ? v : 3]
}
