import fs from 'node:fs'
import { all, one, run } from '../db/index.js'
import { newId, nowIso } from '../lib/id.js'
import { renderPrompt } from '../prompts/index.js'
import { chat, extractJson } from './llm.js'
import { getCourse } from './course.js'
import { listMaterials } from './material.js'
import { hybridSearch } from './search.js'

/* ------------------------------------------------------------------
   学生画像
   ------------------------------------------------------------------ */

export type Profile = {
  /** 0 完全没接触 → 4 基本会了想加细节 */
  familiarity: number
  /** principle | example | hands-on */
  style: 'principle' | 'example' | 'hands-on'
  /** handholding | guided | independent */
  support: 'handholding' | 'guided' | 'independent'
  /** 学生自己说的"最想先解决什么" */
  focus: string
  /** 访谈里冒出来的具体约束与偏好，原话保留 */
  notes: string[]
  /** 一句话画像，生成教材时会直接写进前言 */
  summary: string
}

export const FAMILIARITY_LABEL = [
  '完全没接触过',
  '听过、看过，但没自己动过手',
  '能跟着做，但离开教程就卡住',
  '基本会了，想抠细节和稳定性',
  '已经很熟，想系统化并补盲区',
]

export const STYLE_LABEL: Record<Profile['style'], string> = {
  principle: '先把原理讲清楚，再动手',
  example: '先看具体例子，从例子里总结规律',
  'hands-on': '直接上手做，边做边讲',
}

export const SUPPORT_LABEL: Record<Profile['support'], string> = {
  handholding: '手把手，一步一步喂到嘴边',
  guided: '给方向，我自己试，卡住再拉一把',
  independent: '别管我，需要时再出现',
}

export function getProfile(courseId: string): Profile | null {
  const row = one<{ profile_json: string; onboarded_at: string | null }>(
    `SELECT profile_json, onboarded_at FROM course WHERE id = ?`,
    courseId,
  )
  if (!row?.profile_json || row.profile_json === '{}') return null
  try {
    const p = JSON.parse(row.profile_json) as Profile
    if (!p || typeof p.familiarity !== 'number') return null
    return p
  } catch {
    return null
  }
}

export function saveProfile(courseId: string, profile: Profile): void {
  run(
    `UPDATE course SET profile_json = ?, familiarity = ?, learning_style = ?, support_level = ?, onboarded_at = ?, updated_at = ? WHERE id = ?`,
    JSON.stringify(profile),
    profile.familiarity,
    profile.style,
    profile.support,
    nowIso(),
    nowIso(),
    courseId,
  )
}

/* ------------------------------------------------------------------
   入学访谈：5 个问题
   ------------------------------------------------------------------ */

export type Question = {
  id: string
  /** 问题正文 */
  text: string
  /** 为什么问这个 */
  hint: string
  type: 'choice' | 'text'
  options?: { value: string; label: string }[]
}

export type InterviewState = {
  id: string
  courseId: string
  questions: Question[]
  answers: string[]
  cursor: number
  done: boolean
  profile?: Profile
  /** 当前这一问（给前端直接渲染） */
  question: Question
  /** 第几问（1-based） */
  step: number
  /** 总共几问（4 个固定 + 1 个动态） */
  total: number
}

/** 每次 cursor 变动后重算派生字段 */
function syncView(st: InterviewState): InterviewState {
  st.step = Math.min(st.cursor + 1, 5)
  st.total = 5
  st.question = st.questions[st.cursor] ?? st.questions[st.questions.length - 1]
  return st
}

const FIXED_QUESTIONS: Question[] = [
  {
    id: 'familiarity',
    text: '你对这门课熟悉到什么程度？',
    hint: '这个决定我从哪一步开始，别客气',
    type: 'choice',
    options: [
      { value: '0', label: '完全没接触过' },
      { value: '1', label: '听过、看过，没动过手' },
      { value: '2', label: '能跟着做，离开教程就卡' },
      { value: '3', label: '基本会了，想抠细节' },
      { value: '4', label: '很熟了，想系统补盲区' },
    ],
  },
  {
    id: 'style',
    text: '你更喜欢我怎么讲？',
    hint: '有人要先懂原理才安心，有人要直接上手',
    type: 'choice',
    options: [
      { value: 'principle', label: '先把原理讲清楚' },
      { value: 'example', label: '先看例子，再从例子里找规律' },
      { value: 'hands-on', label: '直接上手做，边做边讲' },
    ],
  },
  {
    id: 'support',
    text: '需要我扶多紧？',
    hint: '决定我每步给多少提示',
    type: 'choice',
    options: [
      { value: 'handholding', label: '手把手，一步都别让我猜' },
      { value: 'guided', label: '给方向，我自己试，卡住再拉' },
      { value: 'independent', label: '别管我，需要时再出现' },
    ],
  },
  {
    id: 'focus',
    text: '这门课里，你最想先解决什么？',
    hint: '说具体的：一个场景、一个总也做不好的动作、一个绕不过去的坎',
    type: 'text',
  },
]

const sessions = new Map<string, InterviewState>()

export function startInterview(courseId: string): InterviewState {
  const id = newId('itv')
  run(`INSERT INTO interview(id, course_id, started_at) VALUES (?,?,?)`, id, courseId, nowIso())

  const st = {
    id,
    courseId,
    questions: [...FIXED_QUESTIONS],
    answers: [] as string[],
    cursor: 0,
    done: false,
  } as InterviewState
  syncView(st)
  sessions.set(id, st)
  return st
}

