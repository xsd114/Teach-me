import type { FastifyInstance } from 'fastify'
import {
  clearPending,
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
  listPendingThreads,
  markThreadPending,
  memorySnippets,
  setAnnotationColor,
  type Annotation,
} from '../services/annotation.js'

export async function annotationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/annotations', async (req, reply) => {
    const q = (req.query ?? {}) as { courseId?: string; sourceId?: string }
    if (!q.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    return {
      ok: true,
      annotations: listAnnotations(q.courseId, q.sourceId || null),
      snippets: memorySnippets(q.courseId),
    }
  })

  app.post('/api/annotations', async (req, reply) => {
    const b = (req.body ?? {}) as {
      courseId?: string
      sourceKind?: Annotation['sourceKind']
      sourceId?: string | null
      text?: string
      note?: string
      color?: Annotation['color']
      startOffset?: number
      endOffset?: number
      inMemory?: boolean
    }
    if (!b.courseId || !b.text?.trim()) {
      reply.code(400)
      return { ok: false, error: 'courseId / text required' }
    }
    const ann = createAnnotation({
      courseId: b.courseId,
      sourceKind: b.sourceKind,
      sourceId: b.sourceId ?? null,
      text: b.text,
      note: b.note,
      color: b.color,
      startOffset: b.startOffset,
      endOffset: b.endOffset,
      inMemory: b.inMemory ?? true,
    })
    return { ok: true, annotation: ann }
  })

  app.patch('/api/annotations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = (req.body ?? {}) as { color?: string }
    if (!b.color) {
      reply.code(400)
      return { ok: false, error: 'color required' }
    }
    const ok = setAnnotationColor(id, b.color)
    if (!ok) {
      reply.code(404)
      return { ok: false, error: 'annotation not found' }
    }
    return { ok: true }
  })

  app.delete('/api/annotations/:id', async (req) => {
    const { id } = req.params as { id: string }
    return { ok: true, removed: deleteAnnotation(id) }
  })

  /* ── 划词对话 → 待处理 ── */

  app.post('/api/qa/threads/:id/pending', async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = (req.body ?? {}) as { courseId?: string; quote?: string; sourceRef?: string }
    if (!b.courseId || !b.quote) {
      reply.code(400)
      return { ok: false, error: 'courseId / quote required' }
    }
    const r = markThreadPending(id, {
      courseId: b.courseId,
      quote: b.quote,
      sourceRef: b.sourceRef ?? null,
    })
    if (!r.ok) {
      reply.code(404)
      return { ok: false, error: 'thread not found' }
    }
    return { ok: true, annotationId: r.annotationId }
  })

  app.get('/api/qa/pending', async (req, reply) => {
    const q = (req.query ?? {}) as { courseId?: string }
    if (!q.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    return { ok: true, threads: listPendingThreads(q.courseId) }
  })

  app.post('/api/qa/threads/:id/clear-pending', async (req) => {
    const { id } = req.params as { id: string }
    return { ok: true, cleared: clearPending(id) }
  })
}
