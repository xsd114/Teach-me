import type { FastifyInstance } from 'fastify'
import {
  deleteQuestion,
  generateQuestions,
  listQuestions,
  questionStats,
  submitAnswer,
  type QuestionType,
} from '../services/quiz.js'
import { hasApiKey } from '../services/llm.js'

export async function quizRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/questions', async (req, reply) => {
    const q = (req.query ?? {}) as { courseId?: string; due?: string; limit?: string }
    if (!q.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    return {
      ok: true,
      questions: listQuestions(q.courseId, {
        dueOnly: q.due === '1',
        limit: Number(q.limit ?? 50),
      }),
      stats: questionStats(q.courseId),
    }
  })

  app.post('/api/questions/generate', async (req, reply) => {
    const b = (req.body ?? {}) as {
      courseId?: string
      lessonId?: string | null
      count?: number
      types?: QuestionType[]
    }
    if (!b.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    if (!hasApiKey()) {
      reply.code(400)
      return { ok: false, error: '还没配置模型 API Key' }
    }
    try {
      const r = await generateQuestions({
        courseId: b.courseId,
        lessonId: b.lessonId ?? null,
        count: b.count,
        types: b.types,
      })
      return { ok: true, ...r, stats: questionStats(b.courseId) }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '出题失败' }
    }
  })

  app.post('/api/questions/:id/answer', async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = (req.body ?? {}) as { answer?: string; elapsedMs?: number }
    try {
      const r = submitAnswer(id, b.answer ?? '', Number(b.elapsedMs ?? 0))
      return { ok: true, ...r }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '提交失败' }
    }
  })

  app.delete('/api/questions/:id', async (req) => {
    const { id } = req.params as { id: string }
    return { ok: true, removed: deleteQuestion(id) }
  })
}