export function getInterview(id: string): InterviewState | null {
  return sessions.get(id) ?? null
}

/**
 * 第 5 题是动态的：根据前 4 个答案 + 这门课的知识，问一个只有这学生才会被问到的问题。
 * 例：粤菜零基础 + 家里只有一口炒锅 → "你家里灶具火力多大，有没有蒸锅？"
 */
async function buildTailQuestion(
  courseTitle: string,
  kind: string,
  answers: string[],
): Promise<Question> {
  const summary = `课程：${courseTitle}（${kind === 'academic' ? '学业类' : '技能类'}）
熟悉程度：${FAMILIARITY_LABEL[Number(answers[0]) || 0]}
偏好方式：${answers[1] ?? '未答'}
协助程度：${answers[2] ?? '未答'}
最想解决：${answers[3] ?? '未答'}`

  try {
    const r = await chat(
      [
        {
          role: 'system',
          content: `你在做入学访谈的最后一问。你的目标：问出一个**只有这个学生会被问到**的问题，
答案会直接改变教材怎么写（设备条件、身体限制、时间碎片、已有资源、真实场景）。
不要问"你还有什么想说的"这种废话。只输出 JSON。`,
        },
        {
          role: 'user',
          content: `${summary}

问一个问题，挖出上面这些信息里还没覆盖到、但会实打实影响教学的那一个条件。
例：学做菜问灶具和锅；学乐器问有没有琴、家里隔音；学编程问电脑配置和系统；学英语问每天能开口的时间。

只输出：{"text":"问题（≤30字）","hint":"为什么问这个（≤24字）"}`,
        },
      ],
      { json: true, temperature: 0.8, maxTokens: 300 },
    )
    const p = extractJson<{ text: string; hint: string }>(r.text)
    if (p?.text) {
      return {
        id: 'tail',
        text: p.text,
        hint: p.hint || '这个直接影响我给你的方案',
        type: 'text',
      }
    }
  } catch {
    /* 落到兜底问题 */
  }

  return {
    id: 'tail',
    text: '有没有什么条件是我必须知道的？（设备、时间、身体、场地）',
    hint: '有就写，没有就写"没有"',
    type: 'text',
  }
}

async function buildProfile(courseTitle: string, answers: string[]): Promise<Profile> {
  const familiarity = Math.max(0, Math.min(4, Number(answers[0]) || 0))
  const style = (['principle', 'example', 'hands-on'].includes(answers[1])
    ? answers[1]
    : 'example') as Profile['style']
  const support = (['handholding', 'guided', 'independent'].includes(answers[2])
    ? answers[2]
    : 'guided') as Profile['support']
  const focus = (answers[3] ?? '').trim()
  const tail = (answers[4] ?? '').trim()

  const notes: string[] = []
  if (focus) notes.push(focus)
  if (tail && !/^(没有|无|暂无)$/.test(tail)) notes.push(tail)

  let summary = `这个学生${FAMILIARITY_LABEL[familiarity]}，偏好${STYLE_LABEL[style]}，需要${SUPPORT_LABEL[support]}。`
  if (focus) summary += `他最想解决的是：${focus}。`

  try {
    const r = await chat(
      [
        {
          role: 'system',
          content: `你把访谈答案压成一段 60–100 字的画像，给教材作者看。
要具体：点名他的水平、他的约束、他要躲的坑。不要"该生学习态度良好"这种。只输出 JSON。`,
        },
        {
          role: 'user',
          content: `课程：${courseTitle}
熟悉程度：${FAMILIARITY_LABEL[familiarity]}
偏好方式：${STYLE_LABEL[style]}
协助程度：${SUPPORT_LABEL[support]}
最想解决：${focus || '（没说）'}
补充条件：${tail || '（没说）'}

只输出：{"summary":"..."}`,
        },
      ],
      { json: true, temperature: 0.6, maxTokens: 400 },
    )
    const p = extractJson<{ summary: string }>(r.text)
    if (p?.summary) summary = p.summary.trim()
  } catch {
    /* 用拼出来的兜底 */
  }

  return { familiarity, style, support, focus, notes, summary }
}

export async function answerInterview(
  id: string,
  _questionId: string,
  answer: string,
): Promise<{ state: InterviewState; finished: boolean; done: boolean; next: Question | null; profile?: Profile }> {
  const st = sessions.get(id)
  if (!st) throw new Error('访谈不存在或已过期，重新开始一次')
  if (st.done) {
    return { state: st, finished: true, done: true, next: null, profile: st.profile }
  }

  const course = getCourse(st.courseId)
  st.answers[st.cursor] = answer.trim()

  if (st.cursor === 3 && st.questions.length === 4) {
    const tail = await buildTailQuestion(course?.title ?? '这门课', course?.kind ?? 'skill', st.answers)
    st.questions.push(tail)
    st.cursor = 4
    syncView(st)
    run(`UPDATE interview SET answers_json = ? WHERE id = ?`, JSON.stringify(st.answers), id)
    return { state: st, finished: false, done: false, next: st.question }
  }

  if (st.cursor === 4) {
    const profile = await buildProfile(course?.title ?? '这门课', st.answers)
    saveProfile(st.courseId, profile)
    st.done = true
    st.profile = profile
    run(
      `UPDATE interview SET finished_at = ?, profile_json = ? WHERE id = ?`,
      nowIso(),
      JSON.stringify(profile),
      id,
    )
    syncView(st)
    run(`UPDATE interview SET answers_json = ? WHERE id = ?`, JSON.stringify(st.answers), id)
    return { state: st, finished: true, done: true, next: null, profile }
  }

  st.cursor += 1
  syncView(st)
  run(`UPDATE interview SET answers_json = ? WHERE id = ?`, JSON.stringify(st.answers), id)
  return { state: st, finished: false, done: false, next: st.question }
}

