import WebSocket from 'ws'
import { one, run } from '../db/index.js'
import { nowIso } from '../lib/id.js'

/**
 * MOSS-Live 实时语音代理。
 *
 * 为什么必须由服务端转发：API Key 只能放在 WebSocket 握手请求头里，
 * 浏览器没法给 WebSocket 加自定义头（且绝不能把 key 发到前端）。
 *
 * 协议（官方文档）：
 *   wss://api.mosi.cn/v1/realtime?model=moss-live-1.0
 *   → 发 {"action":"attach_session","session_id":null}
 *   → 收 {"action":"session_attached","data":{session_id}}
 *   → 发 {"action":"mic_state","enabled":true}
 *   → 发二进制 16k 单声道 PCM S16LE
 *   ← 收 48k 单声道 PCM S16LE + transcript 事件
 */

export const MOSS_BASE = 'https://api.mosi.cn'
export const MOSS_LIVE_MODEL = 'moss-live-1.0'

export function mossConfig(): { apiKey: string; model: string; enabled: boolean; voiceId: string; voiceIdEn: string } {
  const k = one<{ value: string }>(`SELECT value FROM setting WHERE key = 'moss.apiKey'`)
  const m = one<{ value: string }>(`SELECT value FROM setting WHERE key = 'moss.liveModel'`)
  const e = one<{ value: string }>(`SELECT value FROM setting WHERE key = 'moss.liveEnabled'`)
  const v = one<{ value: string }>(`SELECT value FROM setting WHERE key = 'moss.voiceId'`)
  const ve = one<{ value: string }>(`SELECT value FROM setting WHERE key = 'moss.voiceIdEn'`)
  const apiKey =
    k?.value?.trim() ||
    process.env.MOSS_API_KEY ||
    ''
  return {
    apiKey,
    model: m?.value?.trim() || MOSS_LIVE_MODEL,
    enabled: (e?.value ?? '0') === '1',
    voiceId: v?.value?.trim() || '',
    voiceIdEn: ve?.value?.trim() || '',
  }
}

export function saveMossConfig(patch: { apiKey?: string; liveModel?: string; liveEnabled?: boolean; voiceId?: string; voiceIdEn?: string }): void {
  const set = (k: string, v: string) =>
    run(
      `INSERT INTO setting(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      k,
      v,
    )
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) set('moss.apiKey', patch.apiKey.trim())
  if (typeof patch.liveModel === 'string' && patch.liveModel.trim()) set('moss.liveModel', patch.liveModel.trim())
  if (typeof patch.liveEnabled === 'boolean') set('moss.liveEnabled', patch.liveEnabled ? '1' : '0')
  if (typeof patch.voiceId === 'string' && patch.voiceId.trim()) set('moss.voiceId', patch.voiceId.trim())
  if (typeof patch.voiceIdEn === 'string' && patch.voiceIdEn.trim()) set('moss.voiceIdEn', patch.voiceIdEn.trim())
}

export type LiveStatus = {
  configured: boolean
  enabled: boolean
  model: string
  /** 最近一次连接的错误，前端可以直接显示 */
  lastError: string
  lastConnectedAt: string | null
}

let lastError = ''
let lastConnectedAt: string | null = null

export function liveStatus(): LiveStatus {
  const c = mossConfig()
  return {
    configured: c.apiKey.length > 0,
    enabled: c.enabled,
    model: c.model,
    lastError,
    lastConnectedAt,
  }
}

/**
 * 建立到 MOSS 的连接，并把事件按原样转给前端。
 * 返回的 cleanup 用来断开两端。
 */
export function openLiveBridge(
  client: WebSocket,
  opts: { systemPrompt?: string; voice?: string } = {},
): { close: () => void } {
  const cfg = mossConfig()
  if (!cfg.apiKey) {
    client.send(JSON.stringify({ action: 'bridge.error', data: { message: '还没配置 MOSS API Key' } }))
    client.close()
    return { close: () => {} }
  }

  const url = `wss://api.mosi.cn/v1/realtime?model=${encodeURIComponent(cfg.model)}`
  const upstream = new WebSocket(url, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  })

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    try {
      if (client.readyState === WebSocket.OPEN) client.close()
    } catch {
      /* ignore */
    }
    try {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close()
    } catch {
      /* ignore */
    }
  }

  upstream.on('open', () => {
    lastConnectedAt = nowIso()
    lastError = ''
    client.send(JSON.stringify({ action: 'bridge.connected', data: { model: cfg.model } }))
    upstream.send(JSON.stringify({ action: 'attach_session', session_id: null }))
  })

  upstream.on('message', (raw, isBinary) => {
    if (client.readyState !== WebSocket.OPEN) return
    if (isBinary) {
      client.send(raw, { binary: true })
      return
    }
    const text = raw.toString()
    // 拿到 session_id 后按需下发人设与音色
    try {
      const obj = JSON.parse(text) as { action?: string; data?: { session_id?: string } }
      if (obj.action === 'session_attached' && obj.data?.session_id) {
        client.send(JSON.stringify({ action: 'bridge.session', data: { session_id: obj.data.session_id } }))
        if (opts.systemPrompt || opts.voice) {
          upstream.send(
            JSON.stringify({
              action: 'session.update',
              session: {
                ...(opts.systemPrompt ? { instructions: opts.systemPrompt.slice(0, 4000) } : {}),
                ...(opts.voice ? { voice: opts.voice } : {}),
              },
            }),
          )
        }
      }
    } catch {
      /* 非 JSON 就原样转 */
    }
    client.send(text)
  })

  upstream.on('error', (err) => {
    lastError = err instanceof Error ? err.message : String(err)
    try {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ action: 'bridge.error', data: { message: lastError } }))
      }
    } catch {
      /* ignore */
    }
    close()
  })

  upstream.on('close', (code, reason) => {
    const msg = `上游断开 code=${code} ${reason.toString()}`.trim()
    if (code !== 1000) lastError = msg
    try {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ action: 'bridge.closed', data: { code, reason: reason.toString() } }))
        client.close()
      }
    } catch {
      /* ignore */
    }
    closed = true
  })

  // 前端 → 上游
  client.on('message', (raw, isBinary) => {
    if (upstream.readyState !== WebSocket.OPEN) return
    if (isBinary) {
      upstream.send(raw, { binary: true })
      return
    }
    const text = raw.toString()
    // 让前端能改人设（自习模式会用到）
    try {
      const obj = JSON.parse(text) as { action?: string; systemPrompt?: string }
      if (obj.action === 'client.set_instructions' && obj.systemPrompt) {
        upstream.send(
          JSON.stringify({
            action: 'session.update',
            session: { instructions: obj.systemPrompt.slice(0, 4000) },
          }),
        )
        return
      }
    } catch {
      /* ignore */
    }
    upstream.send(text)
  })

  client.on('close', close)
  client.on('error', close)

  return { close }
}
