import type { FastifyInstance } from 'fastify'
import { mossConfig } from '../services/mossLive.js'
import { one } from '../db/index.js'

/**
 * 判断该用哪个发音语言。
 *
 * MOSS 的 language 参数决定"怎么念"，不翻译文本。
 * 中文音色念英文也得切 English，否则会按中文音素硬读。
 */
function detectLanguage(text: string, override?: string): string {
  if (override) return override
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  return cjk >= latin * 0.25 ? 'Chinese' : 'English'
}

/* ── TTS：只走 MOSS。失败就是不出声，没有别的退路 ── */

export async function ttsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/tts/voices', async () => {
    const cfg = mossConfig()
    if (!cfg.apiKey) return { ok: false, error: '未配置 MOSS API Key', voices: [] }
    try {
      const res = await fetch('https://api.mosi.cn/v1/audio/voices', {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) {
        const t = await res.text()
        return { ok: false, error: `MOSS ${res.status}: ${t.slice(0, 160)}`, voices: [] }
      }
      const j = (await res.json()) as { data?: { id: string; name?: string }[] }
      const voices = (j.data ?? []).map((v) => ({ id: v.id, name: v.name || v.id.slice(0, 8) }))
      // 当前生效的音色可能不在这份列表里（比如账号外共享的音色），补进去，免得下拉框显示成空的
      if (cfg.voiceId && !voices.some((v) => v.id === cfg.voiceId)) {
        voices.unshift({ id: cfg.voiceId, name: '当前音色（列表外）' })
      }
      return { ok: true, voices, current: cfg.voiceId }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '取音色失败', voices: [] }
    }
  })

  app.post('/api/tts', async (req, reply) => {
    const b = (req.body ?? {}) as { text?: string; voiceId?: string; language?: string }
    const text = (b.text ?? '').trim()
    if (!text) {
      reply.code(400)
      return { ok: false, error: 'text required' }
    }
    const cfg = mossConfig()
    if (!cfg.apiKey) {
      reply.code(400)
      return { ok: false, error: '未配置 MOSS API Key' }
    }

    const language = detectLanguage(text, b.language)

    // 中文和英语可以各用各的音色：英文优先 voiceIdEn，没有就退回通用音色
    const voiceId =
      b.voiceId ||
      (language === 'English' ? cfg.voiceIdEn || cfg.voiceId : cfg.voiceId) ||
      one<{ value: string }>(`SELECT value FROM setting WHERE key = 'moss.voiceId'`)?.value?.trim() ||
      ''
    if (!voiceId) {
      reply.code(400)
      return { ok: false, error: '还没选音色（设置 → 语音 → MOSS 音色）' }
    }

    try {
      const res = await fetch('https://api.mosi.cn/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'moss-tts-1.5-flash',
          input: text.slice(0, 2000),
          voice_id: voiceId,
          language,
          response_format: 'mp3',
          delivery_method: 'url',
        }),
        signal: AbortSignal.timeout(90000),
      })
      const json = (await res.json()) as { url?: string; error?: { message?: string; code?: string } }
      if (!res.ok || !json.url) {
        const msg = json.error?.message ?? `MOSS ${res.status}`
        const code = json.error?.code ?? ''
        reply.code(res.status === 402 ? 402 : 400)
        return { ok: false, error: msg, code }
      }
      // 中转音频：浏览器直连 OSS 签名地址会报 no supported source，
      // 由后端下载再回灌，同源、无签名、无 CORS 问题
      const audioRes = await fetch(json.url, { signal: AbortSignal.timeout(30000) })
      if (!audioRes.ok) {
        reply.code(502)
        return { ok: false, error: `音频下载失败 ${audioRes.status}` }
      }
      const buf = Buffer.from(await audioRes.arrayBuffer())
      reply
        .header('Content-Type', 'audio/mpeg')
        .header('X-Tts-Provider', 'moss')
        .header('X-Tts-Language', language)
        .header('Content-Length', String(buf.length))
      return reply.send(buf)
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : 'TTS 失败' }
    }
  })
}
