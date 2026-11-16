import type { FastifyInstance } from 'fastify'
import {
  answerInterview,
  buildTextbook,
  deleteTextbook,
  FAMILIARITY_LABEL,
  getProfile,
  getTextbook,
  getTextbookById,
  rewriteChapter,
  saveProfile,
  startInterview,
  splitIntoChapters,
  STYLE_LABEL,
  SUPPORT_LABEL,
  writeNextChapter,
  type Profile,
} from '../services/textbook.js'
import { hasApiKey } from '../services/llm.js'
import { deleteInsert, expandChapter, listInserts } from '../services/chapterGrow.js'
import { getCourse } from '../services/course.js'
import { previewSplit, compareBooks } from '../services/bookSplit.js'

export async function textbookRoutes(app: FastifyInstance): Promise<void> {
  /* ── 访谈 ── */

  app.get('/api/onboarding/status', async (req, reply) => {
    const q = (req.query ?? {}) as { courseId?: string }
    if (!q.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    const profile = getProfile(q.courseId)
    const book = getTextbook(q.courseId)
    return {
      ok: true,
      onboarded: Boolean(profile),
      profile,
      textbook: book
        ? { id: book.id, status: book.status, progress: book.progress, title: book.title }
        : null,
      labels: {
        familiarity: FAMILIARITY_LABEL,
        style: STYLE_LABEL,
        support: SUPPORT_LABEL,
      },
    }
  })

  app.post('/api/onboarding/start', async (req, reply) => {
    const b = (req.body ?? {}) as { courseId?: string }
    if (!b.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    if (!getCourse(b.courseId)) {
      reply.code(404)
      return { ok: false, error: 'course not found' }
    }
    const st = startInterview(b.courseId)
    return {
      ok: true,
      interviewId: st.id,
      question: st.question,
      step: st.step,
      total: st.total,
    }
  })

  app.post('/api/onboarding/answer', async (req, reply) => {
    const b = (req.body ?? {}) as { interviewId?: string; questionId?: string; answer?: string }
    if (!b.interviewId || !b.questionId) {
      reply.code(400)
      return { ok: false, error: 'interviewId / questionId required' }
    }
    try {
      const r = await answerInterview(b.interviewId, b.questionId, b.answer ?? '')
      return {
        ok: true,
        done: r.done,
        next: r.next ?? null,
        profile: r.profile ?? null,
        step: r.state.step,
        total: r.state.total,
      }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '提交失败' }
    }
  })

  /** 直接改画像（访谈答错了/想调） */
  app.patch('/api/onboarding/profile', async (req, reply) => {
    const b = (req.body ?? {}) as { courseId?: string; profile?: Partial<Profile> }
    if (!b.courseId || !b.profile) {
      reply.code(400)
      return { ok: false, error: 'courseId / profile required' }
    }
    const cur = getProfile(b.courseId)
    const base: Profile = cur ?? {
      familiarity: 0,
      style: 'example',
      support: 'guided',
      focus: '',
      notes: [],
      summary: '',
    }
    const merged: Profile = { ...base, ...b.profile }
    saveProfile(b.courseId, merged)
    return { ok: true, profile: merged }
  })

  /* ── 教材 ── */

  /** 看书模式：把用户带来的书按原结构拆成章节，不生成任何内容 */
  app.post('/api/textbook/from-material', async (req, reply) => {
    const b = (req.body ?? {}) as { courseId?: string; materialId?: string }
    if (!b.courseId || !b.materialId) {
      reply.code(400)
      return { ok: false, error: 'courseId / materialId 都要有' }
    }
    try {
      const r = splitIntoChapters(b.courseId, b.materialId)
      return { ok: true, ...r }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '拆章节失败' }
    }
  })


  /** 拆书预览：只看目录，不落库 */
  app.post('/api/book/preview', async (req, reply) => {
    const b = (req.body ?? {}) as { materialId?: string }
    if (!b.materialId) {
      reply.code(400)
      return { ok: false, error: 'materialId required' }
    }
    try {
      const r = previewSplit(b.materialId)
      return {
        ok: true,
        name: r.name,
        count: r.sections.length,
        sections: r.sections.map((s) => ({ title: s.title, chars: s.chars, preview: s.preview })),
      }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '拆书失败' }
    }
  })

  /** 两本书对比 */
  app.post('/api/book/compare', async (req, reply) => {
    const b = (req.body ?? {}) as { aId?: string; bId?: string }
    if (!b.aId || !b.bId) {
      reply.code(400)
      return { ok: false, error: 'aId / bId 都要有' }
    }
    try {
      const a = previewSplit(b.aId)
      const b2 = previewSplit(b.bId)
      const r = compareBooks(a, b2)
      return { ok: true, a: a.name, b: b2.name, rows: r.rows, stats: r.stats }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '对比失败' }
    }
  })

  app.get('/api/textbook', async (req, reply) => {
    const q = (req.query ?? {}) as { courseId?: string; id?: string }
    if (q.id) {
      const book = getTextbookById(q.id)
      if (!book) {
        reply.code(404)
        return { ok: false, error: 'textbook not found' }
      }
      return { ok: true, textbook: book }
    }
    if (!q.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId or id required' }
    }
    const book = getTextbook(q.courseId)
    return { ok: true, textbook: book }
  })

  app.post('/api/textbook/build', async (req, reply) => {
    const b = (req.body ?? {}) as { courseId?: string }
    if (!b.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    if (!hasApiKey()) {
      reply.code(400)
      return { ok: false, error: '还没配置模型 API Key' }
    }
    if (!getProfile(b.courseId)) {
      reply.code(400)
      return { ok: false, error: '还没做学情访谈' }
    }
    try {
      const id = await buildTextbook(b.courseId)
      return { ok: true, textbookId: id }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '生成失败' }
    }
  })

  app.delete('/api/textbook', async (req, reply) => {
    const q = (req.query ?? {}) as { courseId?: string }
    if (!q.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    return { ok: true, removed: deleteTextbook(q.courseId) }
  })

  /**
   * 写下一章。一次请求 = 一章，返回 done:true 表示整本写完。
   * 前端串行调用即可，不需要再猜"等多久算超时"。
   */
  app.post('/api/textbook/:id/next', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!hasApiKey()) {
      reply.code(400)
      return { ok: false, error: '还没配置模型 API Key' }
    }
    try {
      const r = await writeNextChapter(id)
      return { ok: true, ...r }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '这一章没写成' }
    }
  })

  app.post('/api/textbook/:chapterId/rewrite', async (req, reply) => {
    const { chapterId } = req.params as { chapterId: string }
    if (!hasApiKey()) {
      reply.code(400)
      return { ok: false, error: '还没配置模型 API Key' }
    }
    try {
      await rewriteChapter(chapterId)
      return { ok: true }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '重写失败' }
    }
  })

  /** 导出整本为 Markdown（前端直接下载） */
  app.get('/api/textbook/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string }
    const book = getTextbookById(id)
    if (!book) {
      reply.code(404)
      return { ok: false, error: 'textbook not found' }
    }
    const lines: string[] = [`# ${book.title}`, '', `> ${book.subtitle}`, '', book.preface, '', '---', '']
    for (const [i, ch] of book.chapters.entries()) {
      lines.push(`## 第 ${i + 1} 章　${ch.title}`, '')
      if (ch.goal) lines.push(`**这一章要做到**：${ch.goal}`, '')
      lines.push(ch.contentMd, '')
      if (ch.selfCheck) lines.push(`**自检**：${ch.selfCheck}`, '')
      lines.push('---', '')
    }
    lines.push(`> 由 ALP 为 ${book.profile?.summary ?? '这位学生'} 生成 · ${new Date().toISOString().slice(0, 10)}`)
    reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(book.title)}.md"`)
    return lines.join('\n')
  })

  
  /* ── 多讲讲：就地续写一段 ── */

  app.get('/api/textbook/chapter/:chapterId/inserts', async (req) => {
    const { chapterId } = req.params as { chapterId: string }
    return { ok: true, inserts: listInserts(chapterId) }
  })

  app.post('/api/textbook/chapter/:chapterId/expand', async (req, reply) => {
    const { chapterId } = req.params as { chapterId: string }
    const b = (req.body ?? {}) as {
      sourceText?: string
      anchorIndex?: number
      contextBefore?: string
      contextAfter?: string
    }
    if (!b.sourceText?.trim()) {
      reply.code(400)
      return { ok: false, error: 'sourceText required' }
    }
    if (!hasApiKey()) {
      reply.code(400)
      return { ok: false, error: '还没配置模型 API Key' }
    }
    try {
      const ins = await expandChapter({
        chapterId,
        sourceText: b.sourceText,
        anchorIndex: b.anchorIndex,
        contextBefore: b.contextBefore,
        contextAfter: b.contextAfter,
      })
      return { ok: true, insert: ins }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '续写失败' }
    }
  })

  app.delete('/api/textbook/inserts/:id', async (req) => {
    const { id } = req.params as { id: string }
    return { ok: true, removed: deleteInsert(id) }
  })
}