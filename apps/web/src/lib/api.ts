import type { Course, CreateCourseInput, CourseKind, Lesson, Material, SearchHit } from './types'
import type { TextAnchor } from './anchor'

/** 贴在对话框上方、还没发出去的图（粘贴/上传/截图来的） */
export type ChatImage = {
  id: string
  name: string
  /** dataURL，直接能当 img.src */
  dataUrl: string
  w?: number
  h?: number
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`接口返回的不是 JSON（${res.status}）：${text.slice(0, 120)}`)
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data as T
}

export const api = {
  info: () =>
    req<{
      version: string
      node: string
      platform: string
      env: string
      paths: { home: string; db: string; uploads: string; models: string }
    }>('/api/info'),

  health: () =>
    req<{ ok: boolean; version: string; db: { ok: boolean; path: string; version: number } }>(
      '/api/health',
    ),

  listCourses: (status: 'active' | 'archived' | 'all' = 'active') =>
    req<{ ok: true; courses: Course[] }>(`/api/courses?status=${status}`),

  getCourse: (id: string) => req<{ ok: true; course: Course }>(`/api/courses/${id}`),

  createCourse: (input: CreateCourseInput) =>
    req<{ ok: true; course: Course }>('/api/courses', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateCourse: (id: string, patch: Partial<CreateCourseInput> & { status?: string }) =>
    req<{ ok: true; course: Course }>(`/api/courses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteCourse: (id: string, purgeMemory = true) =>
    req<{ ok: true }>(
      `/api/courses/${id}?purgeMemory=${purgeMemory ? '1' : '0'}`,
      { method: 'DELETE' },
    ),

  courseMemory: (id: string) =>
    req<{ ok: true; materials: number; chunks: number }>(`/api/courses/${id}/memory`),

  reorderCourses: (ids: string[]) =>
    req<{ ok: true; courses: Course[] }>('/api/courses/reorder', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  demoStatus: () => req<{ ok: true; loaded: boolean; loadedAt: string | null }>('/api/demo/status'),
  loadDemo: () =>
    req<{ ok: true; courses: Course[]; lessons: number; skipped: boolean }>('/api/demo/load', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  clearDemo: () => req<{ ok: true; removed: number }>('/api/demo/clear', { method: 'POST', body: '{}' }),

  /* ── 课时 ── */
  getCourseLessons: (courseId: string) =>
    req<{ ok: true; lessons: Lesson[] }>(`/api/courses/${courseId}/lessons`),

  updateLesson: (id: string, patch: { state?: Lesson['state']; title?: string; mastery?: number }) =>
    req<{ ok: true; lesson: Lesson }>(`/api/lessons/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  createLesson: (courseId: string, input: { title: string; summary?: string }) =>
    req<{ ok: true; lesson: Lesson }>(`/api/courses/${courseId}/lessons`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteLesson: (id: string) => req<{ ok: true }>(`/api/lessons/${id}`, { method: 'DELETE' }),

  /* ── 资料与记忆库 ── */
  listMaterials: (courseId: string | null) =>
    req<{
      ok: true
      materials: Material[]
      queue: { pending: number; running: boolean }
      vector: { ready: boolean; dims: number; error: string }
    }>(`/api/materials?courseId=${courseId ?? 'null'}`),

  memoryStats: (courseId: string | null) =>
    req<{
      ok: true
      stats: {
        materials: number
        indexed: number
        chunks: number
        vectors: number
        chars: number
        provider: string
      }
      vector: { ready: boolean; dims: number; error: string }
      queue: { pending: number; running: boolean }
      embed: { provider: string; model: string }
    }>(`/api/memory/stats?courseId=${courseId ?? 'null'}`),

  memorySuggest: (courseId: string | null) =>
    req<{
      ok: true
      chars: number
      files: number
      suggest: 'off' | 'recommend' | 'force'
      reason: string
    }>(`/api/memory/suggest?courseId=${courseId ?? 'null'}`),

  bindMaterial: (materialId: string, courseId: string) =>
    req<{ ok: true }>(`/api/materials/${materialId}/bind`, {
      method: 'POST',
      body: JSON.stringify({ courseId }),
    }),

  analyzeMaterial: (materialId: string) =>
    req<{
      ok: true
      materialId: string
      name: string
      chars: number
      topic: string
      summary: string
      points: string[]
      suitable: string
      error?: string
    }>('/api/materials/analyze', { method: 'POST', body: JSON.stringify({ materialId }) }),

  uploadMaterials: async (files: File[], courseId: string | null) => {
    const fd = new FormData()
    for (const f of files) fd.append('file', f, f.name)
    fd.append('courseId', courseId ?? 'null')
    const res = await fetch('/api/materials/upload', { method: 'POST', body: fd })
    const json = (await res.json()) as { ok: boolean; error?: string; materials?: Material[] }
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
    return json
  },

  importPath: (filePath: string, courseId: string | null) =>
    req<{ ok: true; material: Material }>('/api/materials/import', {
      method: 'POST',
      body: JSON.stringify({ filePath, courseId }),
    }),

  fetchUrl: (url: string, courseId: string | null, name?: string) =>
    req<{ ok: true; material: Material; chars: number; title: string }>('/api/materials/fetch-url', {
      method: 'POST',
      body: JSON.stringify({ url, courseId, name }),
    }),

  materialChunks: (id: string) =>
    req<{
      ok: true
      total: number
      chunks: { id: number; heading_path: string; text: string; char_count: number }[]
    }>(`/api/materials/${id}/chunks`),

  excludeMaterial: (id: string) =>
    req<{ ok: true; material: Material }>(`/api/materials/${id}/exclude`, { method: 'POST', body: '{}' }),

  reincludeMaterial: (id: string) =>
    req<{ ok: true; material: Material }>(`/api/materials/${id}/reinclude`, { method: 'POST', body: '{}' }),

  reprocessMaterial: (id: string) =>
    req<{ ok: true; material: Material }>(`/api/materials/${id}/reprocess`, { method: 'POST', body: '{}' }),

  deleteMaterial: (id: string) => req<{ ok: true }>(`/api/materials/${id}`, { method: 'DELETE' }),

  reindexMemory: (courseId: string | null) =>
    req<{ ok: true; queued: number }>('/api/memory/reindex', {
      method: 'POST',
      body: JSON.stringify({ courseId }),
    }),

  warmupEmbedding: () =>
    req<{ ok: boolean; model: string; dims: number; ms: number; error?: string }>(
      '/api/memory/warmup',
      { method: 'POST', body: '{}' },
    ),

  parseProbe: () =>
    req<{ ok: true; python: boolean; markitdown: boolean; version?: string }>('/api/parse/probe'),

  search: (q: string, courseId: string | null, topK = 8) =>
    req<{
      ok: true
      hits: SearchHit[]
      meta: { mode: string; fts: number; vec: number; ms: number }
    }>('/api/search', {
      method: 'POST',
      body: JSON.stringify({ q, courseId, topK }),
    }),

  /* ── 模型 ── */
  addAnnotation: (a: {
    courseId: string
    sourceKind: string
    sourceId?: string | null
    text: string
    color: string
    note?: string
  }) =>
    req<{ ok: true; annotation: unknown }>('/api/annotations', {
      method: 'POST',
      body: JSON.stringify(a),
    }),

  recolorAnnotation: (id: string, color: string) =>
    req<{ ok: true }>(`/api/annotations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ color }),
    }),

  annotations: (courseId: string) =>
    req<{ ok: true; annotations: unknown[]; snippets?: unknown[] }>(
      `/api/annotations?courseId=${encodeURIComponent(courseId)}`,
    ),

  rememberMarks: (courseId: string, color?: string) =>
    req<{ ok: true; added: number }>('/api/memory/from-marks', {
      method: 'POST',
      body: JSON.stringify({ courseId, color }),
    }),

  llmConfig: () =>
    req<{
      ok: true
      provider: string
      baseUrl: string
      model: string
      temperature: number
      maxTokens: number
      hasKey: boolean
      keyHint: string
    }>('/api/llm/config'),

  patchLlm: (patch: {
    provider?: string
    baseUrl?: string
    model?: string
    apiKey?: string
    temperature?: number
    maxTokens?: number
  }) =>
    req<{ ok: true }>('/api/llm/config', { method: 'PATCH', body: JSON.stringify(patch) }),

  testLlm: () =>
    req<{ ok: boolean; model: string; baseUrl: string; ms: number; reply?: string; error?: string }>(
      '/api/llm/test',
      { method: 'POST', body: '{}' },
    ),

  /* ── 教学 ── */
  generateOutline: (courseId: string) =>
    req<{ ok: true; lessons: Lesson[]; added: number; raw?: string }>('/api/teach/outline', {
      method: 'POST',
      body: JSON.stringify({ courseId }),
    }),

  getPin: (courseId: string) =>
    req<{ ok: true; pin: string }>(`/api/teach/pin?courseId=${courseId}`),

  refreshPin: (courseId: string) =>
    req<{ ok: true; pin: string }>('/api/teach/pin/refresh', {
      method: 'POST',
      body: JSON.stringify({ courseId }),
    }),

  startTeach: (courseId: string, lessonId?: string | null) =>
    req<{
      ok: true
      session: { id: string; stepIndex: number; totalSteps: number; pace: string }
      lesson: { id: string; title: string; summary: string } | null
      opening: string
      pin: string
      firstContent: string
      currentStep: TeachStep | null
      budget: number
    }>('/api/teach/start', {
      method: 'POST',
      body: JSON.stringify({ courseId, lessonId: lessonId ?? null }),
    }),

  advanceTeach: (sessionId: string, intent: TeachIntent, question = '') =>
    req<{
      ok: true
      content: string
      done: boolean
      stepIndex: number
      totalSteps: number
      currentStep: TeachStep | null
      pace: string
      budget: number
    }>('/api/teach/advance', {
      method: 'POST',
      body: JSON.stringify({ sessionId, intent, question }),
    }),

  endTeach: (sessionId: string, note?: string) =>
    req<{
      ok: true
      log: { id: string; pace: string; reason: string; summary: string; nextHint: string }
      session: unknown
    }>('/api/teach/end', {
      method: 'POST',
      body: JSON.stringify({ sessionId, note }),
    }),

  teachLogs: (courseId: string, limit = 20) =>
    req<{ ok: true; logs: TeachLog[] }>(`/api/teach/logs?courseId=${courseId}&limit=${limit}`),

  lessonPlan: (lessonId: string) =>
    req<{ ok: true; steps: TeachStep[] }>(`/api/teach/plan?lessonId=${lessonId}`),

  statsToday: (courseId?: string) =>
    req<{ ok: true; sessions: number; minutes: number }>(
      `/api/stats/today${courseId ? `?courseId=${courseId}` : ''}`,
    ),

  /* ── 进度 ── */
  progress: (courseId: string | null, days = 30) =>
    req<{ ok: true } & ProgressPayload>(
      `/api/progress?courseId=${courseId ?? 'null'}&days=${days}`,
    ),

  seedProgress: (courseId: string, days = 14) =>
    req<{ ok: true; added: number }>('/api/progress/seed', {
      method: 'POST',
      body: JSON.stringify({ courseId, days }),
    }),

  /* ── 问答 ── */
  qaStatus: (courseId: string | null) =>
    req<{
      ok: true
      materials: number
      chunks: number
      courses: { id: string; title: string }[]
      hasKey: boolean
    }>(`/api/qa/status?courseId=${courseId ?? 'null'}`),

  qaThreads: (courseId: string | null) =>
    req<{
      ok: true
      threads: { id: string; title: string; courseId: string | null; updatedAt: string; messageCount: number }[]
    }>(`/api/qa/threads?courseId=${courseId ?? 'null'}`),

  qaThread: (threadId: string) =>
    req<{ ok: true; messages: QaMessage[] }>(`/api/qa/threads/${threadId}`),

  qaDeleteThread: (threadId: string) =>
    req<{ ok: true; removed: boolean }>(`/api/qa/threads/${threadId}`, { method: 'DELETE' }),

  qaAsk: (
    question: string,
    courseId: string | null,
    threadId?: string | null,
    extra?: { context?: string; quote?: string; anchor?: TextAnchor | null },
  ) =>
    req<{
      ok: true
      threadId: string
      messageId: string
      answer: string
      citations: Citation[]
      meta: { mode: string; hits: number; ms: number; model: string }
    }>('/api/qa/ask', {
      method: 'POST',
      body: JSON.stringify({ question, courseId, threadId: threadId ?? null, ...(extra ?? {}) }),
    }),

  /* ── 练习 ── */
  questions: (courseId: string, dueOnly = false) =>
    req<{ ok: true; questions: Question[]; stats: QuizStats }>(
      `/api/questions?courseId=${courseId}${dueOnly ? '&due=1' : ''}`,
    ),

  generateQuestions: (courseId: string, count = 5, lessonId?: string | null) =>
    req<{ ok: true; created: Question[]; stats: QuizStats; raw?: string }>(
      '/api/questions/generate',
      {
        method: 'POST',
        body: JSON.stringify({ courseId, count, lessonId: lessonId ?? null }),
      },
    ),

  answerQuestion: (id: string, answer: string, elapsedMs = 0) =>
    req<{
      ok: true
      correct: boolean
      nextDueAt: string
      state: { ease: number; interval: number; reps: number; lapses: number }
      question: Question
    }>(`/api/questions/${id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answer, elapsedMs }),
    }),

  deleteQuestion: (id: string) => req<{ ok: true; removed: boolean }>(`/api/questions/${id}`, { method: 'DELETE' }),
}

export type Question = {
  id: string
  courseId: string
  lessonId: string | null
  type: 'mcq' | 'blank' | 'short' | 'calc'
  stem: string
  options: string[]
  answer: string
  explain: string
  source: string
  dueAt: string | null
  createdAt: string
  lastCorrect: boolean | null
  attempts: number
}

export type QuizStats = { total: number; due: number; wrong: number; accuracy: number }

export type TeachStep = { kind: string; title: string; goal: string; hint: string }
export type TeachIntent = 'next' | 'explain' | 'example' | 'simpler' | 'confused' | 'more'
export type ProgressPayload = {
  daily: { date: string; minutes: number; sessions: number; questions: number }[]
  mastery: { date: string; value: number; lessonId: string | null }[]
  heatmap: { date: string; minutes: number; level: 0 | 1 | 2 | 3 | 4 }[]
  totals: { minutes: number; sessions: number; days: number; streak: number }
  lessons: { id: string; title: string; state: string; mastery: number }[]
}

export type Citation = {
  n: number
  materialId: string
  materialName: string
  headingPath: string
  snippet: string
  chunkId: number
}

export type QaMessage = {
  id: string
  role: string
  content: string
  citations: Citation[]
  /** 这条消息带过的引用（引用原文 + 位置锚），刷新/全屏后还能还原 */
  attach?: { quote?: string; anchor?: TextAnchor | null } | null
  createdAt: string
}
export type TeachLog = {
  id: string
  startedAt: string
  endedAt: string | null
  durationSec: number
  covered: string[]
  masteryBefore: number | null
  masteryAfter: number | null
  pace: string | null
  reason: string | null
  nextHint: string | null
  lessonId: string | null
}

/* ---------------- 展示用的小工具 ---------------- */

export const KIND_META: Record<CourseKind, { label: string; hint: string }> = {
  skill: { label: '技能', hint: '动手练，按步骤出成果' },
  academic: { label: '学业', hint: '有考试，要出题与复习' },
}

export function relTime(iso: string | null): string {
  if (!iso) return '还没开始'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d === 1) return '昨天'
  if (d < 30) return `${d} 天前`
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.ceil((t - Date.now()) / 86_400_000)
}
/* ---------------- 学情访谈 / 专属教材 ---------------- */