/* ------------------------------------------------------------------
   教材
   ------------------------------------------------------------------ */

export type TextbookChapter = {
  id: string
  orderIndex: number
  title: string
  summary: string
  contentMd: string
  goal: string
  selfCheck: string
  wordCount: number
  figures: unknown[]
  /** pending 还没写 / done 写完了 / failed 这次没写成（可直接重写） */
  status: string
}

export type Textbook = {
  id: string
  courseId: string
  title: string
  subtitle: string
  preface: string
  status: string
  stage: string
  progress: number
  error: string | null
  profile: Profile | null
  sources: string[]
  sourcesBlock: string
  chapters: TextbookChapter[]
  createdAt: string
}

type TextbookRow = {
  id: string
  course_id: string
  title: string
  subtitle: string
  preface: string
  status: string
  stage: string
  progress: number
  error: string | null
  profile_json: string
  sources_json: string
  sources_block: string
  created_at: string
}

function chaptersOf(textbookId: string): TextbookChapter[] {
  return all<{
    id: string
    order_index: number
    title: string
    summary: string
    content_md: string
    goal: string
    self_check: string
    word_count: number
    figures_json: string
    status: string
  }>(
    `SELECT id, order_index, title, summary, content_md, goal, self_check, word_count, figures_json, status
       FROM textbook_chapter WHERE textbook_id = ? ORDER BY order_index`,
    textbookId,
  ).map((r) => ({
    id: r.id,
    orderIndex: r.order_index,
    title: r.title,
    summary: r.summary,
    contentMd: r.content_md,
    goal: r.goal,
    selfCheck: r.self_check,
    wordCount: r.word_count,
    status: r.status,
    figures: (() => {
      try {
        return JSON.parse(r.figures_json || '[]')
      } catch {
        return []
      }
    })(),
  }))
}

function toBook(row: TextbookRow): Textbook {
  let profile: Profile | null = null
  try {
    const p = JSON.parse(row.profile_json || 'null')
    if (p && typeof p.familiarity === 'number') profile = p
  } catch {
    /* ignore */
  }
  let sources: string[] = []
  try {
    sources = JSON.parse(row.sources_json || '[]')
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    subtitle: row.subtitle,
    preface: row.preface,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    error: row.error ?? null,
    profile,
    sources,
    sourcesBlock: row.sources_block ?? '',
    chapters: chaptersOf(row.id),
    createdAt: row.created_at,
  }
}

export function getTextbook(courseId: string): Textbook | null {
  const row = one<TextbookRow>(
    `SELECT * FROM textbook WHERE course_id = ? ORDER BY created_at DESC LIMIT 1`,
    courseId,
  )
  return row ? toBook(row) : null
}

export function getTextbookById(id: string): Textbook | null {
  const row = one<TextbookRow>(`SELECT * FROM textbook WHERE id = ?`, id)
  return row ? toBook(row) : null
}

function setBookStage(
  id: string,
  stage: string,
  progress: number,
  extra: { status?: string; title?: string; subtitle?: string; preface?: string } = {},
): void {
  const sets: string[] = ['stage = ?', 'progress = ?', 'updated_at = ?']
  const vals: (string | number)[] = [stage, progress, nowIso()]
  if (extra.status) {
    sets.push('status = ?')
    vals.push(extra.status)
  }
  for (const k of ['title', 'subtitle', 'preface'] as const) {
    if (typeof extra[k] === 'string') {
      sets.push(`${k} = ?`)
      vals.push(extra[k] as string)
    }
  }
  vals.push(id)
  run(`UPDATE textbook SET ${sets.join(', ')} WHERE id = ?`, ...vals)
}

async function gatherSources(
  courseId: string,
  profile: Profile,
): Promise<{ name: string; headings: string[]; snippets: string[] }[]> {
  const mats = listMaterials(courseId)
  const out: { name: string; headings: string[]; snippets: string[] }[] = []

  for (const m of mats.slice(0, 8)) {
    const headings = all<{ heading_path: string }>(
      `SELECT DISTINCT heading_path FROM chunk WHERE material_id = ? AND heading_path != '' LIMIT 20`,
      m.id,
    ).map((r) => r.heading_path)

    let snippets: string[] = []
    try {
      const r = await hybridSearch(profile.focus || profile.summary, { courseId, topK: 3 })
      snippets = r.hits.map((h) => h.text.replace(/\s+/g, ' ').slice(0, 220))
    } catch {
      snippets = []
    }

    out.push({
      name: m.name || '未命名资料',
      headings: headings.map((h) => h.replace(/\s+/g, ' ')).slice(0, 10),
      snippets: snippets.slice(0, 3),
    })
  }
  return out
}

