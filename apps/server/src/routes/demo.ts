import type { FastifyInstance } from 'fastify'
import { clearDemo, demoStatus, loadDemo } from '../services/demo.js'
import { listCourses } from '../services/course.js'

export async function demoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/demo/status', async () => ({ ok: true, ...demoStatus() }))

  app.post('/api/demo/load', async (req) => {
    const b = (req.body ?? {}) as { force?: boolean }
    const r = loadDemo(Boolean(b.force))
    return { ok: true, ...r, courses: listCourses('all') }
  })

  app.post('/api/demo/clear', async () => {
    const removed = clearDemo()
    return { ok: true, removed }
  })
}
