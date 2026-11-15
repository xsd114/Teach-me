import type { FastifyInstance } from 'fastify'
import {
  advance,
  charBudget,
  endSession,
  generateOutline,
  getOrBuildPlan,
  getPin,
  getSession,
  recentLogs,
  refreshPin,
  startSession,
  type TeachIntent,
} from '../services/teach.js'
import { getCourse } from '../services/course.js'
import { getLesson } from '../services/lesson.js'
import { chat, hasApiKey, llmConfig, testLlm } from '../services/llm.js'
import { run, one } from '../db/index.js'
import { nowIso } from '../lib/id.js'

const INTENTS: TeachIntent[] = ['next', 'explain', 'example', 'simpler', 'confused', 'more']

export async function teachRoutes(app: FastifyInstance): Promise<void> {
  /* ── 模型配置 ── */

  app.get('/api/llm/config', async () => {
    const c = llmConfig()
    return {
      ok: true,
      provider: c.provider,
      baseUrl: c.baseUrl,
      model: c.model,
      temperature: c.temperature,
      maxTokens: c.maxTokens,
      hasKey: hasApiKey(),
      keyHint: c.apiKey ? `****${c.apiKey.slice(-4)}` : '',
    }
  })

  app.patch('/api/llm/config', async (req) => {
    const b = (req.body ?? {}) as {
      provider?: string
      baseUrl?: string
      model?: string
      apiKey?: string
      temperature?: number
      maxTokens?: number
    }
    const set = (k: string, v: string) => {
      run(
        `INSERT INTO setting(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        k,
        v,
      )
    }
    if (b.provider) set('llm.provider', b.provider)
    if (b.baseUrl) set('llm.baseUrl', b.baseUrl.trim().replace(/\/+$/, ''))
    if (b.model) set('llm.model', b.model.trim())
    if (typeof b.apiKey === 'string' && b.apiKey.trim()) set('llm.apiKey', b.apiKey.trim())
    if (typeof b.temperature === 'number') set('llm.temperature', String(b.temperature))
    if (typeof b.maxTokens === 'number') set('llm.maxTokens', String(b.maxTokens))
    return { ok: true, ...(await app.inject({ method: 'GET', url: '/api/llm/config' }).then((r) => JSON.parse(r.body))) }
  })

  app.post('/api/llm/test', async () => {
    const r = await testLlm()
    return r
  })

  /* ── 大纲 ── */

  app.post('/api/teach/outline', async (req, reply) => {
    const b = (req.body ?? {}) as { courseId?: string }
    if (!b.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId is required' }
    }
    if (!hasApiKey()) {
      reply.code(400)
      return { ok: false, error: '还没配置模型 API Key，去设置里填一个再生成大纲' }
    }
    try {
      const r = await generateOutline(b.courseId)
      return { ok: true, ...r }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '生成失败' }
    }
  })

  /* ── 优先阅读条目 ── */

  app.get('/api/teach/pin', async (req) => {
    const q = (req.query ?? {}) as { courseId?: string }
    if (!q.courseId) return { ok: false, error: 'courseId required' }
    return { ok: true, pin: getPin(q.courseId) }
  })

  app.post('/api/teach/pin/refresh', async (req, reply) => {
    const b = (req.body ?? {}) as { courseId?: string }
    if (!b.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    const pin = await refreshPin(b.courseId)
    return { ok: true, pin }
  })

  /* ── 会话 ── */

  app.post('/api/teach/start', async (req, reply) => {
    const b = (req.body ?? {}) as { courseId?: string; lessonId?: string | null; chapterId?: string | null }
    if (!b.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    if (!hasApiKey()) {
      reply.code(400)
      return { ok: false, error: '还没配置模型 API Key（设置 → 模型）' }
    }
    try {
      const { session, opening, pin, lesson, chapter } = await startSession(b.courseId, b.lessonId ?? null, b.chapterId ?? null)
      const course = getCourse(b.courseId)!
      const step = session.state.steps[session.state.stepIndex]
      return {
        ok: true,
        session: {
          id: session.id,
          stepIndex: session.state.stepIndex,
          totalSteps: session.state.steps.length,
          pace: session.pace,
        },
        lesson: lesson ? { id: lesson.id, title: lesson.title, summary: lesson.summary } : null,
        chapter,
        opening,
        pin,
        firstContent: session.state.lastContent,
        currentStep: step ?? null,
        budget: charBudget(course.verbosity),
      }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '开课失败' }
    }
  })

  app.post('/api/teach/advance', async (req, reply) => {
    const b = (req.body ?? {}) as { sessionId?: string; intent?: string; question?: string }
    if (!b.sessionId) {
      reply.code(400)
      return { ok: false, error: 'sessionId required' }
    }
    const intent = (INTENTS.includes(b.intent as TeachIntent) ? b.intent : 'next') as TeachIntent
    try {
      const r = await advance(b.sessionId, intent, b.question ?? '')
      const course = getCourse(r.session.courseId)
      return {
        ok: true,
        content: r.content,
        done: r.done,
        stepIndex: r.session.state.stepIndex,
        totalSteps: r.session.state.steps.length,
        currentStep: r.session.state.steps[r.session.state.stepIndex] ?? null,
        pace: r.session.pace,
        budget: course ? charBudget(course.verbosity) : 350,
      }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '推进失败' }
    }
  })

  app.post('/api/teach/end', async (req, reply) => {
    const b = (req.body ?? {}) as { sessionId?: string; note?: string }
    if (!b.sessionId) {
      reply.code(400)
      return { ok: false, error: 'sessionId required' }
    }
    try {
      const r = await endSession(b.sessionId, { note: b.note })
      return { ok: true, ...r }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '结束失败' }
    }
  })

  app.get('/api/teach/session/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const s = getSession(id)
    if (!s) {
      reply.code(404)
      return { ok: false, error: 'session not found' }
    }
    return { ok: true, session: s }
  })

  /* ── 记录与脚本 ── */

  app.get('/api/teach/logs', async (req) => {
    const q = (req.query ?? {}) as { courseId?: string; limit?: string }
    if (!q.courseId) return { ok: false, error: 'courseId required' }
    return { ok: true, logs: recentLogs(q.courseId, Number(q.limit ?? 20)) }
  })

  app.get('/api/teach/plan', async (req, reply) => {
    const q = (req.query ?? {}) as { lessonId?: string }
    if (!q.lessonId) {
      reply.code(400)
      return { ok: false, error: 'lessonId required' }
    }
    if (!getLesson(q.lessonId)) {
      reply.code(404)
      return { ok: false, error: 'lesson not found' }
    }
    const steps = await getOrBuildPlan(q.lessonId)
    return { ok: true, steps }
  })

  app.post('/api/teach/plan/rebuild', async (req, reply) => {
    const b = (req.body ?? {}) as { lessonId?: string }
    if (!b.lessonId) {
      reply.code(400)
      return { ok: false, error: 'lessonId required' }
    }
    if (!hasApiKey()) {
      reply.code(400)
      return { ok: false, error: '还没配置模型 API Key' }
    }
    const steps = await getOrBuildPlan(b.lessonId, { force: true })
    return { ok: true, steps }
  })

  /** 只测一下 prompt 渲染，不调模型——排障用 */
  app.post('/api/teach/dryrun', async (req) => {
    const b = (req.body ?? {}) as { messages?: { role: 'system' | 'user' | 'assistant'; content: string }[] }
    void b
    return { ok: true, note: 'dry-run 接口保留给调试用', at: nowIso() }
  })

  /** 模型直连（给"问答模式"复用） */
  app.post('/api/llm/chat', async (req, reply) => {
    const b = (req.body ?? {}) as {
      messages?: { role: 'system' | 'user' | 'assistant'; content: string }[]
      maxTokens?: number
    }
    if (!b.messages?.length) {
      reply.code(400)
      return { ok: false, error: 'messages required' }
    }
    try {
      const r = await chat(b.messages, { maxTokens: b.maxTokens })
      return { ok: true, ...r }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '调用失败' }
    }
  })

  /** 统计：给主界面的"今日"用 */
  app.get('/api/stats/today', async (req) => {
    const q = (req.query ?? {}) as { courseId?: string }
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const sql = q.courseId
      ? `SELECT COUNT(*) AS n, COALESCE(SUM(duration_sec),0) AS sec FROM teaching_log WHERE course_id = ? AND started_at >= ?`
      : `SELECT COUNT(*) AS n, COALESCE(SUM(duration_sec),0) AS sec FROM teaching_log WHERE started_at >= ?`
    const args = q.courseId ? [q.courseId, start.toISOString()] : [start.toISOString()]
    const r = one<{ n: number; sec: number }>(sql, ...args)
    return { ok: true, sessions: Number(r?.n ?? 0), minutes: Math.round(Number(r?.sec ?? 0) / 60) }
  })
}