export async function buildTextbook(courseId: string): Promise<string> {
  const course = getCourse(courseId)
  if (!course) throw new Error('课程不存在')
  const profile = getProfile(courseId)
  if (!profile) throw new Error('还没做入学访谈')

  run(`DELETE FROM textbook WHERE course_id = ?`, courseId)
  const id = newId('tbk')
  const ts = nowIso()
  run(
    `INSERT INTO textbook(id, course_id, title, subtitle, preface, status, stage, progress, profile_json, sources_json, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    courseId,
    `${course.title}·给你的一本`,
    '',
    '',
    'building',
    'gathering',
    5,
    JSON.stringify(profile),
    '[]',
    ts,
    ts,
  )

  // 只启动"规划"（收集资料 + 大纲 + 建章节骨架），不等整本书写完：
  // 书由前端一章一个请求推下去（POST /api/textbook/:id/next），单请求 1–3 分钟，
  // 不会再出现"等了 5 分钟判超时、其实后台还在写"的情况。
  const p = planBook(id, course.title, profile).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    run(
      `UPDATE textbook SET status = 'failed', stage = 'failed', progress = 100, error = ?, updated_at = ? WHERE id = ?`,
      msg.slice(0, 300),
      nowIso(),
      id,
    )
    console.error(`[textbook] 规划失败 ${id}：${msg}`)
  })
  planning.set(id, p)
  void p.finally(() => planning.delete(id))

  return id
}

/* ------------------------------------------------------------------
   生成：两阶段

   为什么拆成两段：
     一章 4 节 × 3000 字 ≈ 12000 字，单次调用装不下。装不下的时候模型不会报错，
     它会**自动压缩**成骨架 —— 这正是学生抱怨"讲太浅"的根因。
     所以：先把这一章拆成几节（小调用），再一节一个调用写满，最后拼成 content_md。

   节与节之间用 `## 小节标题` 分隔，front-end 的 MiniMarkdown 会把 ## 渲染成小节标题。
   ------------------------------------------------------------------ */

type SectionPlan = { title: string; goal: string; figure: string }

type SectionDraft = {
  content: string
  keyPoint: string
  selfCheck: string
  figures: unknown[]
}

type BuiltChapter = {
  contentMd: string
  figures: unknown[]
  summary: string
  selfCheck: string
  wordCount: number
  sectionCount: number
}

/** 一节正文的 token 上限：3000+ 汉字约 3500 token，留足余量给 figures 和 JSON 外壳 */
const SECTION_MAX_TOKENS = 8000
/** 学生的硬指标：每一节不少于 3000 字。不到线的会被要求返工补写 */
const MIN_SECTION_CHARS = 3000
/** 一节最多调几次：首次 + 补写 + 最后一次机会 */
const SECTION_MAX_ATTEMPTS = 3
/** 逐节调用经常超过默认 90s 的超时，单独给宽一点 */
const SECTION_TIMEOUT_MS = 300_000
/** 串行写一章要 4–6 分钟，默认 3 路并发；网络差或怕限流可以设 ALP_TB_CONCURRENCY=1 */
const SECTION_CONCURRENCY = Math.max(
  1,
  Math.min(5, Number(process.env.ALP_TB_CONCURRENCY ?? '3') || 3),
)

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 限额并发：结果保持原顺序；单个任务的失败由 fn 自己兜住，不影响其它节 */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let cursor = 0
  const worker = async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }
  const n = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: n }, worker))
  return out
}

/** 写进提示词的画像块（和访谈里那套标签保持一致） */
function profileBlockOf(profile: Profile, goal: string): string {
  return `${profile.summary}
- 现有水平：${FAMILIARITY_LABEL[profile.familiarity]}
- 想做到：${profile.focus || goal}
- 偏好方式：${STYLE_LABEL[profile.style]}
- 需要协助程度：${SUPPORT_LABEL[profile.support]}
- 其他：${profile.notes.join('；') || '（无）'}`
}

/** 第一阶段：这一章拆成 3–5 节 */
async function planSections(args: {
  bookTitle: string
  chapterTitle: string
  chapterGoal: string
  profileBlock: string
}): Promise<SectionPlan[]> {
  const p = renderPrompt('textbook.sections', {
    bookTitle: args.bookTitle,
    chapterTitle: args.chapterTitle,
    chapterGoal: args.chapterGoal || args.chapterTitle,
    profile: args.profileBlock,
  })

  try {
    const r = await chat(
      [
        { role: 'system', content: p.system ?? '' },
        { role: 'user', content: p.user },
      ],
      { json: true, temperature: 0.6, maxTokens: 1500, timeoutMs: 120_000 },
    )
    const parsed = extractJson<{ sections?: { title?: string; goal?: string; figure?: string }[] }>(r.text)
    const list = (parsed?.sections ?? [])
      .map((s) => ({
        title: String(s?.title ?? '').trim(),
        goal: String(s?.goal ?? '').trim(),
        figure: String(s?.figure ?? '').trim(),
      }))
      .filter((s) => s.title.length > 0)
    if (list.length > 0) return list.slice(0, 5)
  } catch (e) {
    console.warn(`[textbook] 小节提纲失败，走兜底：${e instanceof Error ? e.message : e}`)
  }

  // 兜底：拆两节。宁可结构朴素，也不要因为提纲挂了整章报废。
  const goal = args.chapterGoal || args.chapterTitle
  return [
    { title: `${args.chapterTitle}：先搞清楚它是什么`, goal, figure: '概念与步骤示意' },
    { title: `${args.chapterTitle}：真动手走一遍`, goal, figure: '关键判断点对照图' },
  ]
}

