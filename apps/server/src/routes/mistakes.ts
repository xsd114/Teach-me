import type { FastifyInstance } from 'fastify'
import { all, run } from '../db/index.js'
import { newId, nowIso } from '../lib/id.js'
import { createAnnotation } from '../services/annotation.js'

/**
 * 错题本，以及"把一轮问答存进记忆库"。
 *
 * 两个动作的区别（界面上是两个按钮）：
 *   加入错题本 —— 这题我错了/没懂，以后要重做。进 mistake 表，可以复习、可以标记已掌握。
 *   存入记忆库 —— 这段讲解有用，以后讲课/出题要能检索到。进 annotation 表，带 inMemory。
 */

type MistakeRow = {
  id: string
  course_id: string
  label: string
  question: string
  answer: string
  source: string
  reviewed: number
  created_at: string
}

export async function mistakeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/mistakes', async (req, reply) => {
    const q = (req.query ?? {}) as { courseId?: string }
    if (!q.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    const rows = all<MistakeRow>(
      `SELECT * FROM mistake WHERE course_id = ? ORDER BY created_at DESC LIMIT 200`,
      q.courseId,
    )
    return {
      ok: true,
      mistakes: rows.map((r) => ({
        id: r.id,
        courseId: r.course_id,
        label: r.label,
        question: r.question,
        answer: r.answer,
        source: r.source,
        reviewed: Boolean(r.reviewed),
        createdAt: r.created_at,
      })),
      total: rows.length,
      unreviewed: rows.filter((r) => !r.reviewed).length,
    }
  })

  app.post('/api/mistakes', async (req, reply) => {
    const b = (req.body ?? {}) as {
      courseId?: string
      label?: string
      question?: string
      answer?: string
      source?: string
    }
    if (!b.courseId || !b.question?.trim() || !b.answer?.trim()) {
      reply.code(400)
      return { ok: false, error: 'courseId / question / answer 都要有' }
    }
    const id = newId('mst')
    run(
      `INSERT INTO mistake(id, course_id, label, question, answer, source, reviewed, created_at)
       VALUES (?,?,?,?,?,?,0,?)`,
      id,
      b.courseId,
      b.label ?? '',
      b.question.trim(),
      b.answer.trim(),
      b.source ?? 'selfstudy',
      nowIso(),
    )
    return { ok: true, id }
  })

  app.post('/api/mistakes/:id/reviewed', async (req) => {
    const { id } = req.params as { id: string }
    const b = (req.body ?? {}) as { reviewed?: boolean }
    run(`UPDATE mistake SET reviewed = ? WHERE id = ?`, b.reviewed ? 1 : 0, id)
    return { ok: true }
  })

  app.delete('/api/mistakes/:id', async (req) => {
    const { id } = req.params as { id: string }
    return { ok: true, removed: run(`DELETE FROM mistake WHERE id = ?`, id).changes > 0 }
  })

  /**
   * 把一轮问答存进记忆库。
   * 和错题本不同：这条会被当成"学生关心的知识点"，回答问题时能检索到。
   */
  app.post('/api/selfstudy/remember', async (req, reply) => {
    const b = (req.body ?? {}) as {
      courseId?: string
      question?: string
      answer?: string
      label?: string
    }
    if (!b.courseId || !b.question?.trim()) {
      reply.code(400)
      return { ok: false, error: 'courseId / question required' }
    }
    const text = `【${b.label || '自习提问'}】${b.question.trim()}\n\n${(b.answer ?? '').trim()}`
    const ann = createAnnotation({
      courseId: b.courseId,
      sourceKind: 'qa',
      sourceId: null,
      text: text.slice(0, 1200),
      note: b.label || '',
      color: 'blue',
      inMemory: true,
    })
    return { ok: true, annotationId: ann.id }
  })
}