export const onboardingApi = {
  status: (courseId: string) =>
    req<{
      ok: true
      onboarded: boolean
      profile: Profile | null
      textbook: { id: string; status: string; progress: number; title: string } | null
    }>('/api/onboarding/status?courseId=' + encodeURIComponent(courseId)),

  start: (courseId: string) =>
    req<{ ok: true; interviewId: string; question: OnboardingQuestion; step: number; total: number }>(
      '/api/onboarding/start',
      { method: 'POST', body: JSON.stringify({ courseId }) },
    ),

  answer: (interviewId: string, questionId: string, answer: string) =>
    req<{
      ok: true
      done: boolean
      next: OnboardingQuestion | null
      profile: Profile | null
      step: number
      total: number
    }>('/api/onboarding/answer', {
      method: 'POST',
      body: JSON.stringify({ interviewId, questionId, answer }),
    }),
}

export const textbookApi = {
  get: (courseId: string) =>
    req<{ ok: true; textbook: Textbook | null }>('/api/textbook?courseId=' + encodeURIComponent(courseId)),

  build: (courseId: string) =>
    req<{ ok: true; textbookId: string }>('/api/textbook/build', {
      method: 'POST',
      body: JSON.stringify({ courseId }),
    }),

  /** 写下一章。一次请求一章，done=true 表示整本写完 */
  next: (id: string) =>
    req<{
      ok: true
      done: boolean
      chapterIndex: number
      title: string
      remaining: number
      stage: string
      progress: number
    }>('/api/textbook/' + encodeURIComponent(id) + '/next', {
      method: 'POST',
      body: '{}',
    }),

  remove: (courseId: string) =>
    req<{ ok: true; removed: number }>('/api/textbook?courseId=' + encodeURIComponent(courseId), {
      method: 'DELETE',
    }),

  rewriteChapter: (chapterId: string) =>
    req<{ ok: true }>('/api/textbook/' + encodeURIComponent(chapterId) + '/rewrite', {
      method: 'POST',
      body: '{}',
    }),

  exportUrl: (id: string) => '/api/textbook/' + encodeURIComponent(id) + '/export',
}