/** 第二阶段：写一节正文（含重试一次） */
async function writeSection(args: {
  bookTitle: string
  chapterTitle: string
  chapterGoal: string
  plan: SectionPlan
  index: number
  total: number
  siblings: string
  profileBlock: string
}): Promise<SectionDraft> {
  const p = renderPrompt('textbook.chapter', {
    bookTitle: args.bookTitle,
    chapterTitle: args.chapterTitle,
    chapterGoal: args.chapterGoal || args.chapterTitle,
    sectionIndex: args.index,
    sectionTotal: args.total,
    sectionTitle: args.plan.title,
    sectionGoal: args.plan.goal || args.plan.title,
    sectionFigure: args.plan.figure || '这一节最容易讲不清的那个判断，画出来',
    siblings: args.siblings,
    profile: args.profileBlock,
  })

  let lastErr = ''
  let hint = ''
  let best: SectionDraft | null = null

  for (let attempt = 1; attempt <= SECTION_MAX_ATTEMPTS; attempt++) {
    try {
      const r = await chat(
        [
          { role: 'system', content: p.system ?? '' },
          { role: 'user', content: hint ? p.user + hint : p.user },
        ],
        {
          json: true,
          temperature: 0.75,
          maxTokens: SECTION_MAX_TOKENS,
          timeoutMs: SECTION_TIMEOUT_MS,
        },
      )

      const parsed = extractJson<{
        content?: string
        keyPoint?: string
        selfCheck?: string
        figures?: unknown[]
      }>(r.text)

      // JSON 解析失败时，如果返回的是裸 markdown（不是 JSON 外壳），还能救回来
      const raw = r.text.trim()
      const body = (parsed?.content ?? '').trim() || (raw.startsWith('{') ? '' : raw)
      if (body.length < 800) {
        throw new Error(`正文只有 ${body.length} 字，判定被截断`)
      }

      const figs = parsed?.figures
      const draft: SectionDraft = {
        content: body,
        keyPoint: (parsed?.keyPoint ?? '').trim(),
        selfCheck: (parsed?.selfCheck ?? '').trim(),
        figures: Array.isArray(figs) ? figs : [],
      }

      if (body.length >= MIN_SECTION_CHARS) return draft

      // 没到 3000 字：先留作兜底，再要一次补写 —— 压缩是默认行为，只能逼它返工
      if (!best || draft.content.length > best.content.length) best = draft
      console.warn(
        `[textbook] 第 ${args.index}/${args.total} 节「${args.plan.title}」只有 ${body.length} 字，要求补写（第 ${attempt} 次）`,
      )
      hint = `

【补写要求】你上一版只写了 ${body.length} 字，不到 3000 字的下限。
这一次按每块的字数下限把【定义】【怎么来的】【跟着走一遍】写厚，另外两块也不许缩。
总字数必须 ≥3000。别重复上一版已经写过的句子，直接展开上次没讲透的地方：
哪里缺反例、哪里缺判据、哪一步的"为什么"还没说。`
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      console.warn(
        `[textbook] 第 ${args.index}/${args.total} 节「${args.plan.title}」第 ${attempt} 次失败：${lastErr}`,
      )
      if (attempt < SECTION_MAX_ATTEMPTS) await sleep(4000)
    }
  }

  // 补写也没写够：交最长的那一版，别让整章因为字数不达标报废
  if (best) {
    console.warn(
      `[textbook] 第 ${args.index}/${args.total} 节「${args.plan.title}」最终 ${best.content.length} 字（低于 3000，已用最长版本）`,
    )
    return best
  }

  throw new Error(`第 ${args.index}/${args.total} 节「${args.plan.title}」写作失败：${lastErr}`)
}

