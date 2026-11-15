import type { FastifyInstance } from 'fastify'
import {
  createCourse,
  deleteCourse,
  courseMemoryStat,
  getCourse,
  listCourses,
  reorderCourses,
  updateCourse,
  type CourseKind,
  type CourseStatus,
  type MemoryMode,
} from '../services/course.js'

type CreateBody = {
  title?: string
  kind?: string
  goal?: string
  baseline?: string
  cover?: string
  perDayMinutes?: number
  perDayItems?: number
  deadline?: string | null
  memoryMode?: string
  verbosity?: number
  options?: { mode?: string; searchMore?: boolean; withKeywords?: boolean }
}

const KINDS: CourseKind[] = ['skill', 'academic']
const MODES: MemoryMode[] = ['auto', 'on', 'off']

function normalizeMode(v: unknown): MemoryMode {
  return MODES.includes(v as MemoryMode) ? (v as MemoryMode) : 'auto'
}

export async function courseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/courses', async (req) => {
    const q = (req.query ?? {}) as { status?: string }
    const status: CourseStatus | 'all' =
      q.status === 'all' || q.status === 'archived' ? (q.status as CourseStatus | 'all') : 'active'
    return { ok: true, courses: listCourses(status) }
  })

  app.get('/api/courses/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const course = getCourse(id)
    if (!course) {
      reply.code(404)
      return { ok: false, error: 'course not found' }
    }
    return { ok: true, course }
  })

  app.post('/api/courses', async (req, reply) => {
    const b = (req.body ?? {}) as CreateBody
    const title = (b.title ?? '').trim()
    if (!title) {
      reply.code(400)
      return { ok: false, error: 'title is required' }
    }
    if (title.length > 80) {
      reply.code(400)
      return { ok: false, error: 'title too long (max 80)' }
    }
    const kind: CourseKind = KINDS.includes(b.kind as CourseKind)
      ? (b.kind as CourseKind)
      : 'skill'

    const course = createCourse({
      title,
      kind,
      goal: b.goal ?? '',
      baseline: b.baseline ?? '',
      cover: b.cover ?? '',
      perDayMinutes: Number(b.perDayMinutes ?? 30),
      perDayItems: Number(b.perDayItems ?? 0),
      deadline: b.deadline ?? null,
      memoryMode: normalizeMode(b.memoryMode),
      verbosity: Number(b.verbosity ?? 3),
      options: b.options ? { mode: b.options.mode === 'book' ? 'book' : 'course', searchMore: Boolean(b.options.searchMore), withKeywords: Boolean(b.options.withKeywords) } : undefined,
    })
    reply.code(201)
    return { ok: true, course }
  })

  app.patch('/api/courses/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = (req.body ?? {}) as CreateBody & { status?: string; sortIndex?: number }
    const patch: Record<string, unknown> = {}

    if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim().slice(0, 80)
    if (b.kind && KINDS.includes(b.kind as CourseKind)) patch.kind = b.kind
    if (typeof b.goal === 'string') patch.goal = b.goal
    if (typeof b.baseline === 'string') patch.baseline = b.baseline
    if (typeof b.cover === 'string') patch.cover = b.cover
    if (b.perDayMinutes !== undefined) patch.perDayMinutes = Number(b.perDayMinutes)
    if (b.perDayItems !== undefined) patch.perDayItems = Number(b.perDayItems)
    if (b.deadline !== undefined) patch.deadline = b.deadline
    if (b.memoryMode) patch.memoryMode = normalizeMode(b.memoryMode)
    if (b.verbosity !== undefined) patch.verbosity = Number(b.verbosity)
    if (b.status === 'active' || b.status === 'archived') patch.status = b.status
    if (b.sortIndex !== undefined) patch.sortIndex = Number(b.sortIndex)

    const course = updateCourse(id, patch)
    if (!course) {
      reply.code(404)
      return { ok: false, error: 'course not found' }
    }
    return { ok: true, course }
  })

  app.get('/api/courses/:id/memory', async (req) => {
    const { id } = req.params as { id: string }
    return { ok: true, ...courseMemoryStat(id) }
  })

  app.delete('/api/courses/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const q = (req.query ?? {}) as { purgeMemory?: string }
    const ok = deleteCourse(id, q.purgeMemory !== '0')
    if (!ok) {
      reply.code(404)
      return { ok: false, error: 'course not found' }
    }
    return { ok: true }
  })

  app.post('/api/courses/reorder', async (req, reply) => {
    const b = (req.body ?? {}) as { ids?: unknown }
    if (!Array.isArray(b.ids) || b.ids.some((x) => typeof x !== 'string')) {
      reply.code(400)
      return { ok: false, error: 'ids: string[] required' }
    }
    reorderCourses(b.ids as string[])
    return { ok: true, courses: listCourses('active') }
  })
}