export type OnboardingQuestion = {
  id: string
  text: string
  hint?: string
  kind: 'choice' | 'text'
  options?: { value: string; label: string; desc?: string }[]
}

export type Profile = {
  familiarity: number
  style: 'principle' | 'example' | 'hands-on'
  support: 'handholding' | 'guided' | 'independent'
  focus: string
  notes: string[]
  summary: string
}

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
  /** pending 还没写 / writing 正在写 / done 写完 / failed 这次没写成 */
  status?: 'pending' | 'writing' | 'done' | 'failed'
}

export type Textbook = {
  id: string
  courseId: string
  title: string
  subtitle: string
  preface: string
  status: 'draft' | 'building' | 'ready' | 'failed'
  stage: string
  progress: number
  error: string | null
  profile: Profile | null
  sources: string[]
  createdAt: string
  updatedAt: string
  chapters: TextbookChapter[]
}

/* ---------------- 标记 / 划词问答 ---------------- */

export const annotationApi = {
  recolor: (id: string, color: string) =>
    req<{ ok: true }>(`/api/annotations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ color }),
    }),

  list: (courseId: string, sourceId?: string | null) =>
    req<{ ok: true; annotations: Annotation[]; snippets: string[] }>(
      '/api/annotations?courseId=' + encodeURIComponent(courseId) +
        (sourceId ? '&sourceId=' + encodeURIComponent(sourceId) : ''),
    ),

  create: (input: {
    courseId: string
    sourceKind?: string
    sourceId?: string | null
    text: string
    note?: string
    color?: string
    startOffset?: number
    endOffset?: number
    inMemory?: boolean
  }) =>
    req<{ ok: true; annotation: Annotation }>('/api/annotations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  remove: (id: string) =>
    req<{ ok: true; removed: boolean }>('/api/annotations/' + encodeURIComponent(id), { method: 'DELETE' }),

  markPending: (threadId: string, courseId: string, quote: string) =>
    req<{ ok: true; annotationId?: string }>(
      '/api/qa/threads/' + encodeURIComponent(threadId) + '/pending',
      { method: 'POST', body: JSON.stringify({ courseId, quote }) },
    ),
}

export type Annotation = {
  id: string
  courseId: string
  sourceKind: string
  sourceId: string | null
  text: string
  note: string
  color: string
  startOffset: number
  endOffset: number
  inMemory: boolean
  createdAt: string
}

export const growApi = {
  inserts: (chapterId: string) =>
    req<{ ok: true; inserts: ChapterInsert[] }>(
      '/api/textbook/chapter/' + encodeURIComponent(chapterId) + '/inserts',
    ),

  expand: (
    chapterId: string,
    input: { sourceText: string; anchorIndex?: number; contextBefore?: string; contextAfter?: string },
  ) =>
    req<{ ok: true; insert: ChapterInsert }>(
      '/api/textbook/chapter/' + encodeURIComponent(chapterId) + '/expand',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  remove: (id: string) =>
    req<{ ok: true; removed: boolean }>('/api/textbook/inserts/' + encodeURIComponent(id), {
      method: 'DELETE',
    }),
}

export type ChapterInsert = {
  id: string
  chapterId: string
  anchorIndex: number
  anchorText: string
  title: string
  contentMd: string
  sourceText: string
  depth: number
  createdAt: string
}

/* ---------------- 自习答疑 ---------------- */

export const selfStudyApi = {
  /**
   * 自习问答。
   *   courseId = null → 全部科目（跨库检索，没有教材编号可定位）
   *   anchor        → 引用锚，带上就不用再问"你指的是哪一段"
   */
  ask: (
    courseId: string | null,
    question: string,
    label?: string,
    extra?: { anchor?: TextAnchor | null; quote?: string },
  ) =>
    req<{ ok: true } & SelfStudyResult>('/api/selfstudy/ask', {
      method: 'POST',
      body: JSON.stringify({
        courseId,
        question,
        label,
        anchor: extra?.anchor ?? null,
        quote: extra?.quote,
      }),
    }),

  paragraphs: (courseId: string, chapterNo?: number) =>
    req<{ ok: true; options: { label: string; preview: string }[] }>(
      `/api/selfstudy/paragraphs?courseId=${encodeURIComponent(courseId)}` +
        (chapterNo ? `&chapterNo=${chapterNo}` : ''),
    ),
}

export type SelfStudyResult = {
  kind: 'need_paragraph' | 'need_clarify' | 'answer'
  message: string
  answer?: string
  figures?: unknown[]
  paragraph?: { label: string; text: string }
  options?: { label: string; preview: string }[]
}

/* ---------------- MOSS ---------------- */

// 挂在 api 对象上的几个方法（设置页用）
export const mossApi = {
  status: () =>
    req<{
      ok: true
      configured: boolean
      enabled: boolean
      model: string
      voiceId: string
      keyHint: string
      lastError: string
      consoleUrl: string
    }>('/api/moss/status'),

  config: (patch: { apiKey?: string; liveModel?: string; liveEnabled?: boolean; voiceId?: string }) =>
    req<{ ok: true }>('/api/moss/config', { method: 'PATCH', body: JSON.stringify(patch) }),

  voices: () =>
    req<{ ok: boolean; voices: { id: string; name: string }[]; error?: string }>('/api/tts/voices'),

  useAsLlm: () =>
    req<{ ok: boolean; model: string; ms: number; reply?: string; error?: string }>(
      '/api/moss/use-as-llm',
      { method: 'POST', body: '{}' },
    ),
}

export type LogFileInfo = { name: string; kind: string; bytes: number; mtime: string }

export type DiagnosticsInfo = {
  generatedAt: string
  app: Record<string, string | number | boolean>
  paths: Record<string, string>
  db: { version: number; sizeBytes: number; counts: Record<string, number> }
  model: Record<string, string | number | boolean>
  voice: Record<string, string | boolean>
  parse: Record<string, string | boolean>
  vector: Record<string, string | number | boolean>
  logs: { files: LogFileInfo[]; ringLines: number; errors: number }
  problems: {
    failedMaterials: { name: string; error: string }[]
    teaching: string[]
    recentErrors: string[]
  }
}

/* ---------------- 日志与诊断 ---------------- */

export const diagnosticsApi = {
  /** 面板用：结构化摘要 + 日志文件清单 */
  info: () =>
    req<{ ok: true; info: DiagnosticsInfo; logsDir: string; files: LogFileInfo[] }>('/api/diagnostics'),

  /** 生成一份 txt 落到 logs/，同时把全文带回来（前端直接下载） */
  bundle: () =>
    req<{ ok: true; filename: string; filePath: string; bytes: number; text: string }>(
      '/api/diagnostics/bundle',
      { method: 'POST', body: '{}' },
    ),

  files: () => req<{ ok: true; logsDir: string; files: LogFileInfo[] }>('/api/diagnostics/files'),

  tail: (name: string, lines = 300) =>
    req<{ ok: true; name: string; lines: number; body: string }>(
      `/api/diagnostics/files/${encodeURIComponent(name)}?lines=${lines}`,
    ),

  clear: () =>
    req<{ ok: true; removed: number; freedBytes: number }>('/api/diagnostics/clear', {
      method: 'POST',
      body: '{}',
    }),

  openFolder: () =>
    req<{ ok: true; path: string }>('/api/diagnostics/open-folder', { method: 'POST', body: '{}' }),

  /** 前端报错回传；自己会吞掉异常，不许影响页面 */
  clientError: async (payload: {
    kind?: string
    message: string
    stack?: string
    url?: string
    at?: string
  }) => {
    try {
      await fetch('/api/diagnostics/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, ua: navigator.userAgent }),
      })
    } catch {
      /* 服务都没起来就算了 */
    }
  },
}

/* ---------------- 提示词 ---------------- */

export type PromptView = {
  key: string
  name: string
  group: string
  desc: string
  system: string
  body: string
  systemDefault: string
  bodyDefault: string
  overridden: boolean
}

export const promptApi = {
  list: () => req<{ ok: true; prompts: PromptView[]; stats: { total: number; overridden: number } }>('/api/prompts'),

  save: (key: string, patch: { system?: string; body?: string }) =>
    req<{ ok: true; prompts: PromptView[] }>('/api/prompts/' + encodeURIComponent(key), {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  reset: (key: string) =>
    req<{ ok: true; prompts: PromptView[] }>('/api/prompts/' + encodeURIComponent(key) + '/reset', {
      method: 'DELETE',
    }),

  resetAll: () => req<{ ok: true; cleared: number; prompts: PromptView[] }>('/api/prompts/reset-all', { method: 'POST', body: '{}' }),
}

/* ---------------- 错题本 / 记忆库 ---------------- */

export const mistakeApi = {
  list: (courseId: string) =>
    req<{ ok: true; mistakes: Mistake[]; total: number; unreviewed: number }>(
      '/api/mistakes?courseId=' + encodeURIComponent(courseId),
    ),

  add: (input: { courseId: string; label?: string; question: string; answer: string; source?: string }) =>
    req<{ ok: true; id: string }>('/api/mistakes', { method: 'POST', body: JSON.stringify(input) }),

  reviewed: (id: string, reviewed: boolean) =>
    req<{ ok: true }>('/api/mistakes/' + encodeURIComponent(id) + '/reviewed', {
      method: 'POST',
      body: JSON.stringify({ reviewed }),
    }),

  remove: (id: string) =>
    req<{ ok: true; removed: boolean }>('/api/mistakes/' + encodeURIComponent(id), { method: 'DELETE' }),

  remember: (input: { courseId: string; label?: string; question: string; answer: string }) =>
    req<{ ok: true; annotationId: string }>('/api/selfstudy/remember', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}

export type Mistake = {
  id: string
  courseId: string
  label: string
  question: string
  answer: string
  source: string
  reviewed: boolean
  createdAt: string
}