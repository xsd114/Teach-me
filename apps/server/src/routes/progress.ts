import type { FastifyInstance } from 'fastify'
import { progressFor, seedDemoProgress } from '../services/progress.js'

export async function progressRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/progress', async (req) => {
    const q = (req.query ?? {}) as { courseId?: string; days?: string }
    const courseId = q.courseId && q.courseId !== 'null' ? q.courseId : null
    const days = Math.max(7, Math.min(180, Number(q.days ?? 30)))
    return { ok: true, ...progressFor(courseId, days) }
  })

  app.post('/api/progress/seed', async (req, reply) => {
    const b = (req.body ?? {}) as { courseId?: string; days?: number }
    if (!b.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    const added = seedDemoProgress(b.courseId, Number(b.days ?? 14))
    return { ok: true, added }
  })
}