/** 一章 = 提纲 + 逐节正文 + 拼装（章节正文、图、自检都在这里合成） */
async function buildChapter(args: {
  bookTitle: string
  chapterTitle: string
  chapterGoal: string
  chapterSummary: string
  profileBlock: string
  onStage?: (doneSections: number, totalSections: number) => void
}): Promise<BuiltChapter> {
  const plans = await planSections({
    bookTitle: args.bookTitle,
    chapterTitle: args.chapterTitle,
    chapterGoal: args.chapterGoal,
    profileBlock: args.profileBlock,
  })

  const siblings = plans.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
  const t0 = Date.now()
  let done = 0

  const drafts = await mapPool(plans, SECTION_CONCURRENCY, async (plan, i) => {
    const d = await writeSection({
      bookTitle: args.bookTitle,
      chapterTitle: args.chapterTitle,
      chapterGoal: args.chapterGoal,
      plan,
      index: i + 1,
      total: plans.length,
      siblings,
      profileBlock: args.profileBlock,
    })
    done += 1
    console.log(
      `[textbook] ${args.chapterTitle} · 第 ${i + 1}/${plans.length} 节「${plan.title}」${d.content.length} 字，${d.figures.length} 张图`,
    )
    args.onStage?.(done, plans.length)
    return d
  })

  const contentMd = plans
    .map((plan, i) => `## ${i + 1}. ${plan.title}\n\n${drafts[i].content}`)
    .join('\n\n')

  const figures = drafts.reduce<unknown[]>((acc, d) => acc.concat(d.figures), [])
  const keyPoints = drafts.map((d) => d.keyPoint).filter(Boolean)
  const summary = (keyPoints.join('；') || args.chapterSummary || args.chapterTitle).slice(0, 240)
  const selfCheck = drafts
    .reduce<string[]>((acc, d) => acc.concat(d.selfCheck.split(/[；;]/)), [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('；')

  console.log(
    `[textbook] 章「${args.chapterTitle}」完成：${plans.length} 节 / ${contentMd.length} 字 / ${figures.length} 张图，${Math.round((Date.now() - t0) / 1000)}s`,
  )

  return {
    contentMd,
    figures,
    summary,
    selfCheck,
    wordCount: contentMd.length,
    sectionCount: plans.length,
  }
}

/* ------------------------------------------------------------------
   一章一生成

   为什么不再"一次写完整本"：
     7 章的书要 20 多次模型调用、5–10 分钟，中间任何一层超时（前端轮询、
     代理、浏览器）都会把整本书判死，而它其实只是慢。拆成"先规划、再一章
     一个请求"之后：单次请求 1–3 分钟，失败只废一章还能单独重写，前端也
     不必再靠"等了多久"来猜是不是挂了。
   ------------------------------------------------------------------ */

export type StepResult = {
  /** 整本写完了 */
  done: boolean
  /** 刚写完的是第几章（1-based）；还没开始写时是 0 */
  chapterIndex: number
  /** 刚写完那一章的标题 */
  title: string
  /** 还剩几章没写 */
  remaining: number
  stage: string
  progress: number
}

/** 规划中的书 / 正在写的那一章：同一本书同时只允许一个在跑 */
const planning = new Map<string, Promise<void>>()
const writing = new Map<string, Promise<StepResult>>()

function stepView(book: Textbook, done: boolean): StepResult {
  return {
    done,
    chapterIndex: 0,
    title: '',
    remaining: book.chapters.filter((c) => c.status === 'pending' || c.status === 'writing').length,
    stage: book.stage,
    progress: book.progress,
  }
}

/**
 * 规划：收集资料 → 出大纲 → 章节骨架落库。正文一个字都不写。
 * 跑完就有一个稳定起点，后面每章一次请求往里填。
 */
async function planBook(id: string, courseTitle: string, profile: Profile): Promise<void> {
  const book = getTextbookById(id)
  if (!book) throw new Error('教材记录丢失')
  const course = getCourse(book.courseId)
  const goal = course?.goal ?? ''

  setBookStage(id, 'gathering', 10, { status: 'building' })
  const sources = await gatherSources(book.courseId, profile)
  run(`UPDATE textbook SET sources_json = ? WHERE id = ?`, JSON.stringify(sources.map((s) => s.name)), id)
  setBookStage(id, 'outline', 20)

  const srcBlock =
    sources.length > 0
      ? sources
          .map(
            (s) =>
              `《${s.name}》` +
              (s.headings.length ? `\n  章节：${s.headings.slice(0, 10).join(' / ')}` : '') +
              (s.snippets.length ? `\n  片段：${s.snippets.slice(0, 3).join(' … ').slice(0, 600)}` : ''),
          )
          .join('\n\n')
      : '（没有现成资料，按你的领域知识编排）'

  const pOutline = renderPrompt('textbook.outline', {
    courseTitle,
    goal,
    baseline: course?.baseline ?? '（未填）',
    profile: `${profile.summary}
- 现有水平：${FAMILIARITY_LABEL[profile.familiarity]}
- 想做到：${profile.focus || goal}
- 偏好方式：${STYLE_LABEL[profile.style]}
- 需要协助程度：${SUPPORT_LABEL[profile.support]}
- 其他：${profile.notes.join('；') || '（无）'}

可用的资料：
${srcBlock}`,
  })

  // 大纲是一次 2000 token 的 JSON 生成，deepseek-chat 出满常要 70–90s，
  // 用默认 90s 会稳定踩线 abort，进而把整本书打成 failed（实测会发生）。
  const outline = await chat(
    [
      { role: 'system', content: pOutline.system ?? '' },
      { role: 'user', content: pOutline.user },
    ],
    { json: true, temperature: 0.7, maxTokens: 2000, timeoutMs: 180_000 },
  )

  const parsed = extractJson<{
    title: string
    subtitle: string
    preface: string
    chapters: { title: string; goal: string; summary: string }[]
  }>(outline.text)

  if (!parsed?.chapters?.length) {
    setBookStage(id, 'failed', 100, { status: 'failed' })
    throw new Error('大纲生成失败：模型没给出章节列表')
  }

  const total = parsed.chapters.length

  // 资料摘要必须落库：拆成一章一个请求之后，写下一章时内存里已经没它了
  run(
    `UPDATE textbook SET title = ?, subtitle = ?, preface = ?, sources_block = ? WHERE id = ?`,
    parsed.title || `${courseTitle}·给你的一本`,
    parsed.subtitle || '',
    parsed.preface || '',
    srcBlock.slice(0, 8000),
    id,
  )

  // 章节骨架先建齐（pending），每章一次请求去填正文
  parsed.chapters.forEach((ch, i) => {
    run(
      `INSERT INTO textbook_chapter(id, textbook_id, order_index, title, summary, content_md, goal, self_check, word_count, figures_json, status, created_at)
       VALUES (?,?,?,?,?,'',?,'',0,'[]','pending',?)`,
      newId('chp'),
      id,
      i,
      ch.title,
      ch.summary || '',
      ch.goal || '',
      nowIso(),
    )
  })

  setBookStage(id, `已规划 ${total} 章`, 25)
}

/** 写下一章：同一本书并发调用会拿到同一个 promise，不会重复写同一章 */
export function writeNextChapter(textbookId: string): Promise<StepResult> {
  const running = writing.get(textbookId)
  if (running) return running
  const p = writeOneChapter(textbookId).finally(() => writing.delete(textbookId))
  writing.set(textbookId, p)
  return p
}

async function writeOneChapter(textbookId: string): Promise<StepResult> {
  // 规划还没跑完就先等它（前端可以 build 完立刻开始逐章，不用自己轮询）
  const planP = planning.get(textbookId)
  if (planP) await planP

  const book = getTextbookById(textbookId)
  if (!book) throw new Error('教材不存在或已被删除')
  if (book.status === 'failed') throw new Error(book.error || '这本书的规划失败了，重新生成一次')
  if (book.status === 'ready') return stepView(book, true)

  const total = book.chapters.length
  if (total === 0) throw new Error('这本书还没有章节规划')

  // writing 也捡回来：上次进程被打断留下的占位，重写一遍就好
  const next = book.chapters.find((c) => c.status === 'pending' || c.status === 'writing')
  if (!next) {
    setBookStage(textbookId, 'done', 100, { status: 'ready' })
    return stepView(getTextbookById(textbookId)!, true)
  }

  const profile = book.profile
  if (!profile) throw new Error('画像缺失，先做学情访谈')
  const course = getCourse(book.courseId)

  const doneBefore = book.chapters.filter((c) => c.status === 'done').length
  const pctAt = (frac: number) => Math.min(96, 30 + Math.round(((doneBefore + frac) / total) * 65))

  // 先占位成 writing：万一进程被打断，下次不会把它当成没写过而重头再来
  run(`UPDATE textbook_chapter SET status = 'writing' WHERE id = ?`, next.id)
  setBookStage(textbookId, `正在写第 ${next.orderIndex + 1}/${total} 章 · ${next.title}`, pctAt(0))

  const chProfile = `${profileBlockOf(profile, course?.goal ?? '')}

可引用资料：${book.sourcesBlock.slice(0, 5000)}`

  try {
    const built = await buildChapter({
      bookTitle: book.title,
      chapterTitle: next.title,
      chapterGoal: next.goal || next.summary,
      chapterSummary: next.summary || '',
      profileBlock: chProfile,
      onStage: (secDone, secAll) =>
        setBookStage(
          textbookId,
          `第 ${next.orderIndex + 1}/${total} 章 · ${next.title} ${secDone}/${secAll} 节`,
          pctAt(secDone / secAll),
        ),
    })

    run(
      `UPDATE textbook_chapter
          SET content_md = ?, summary = ?, self_check = ?, word_count = ?, figures_json = ?, status = 'done'
        WHERE id = ?`,
      built.contentMd,
      built.summary || next.summary,
      built.selfCheck,
      built.wordCount,
      JSON.stringify(built.figures),
      next.id,
    )
  } catch (e) {
    // 一章写废不牵连别的章：留个提示，右上角「重写这一章」能单独补
    run(
      `UPDATE textbook_chapter
          SET content_md = ?, self_check = '', word_count = 0, status = 'failed'
        WHERE id = ?`,
      `> 这一章生成失败：${e instanceof Error ? e.message.slice(0, 120) : '未知错误'}\n\n点右上角「重写这一章」再试一次。`,
      next.id,
    )
  }

  const after = getTextbookById(textbookId)!
  const left = after.chapters.filter((c) => c.status === 'pending' || c.status === 'writing').length

  if (left === 0) {
    setBookStage(textbookId, 'done', 100, { status: 'ready' })
    const fin = getTextbookById(textbookId)!
    return { ...stepView(fin, true), chapterIndex: next.orderIndex + 1, title: next.title }
  }

  setBookStage(textbookId, `已写完 ${after.chapters.length - left}/${total} 章`, pctAt(1))
  const mid = getTextbookById(textbookId)!
  return { ...stepView(mid, false), chapterIndex: next.orderIndex + 1, title: next.title }
}

/** 一口气写完（CLI / 脚本用；界面走 writeNextChapter，一次一章） */
export async function generateInto(
  id: string,
  courseTitle: string,
  _subtitle: string,
  profile: Profile,
): Promise<void> {
  await planBook(id, courseTitle, profile)
  for (;;) {
    const r = await writeOneChapter(id)
    if (r.done) break
  }
}

/** 单独重写一章：只动这一章，别的章一个字节都不碰 */
export async function rewriteChapter(chapterId: string): Promise<void> {
  const ch = one<{
    id: string
    textbook_id: string
    order_index: number
    title: string
    goal: string
    summary: string
  }>(
    `SELECT id, textbook_id, order_index, title, goal, summary FROM textbook_chapter WHERE id = ?`,
    chapterId,
  )
  if (!ch) throw new Error('章节不存在')
  const book = getTextbookById(ch.textbook_id)
  if (!book?.profile) throw new Error('教材或画像缺失')
  const course = getCourse(book.courseId)

  setBookStage(book.id, `重写第 ${ch.order_index + 1} 章`, book.progress)

  try {
    const built = await buildChapter({
      bookTitle: book.title,
      chapterTitle: ch.title,
      chapterGoal: ch.goal || ch.summary,
      chapterSummary: ch.summary,
      profileBlock: profileBlockOf(book.profile, course?.goal ?? ''),
      onStage: (secDone, secAll) =>
        setBookStage(book.id, `重写第 ${ch.order_index + 1} 章 · ${secDone}/${secAll} 节`, book.progress),
    })

    run(
      `UPDATE textbook_chapter
          SET content_md = ?, summary = ?, self_check = ?, word_count = ?, figures_json = ?, status = 'done'
        WHERE id = ?`,
      built.contentMd,
      built.summary,
      built.selfCheck,
      built.wordCount,
      JSON.stringify(built.figures),
      chapterId,
    )
    setBookStage(book.id, 'done', 100, { status: 'ready' })
  } catch (e) {
    // 失败时保留旧正文：宁可让他继续读上一版，也不要拿错误提示盖掉内容
    setBookStage(book.id, 'done', book.progress)
    throw e
  }
}

export function deleteTextbook(courseId: string): number {
  return run(`DELETE FROM textbook WHERE course_id = ?`, courseId).changes
}

/* ------------------------------------------------------------------
   看书模式：不生成，只把现成的书拆成章节
   ------------------------------------------------------------------ */

/**
 * 把一份资料按它自己的结构拆成章节，直接当教材用。
 *
 * 和 generateInto 的区别：那个是让模型写一本新书；
 * 这个是**尊重原书**，一个字的正文都不加，只切分。
 */
export function splitIntoChapters(
  courseId: string,
  materialId: string,
): { textbookId: string; chapters: number } {
  const mat = one<{ id: string; name: string; file_path: string | null }>(
    `SELECT id, name, file_path FROM material WHERE id = ?`,
    materialId,
  )
  if (!mat) throw new Error('资料不存在')

  // 优先用已解析好的 chunk（按 heading_path 分组），没有就读原文
  const chunks = all<{ text: string; heading_path: string; order_index: number }>(
    `SELECT text, heading_path, order_index FROM chunk WHERE material_id = ? ORDER BY order_index`,
    materialId,
  )

  type Section = { title: string; body: string[] }
  const sections: Section[] = []

  if (chunks.length > 0) {
    for (const c of chunks) {
      const head = (c.heading_path || '').split('>').pop()?.trim() || ''
      const title = head || '正文'
      const last = sections[sections.length - 1]
      if (last && last.title === title) {
        last.body.push(c.text)
      } else {
        sections.push({ title, body: [c.text] })
      }
    }
  }

  // chunk 里没有像样的标题结构，就退回按原文空行/标题切
  if (sections.length <= 1) {
    const raw = mat.file_path && fs.existsSync(mat.file_path)
      ? fs.readFileSync(mat.file_path, 'utf8')
      : chunks.map((c) => c.text).join('\n\n')

    const parts = raw.split(/\n(?=#{1,3}\s)/)
    if (parts.length > 1) {
      sections.length = 0
      for (const part of parts) {
        const m = /^#{1,3}\s+(.*)$/m.exec(part)
        const title = m ? m[1].trim() : '正文'
        sections.push({ title, body: [part.replace(/^#{1,3}\s+.*$/m, '').trim()] })
      }
    }
  }

  if (sections.length === 0) {
    sections.push({ title: '全文', body: [chunks.map((c) => c.text).join('\n\n') || '（这份资料没解析出内容）'] })
  }

  // 建书
  run(`DELETE FROM textbook WHERE course_id = ?`, courseId)
  const id = newId('tbk')
  const ts = nowIso()
  const course = getCourse(courseId)
  run(
    `INSERT INTO textbook(id, course_id, title, subtitle, preface, status, stage, progress, profile_json, sources_json, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    courseId,
    mat.name.replace(/\.[^.]+$/, ''),
    `按原书拆成 ${sections.length} 节`,
    `这是你自己带来的书。我一个字都没改，只按它本来的结构切成了 ${sections.length} 节。`,
    'ready',
    'done',
    100,
    JSON.stringify({ familiarity: 2, style: 'example', support: 'guided', focus: '', notes: [], summary: '按原书学习' }),
    JSON.stringify([mat.name]),
    ts,
    ts,
  )
  void course

  sections.forEach((s, i) => {
    const content = s.body.join('\n\n').trim()
    run(
      `INSERT INTO textbook_chapter(id, textbook_id, order_index, title, summary, content_md, goal, self_check, word_count, figures_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,'[]',?)`,
      newId('chp'),
      id,
      i,
      s.title.slice(0, 80),
      content.replace(/\s+/g, ' ').slice(0, 60),
      content,
      '',
      '',
      content.length,
      nowIso(),
    )
  })

  return { textbookId: id, chapters: sections.length }
}
