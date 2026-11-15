import type { FastifyInstance } from 'fastify'
import { ask, deleteThread, listThreads, qaScopeStatus, threadMessages } from '../services/qa.js'
import { hasApiKey } from '../services/llm.js'

export async function qaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/qa/threads', async (req) => {
    const q = (req.query ?? {}) as { courseId?: string }
    const courseId = q.courseId && q.courseId !== 'null' ? q.courseId : null
    return { ok: true, threads: listThreads(courseId) }
  })

  app.get('/api/qa/threads/:id', async (req) => {
    const { id } = req.params as { id: string }
    return { ok: true, messages: threadMessages(id) }
  })

  app.delete('/api/qa/threads/:id', async (req) => {
    const { id } = req.params as { id: string }
    return { ok: true, removed: deleteThread(id) }
  })

  app.get('/api/qa/status', async (req) => {
    const q = (req.query ?? {}) as { courseId?: string }
    const courseId = q.courseId && q.courseId !== 'null' ? q.courseId : null
    return { ok: true, ...qaScopeStatus(courseId), hasKey: hasApiKey() }
  })

  app.post('/api/qa/ask', async (req, reply) => {
    const b = (req.body ?? {}) as {
      question?: string
      courseId?: string | null
      threadId?: string | null
      topK?: number
      context?: string
      quote?: string
    }
    if (!b.question?.trim()) {
      reply.code(400)
      return { ok: false, error: 'question is required' }
    }
    if (!hasApiKey()) {
      reply.code(400)
      return { ok: false, error: '还没配置模型 API Key（设置 → 模型）' }
    }
    try {
      const r = await ask({
        question: b.question.trim(),
        courseId: b.courseId ?? null,
        threadId: b.threadId ?? null,
        topK: b.topK,
        context: b.context,
        quote: b.quote,
      })
      return { ok: true, ...r }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '回答失败' }
    }
  })
}
