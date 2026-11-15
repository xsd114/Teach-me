import type { FastifyInstance } from 'fastify'
import {
  createLesson,
  deleteLesson,
  getLesson,
  listLessons,
  updateLesson,
  type LessonState,
} from '../services/lesson.js'
import { getCourse } from '../services/course.js'

export async function lessonRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/courses/:id/lessons', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!getCourse(id)) {
      reply.code(404)
      return { ok: false, error: 'course not found' }
    }
    return { ok: true, lessons: listLessons(id) }
  })

  app.post('/api/courses/:id/lessons', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!getCourse(id)) {
      reply.code(404)
      return { ok: false, error: 'course not found' }
    }
    const b = (req.body ?? {}) as { title?: string; summary?: string; orderIndex?: number }
    if (!b.title?.trim()) {
      reply.code(400)
      return { ok: false, error: 'title is required' }
    }
    const lesson = createLesson(id, {
      title: b.title,
      summary: b.summary,
      orderIndex: b.orderIndex,
    })
    reply.code(201)
    return { ok: true, lesson }
  })

  app.patch('/api/lessons/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = (req.body ?? {}) as {
      title?: string
      summary?: string
      state?: LessonState
      mastery?: number
      orderIndex?: number
    }
    const lesson = updateLesson(id, b)
    if (!lesson) {
      reply.code(404)
      return { ok: false, error: 'lesson not found' }
    }
    return { ok: true, lesson }
  })

  app.delete('/api/lessons/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!deleteLesson(id)) {
      reply.code(404)
      return { ok: false, error: 'lesson not found' }
    }
    return { ok: true }
  })

  app.get('/api/lessons/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const lesson = getLesson(id)
    if (!lesson) {
      reply.code(404)
      return { ok: false, error: 'lesson not found' }
    }
    return { ok: true, lesson }
  })
}
