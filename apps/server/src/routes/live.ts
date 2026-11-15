import type { FastifyInstance } from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import { liveStatus, mossConfig, openLiveBridge, saveMossConfig, MOSS_BASE } from '../services/mossLive.js'
import { selfStudyAsk, paragraphOptions } from '../services/selfStudy.js'
import { testLlm } from '../services/llm.js'
import { run } from '../db/index.js'

/**
 * 自习模式 / 语音用的 MOSS 通道。
 *
 * 前端只连本机 ws://127.0.0.1:5274/ws/live，Key 永远留在服务端。
 */
export async function liveRoutes(app: FastifyInstance): Promise<void> {
  await app.register(fastifyWebsocket, {
    options: { maxPayload: 8 * 1024 * 1024 },
  })

  /* ── 配置 ── */

  app.get('/api/moss/status', async () => {
    const st = liveStatus()
    const cfg = mossConfig()
    return {
      ok: true,
      ...st,
      keyHint: cfg.apiKey ? `****${cfg.apiKey.slice(-4)}` : '',
      voiceId: cfg.voiceId,
      voiceIdEn: cfg.voiceIdEn,
      endpoint: `${MOSS_BASE.replace('https://', 'wss://')}/v1/realtime`,
      consoleUrl: 'https://platform.moss.cn',
    }
  })

  app.patch('/api/moss/config', async (req) => {
    const b = (req.body ?? {}) as { apiKey?: string; liveModel?: string; liveEnabled?: boolean; voiceId?: string; voiceIdEn?: string }
    saveMossConfig(b)
    return { ok: true, ...liveStatus() }
  })

  /** 用 MOSS 的 LLM（OpenAI 兼容）替换主模型，一键切换 */
  app.post('/api/moss/use-as-llm', async (req) => {
    const b = (req.body ?? {}) as { model?: string }
    const cfg = mossConfig()
    if (!cfg.apiKey) return { ok: false, error: '还没配置 MOSS API Key' }
    const set = (k: string, v: string) =>
      run(
        `INSERT INTO setting(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        k,
        v,
      )
    set('llm.provider', 'api')
    set('llm.baseUrl', MOSS_BASE)
    set('llm.model', b.model || 'nex-n2.6')
    set('llm.apiKey', cfg.apiKey)
    const t = await testLlm()
    return { ok: t.ok, model: t.model, ms: t.ms, reply: t.reply, error: t.error }
  })

  /* ── 实时语音通道 ── */

  app.get('/ws/live', { websocket: true }, (conn, req) => {
    // @fastify/websocket v11：第一个参数是 socket 本身
    const socket = conn as unknown as WebSocket & { socket?: WebSocket }
    const ws = (socket as unknown as { socket?: WebSocket }).socket ?? (conn as unknown as WebSocket)
    const q = (req.query ?? {}) as { instructions?: string; voice?: string }
    openLiveBridge(ws, {
      systemPrompt: q.instructions,
      voice: q.voice,
    })
  })
}

/// 自习模式问答（需要编号定位 + 追问澄清）
export async function selfStudyRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/selfstudy/ask', async (req, reply) => {
    const b = (req.body ?? {}) as { courseId?: string; question?: string; label?: string }
    if (!b.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    try {
      const r = await selfStudyAsk({
        courseId: b.courseId,
        question: b.question ?? '',
        label: b.label,
      })
      return { ok: true, ...r }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '失败' }
    }
  })

  app.get('/api/selfstudy/paragraphs', async (req, reply) => {
    const q = (req.query ?? {}) as { courseId?: string; chapterNo?: string }
    if (!q.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    const opts = paragraphOptions(
      q.courseId,
      q.chapterNo ? Number(q.chapterNo) : undefined,
      60,
    )
    return { ok: true, options: opts }
  })
}