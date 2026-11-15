import type { FastifyInstance } from 'fastify'
import { listPrompts, promptStats, resetAllPrompts, resetPrompt, savePromptOverride } from '../prompts/index.js'

/**
 * 提示词管理。
 *
 * 目的：这个软件"怎么写教材、怎么出题、怎么答疑"是它的核心内容。
 * 一条都不藏在代码注释里 —— 全都在这里能看见、能改、能恢复默认。
 */
export async function promptRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/prompts', async () => {
    return { ok: true, prompts: listPrompts(), stats: promptStats() }
  })

  app.patch('/api/prompts/:key', async (req, reply) => {
    const { key } = req.params as { key: string }
    const b = (req.body ?? {}) as { system?: string; body?: string }
    const ok = savePromptOverride(key, b)
    if (!ok) {
      reply.code(404)
      return { ok: false, error: '没有这条提示词' }
    }
    return { ok: true, prompts: listPrompts() }
  })

  const doReset = async (req: { params: unknown }, reply: { code: (n: number) => void }) => {
    const { key } = req.params as { key: string }
    const ok = resetPrompt(key)
    if (!ok) {
      reply.code(404)
      return { ok: false, error: '没有这条提示词' }
    }
    return { ok: true, prompts: listPrompts() }
  }

  app.post('/api/prompts/:key/reset', doReset)
  app.delete('/api/prompts/:key/reset', doReset)

  app.post('/api/prompts/reset-all', async () => {
    const n = resetAllPrompts()
    return { ok: true, cleared: n, prompts: listPrompts() }
  })
}
