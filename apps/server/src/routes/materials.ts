import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { chat, extractJson } from '../services/llm.js'
import { CACHE_DIR, UPLOADS_DIR } from '../config.js'
import {
  deleteMaterial,
  excludeFromMemory,
  getMaterial,
  importFile,
  importText,
  listMaterials,
  memoryStats,
  queueStatus,
  reincludeInMemory,
  reindexAll,
  processMaterial,
} from '../services/material.js'
import { hybridSearch, memorySuggestion } from '../services/search.js'
import { probePython } from '../lib/python.js'
import { vectorStatus } from '../services/vectorStore.js'
import { warmupEmbedding, localModelId, embedProvider } from '../services/vector.js'
import { one, run, all } from '../db/index.js'
import { nowIso } from '../lib/id.js'

/** 抓网页 → 纯文本（处理 GBK/UTF-8 两种常见编码） */
async function fetchAsText(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 ALP/0.1',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())

  let charset = 'utf-8'
  const ct = res.headers.get('content-type') ?? ''
  const m1 = /charset=([\w-]+)/i.exec(ct)
  if (m1) charset = m1[1].toLowerCase()
  if (!m1) {
    const head = buf.subarray(0, 2048).toString('latin1')
    const m2 = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)
    if (m2) charset = m2[1].toLowerCase()
  }

  let html: string
  try {
    html = new TextDecoder(charset === 'gb2312' ? 'gbk' : charset).decode(buf)
  } catch {
    html = buf.toString('utf8')
  }

  const title =
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? new URL(url).hostname

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h([1-6])[^>]*>/gi, (_, lv: string) => `\n${'#'.repeat(Number(lv))} `)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { title, text }
}

export async function materialRoutes(app: FastifyInstance): Promise<void> {
  await app.register(import('@fastify/multipart'), {
    limits: { fileSize: 512 * 1024 * 1024, files: 20 },
  })

  /* ── 列表与统计 ── */

  app.get('/api/materials', async (req) => {
    const q = (req.query ?? {}) as { courseId?: string }
    return {
      ok: true,
      materials: listMaterials(q.courseId === 'null' ? null : q.courseId),
      queue: queueStatus(),
      vector: vectorStatus(),
    }
  })

  app.get('/api/memory/stats', async (req) => {
    const q = (req.query ?? {}) as { courseId?: string }
    return {
      ok: true,
      stats: memoryStats(q.courseId === 'null' ? null : q.courseId),
      vector: vectorStatus(),
      queue: queueStatus(),
      embed: { provider: embedProvider(), model: localModelId() },
    }
  })

  app.get('/api/memory/suggest', async (req) => {
    const q = (req.query ?? {}) as { courseId?: string }
    const cid = q.courseId && q.courseId !== 'null' ? q.courseId : null
    return { ok: true, ...memorySuggestion(cid) }
  })

  /* ── 导入 ── */

  app.post('/api/materials/import', async (req, reply) => {
    const b = (req.body ?? {}) as { filePath?: string; courseId?: string | null; name?: string }
    if (!b.filePath) {
      reply.code(400)
      return { ok: false, error: 'filePath is required' }
    }
    try {
      const m = importFile({
        filePath: b.filePath,
        courseId: b.courseId ?? null,
        name: b.name,
      })
      reply.code(201)
      return { ok: true, material: m }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '导入失败' }
    }
  })

  /** 浏览器上传（拖拽/选择文件） */
  app.post('/api/materials/upload', async (req, reply) => {
    const parts = req.parts()
    const created: unknown[] = []
    let courseId: string | null = null
    /** 先把文件落到临时区，等所有字段都收完再统一入库 */
    const pending: { tmp: string; filename: string }[] = []
    const dir = path.join(UPLOADS_DIR, '_incoming')

    try {
      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'courseId') {
          courseId = String(part.value) === 'null' ? null : String(part.value)
          continue
        }
        if (part.type !== 'file') continue

        fs.mkdirSync(dir, { recursive: true })
        const safe = part.filename.replace(/[\\/:*?"<>|]/g, '_')
        const tmp = path.join(dir, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`)

        // 必须等写流 finish，不能等读流 end ——
        // 读流 end 时数据还在缓冲区，紧接着读会 "文件不存在"
        await new Promise<void>((resolve, reject) => {
          const ws = fs.createWriteStream(tmp)
          ws.on('finish', () => resolve())
          ws.on('error', reject)
          part.file.on('error', reject)
          part.file.pipe(ws)
        })
        pending.push({ tmp, filename: part.filename })
      }

      // 字段全收完了，这时 courseId 一定是对的
      for (const f of pending) {
        try {
          const m = importFile({ filePath: f.tmp, courseId, name: f.filename })
          created.push(m)
        } finally {
          fs.rmSync(f.tmp, { force: true })
        }
      }
    } catch (e) {
      for (const f of pending) fs.rmSync(f.tmp, { force: true })
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '上传失败' }
    }

    if (created.length === 0) {
      reply.code(400)
      return { ok: false, error: '没有收到文件' }
    }
    reply.code(201)
    return { ok: true, materials: created }
  })

  /** 直接投喂文本（网页抓取、AI 生成的内容都走这里） */
  app.post('/api/materials/text', async (req, reply) => {
    const b = (req.body ?? {}) as {
      name?: string
      text?: string
      courseId?: string | null
      sourceUrl?: string
      origin?: 'local' | 'web' | 'generated'
    }
    if (!b.text?.trim()) {
      reply.code(400)
      return { ok: false, error: 'text is required' }
    }
    const m = importText({
      name: b.name?.trim() || '未命名资料',
      text: b.text,
      courseId: b.courseId ?? null,
      sourceUrl: b.sourceUrl,
      origin: b.origin ?? (b.sourceUrl ? 'web' : 'generated'),
    })
    reply.code(201)
    return { ok: true, material: m }
  })

  /** 抓网页入库 */

  /** 上传后先看一眼这资料是讲什么的，让用户确认，别糊里糊涂建课 */
  /** 建课时把事先传的资料绑到这门课名下 */
  app.post('/api/materials/:id/bind', async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = (req.body ?? {}) as { courseId?: string }
    if (!b.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }
    run(`UPDATE material SET course_id = ?, updated_at = ? WHERE id = ?`, b.courseId, nowIso(), id)
    run(`UPDATE chunk SET course_id = ? WHERE material_id = ?`, b.courseId, id)
    return { ok: true }
  })


  /** 把用户标出来的重点交给 AI 归纳成一条"我关注什么"，写进记忆库 */
  app.post('/api/memory/from-marks', async (req, reply) => {
    const b = (req.body ?? {}) as { courseId?: string; color?: string }
    if (!b.courseId) {
      reply.code(400)
      return { ok: false, error: 'courseId required' }
    }

    const rows = all<{ id: string; text: string; note: string; color: string }>(
      b.color
        ? `SELECT id, text, note, color FROM annotation WHERE course_id = ? AND color = ? AND digested_at IS NULL ORDER BY created_at DESC LIMIT 60`
        : `SELECT id, text, note, color FROM annotation WHERE course_id = ? AND digested_at IS NULL ORDER BY created_at DESC LIMIT 60`,
      ...(b.color ? [b.courseId, b.color] : [b.courseId]),
    )

    if (rows.length === 0) return { ok: true, added: 0 }

    const list = rows.map((r, i) => `${i + 1}. ${r.text}${r.note ? `（备注：${r.note}）` : ''}`).join('\n')

    let digest = ''
    try {
      const r = await chat(
        [
          { role: 'system', content: '你在帮学生整理他划出来的重点。说人话，别客套。' },
          {
            role: 'user',
            content: `下面是这个学生自己划出来的 ${rows.length} 段重点：

${list.slice(0, 5000)}

请归纳成一段话，写清楚：
1. 这些重点共同指向什么主题
2. 他反复标记的是哪一类东西（定义？步骤？易错点？）
3. 以后讲课时应该侧重什么

一段话，不超过 200 字，不要分点。`,
          },
        ],
        { temperature: 0.4, maxTokens: 800, timeoutMs: 90_000 },
      )
      digest = r.text.trim()
    } catch {
      digest = `这个学生划了 ${rows.length} 段重点，内容涉及：${rows.slice(0, 5).map((r) => r.text.slice(0, 16)).join('、')}。`
    }

    const body = `# 我的重点标记（${rows.length} 条）\n\n${digest}\n\n---\n\n## 原文\n\n${list}`

    const m = importText({
      name: `重点标记 · ${new Date().toISOString().slice(0, 10)}`,
      text: body,
      courseId: b.courseId,
      origin: 'generated',
    })

    run(
      `UPDATE annotation SET digested_at = ? WHERE id IN (${rows.map(() => '?').join(',')})`,
      new Date().toISOString(),
      ...rows.map((r) => r.id),
    )

    return { ok: true, added: rows.length, materialId: m.id, digest }
  })

  app.post('/api/materials/analyze', async (req, reply) => {
    const b = (req.body ?? {}) as { materialId?: string }
    if (!b.materialId) {
      reply.code(400)
      return { ok: false, error: 'materialId required' }
    }

    const m = one<{ id: string; name: string; char_count: number }>(
      `SELECT id, name, char_count FROM material WHERE id = ?`,
      b.materialId,
    )
    if (!m) {
      reply.code(404)
      return { ok: false, error: '资料不存在' }
    }

    const chunks = all<{ text: string }>(
      `SELECT text FROM chunk WHERE material_id = ? ORDER BY order_index LIMIT 12`,
      b.materialId,
    )
    const body = chunks.map((c) => c.text).join('\n\n').slice(0, 6000)
    if (!body.trim()) {
      return { ok: true, topic: m.name, summary: '这份资料还没解析出内容。', points: [], empty: true }
    }

    try {
      const r = await chat(
        [
          {
            role: 'system',
            content: `你帮用户确认"这份资料到底是讲什么的"。说人话，不要客套。只输出 JSON。`,
          },
          {
            role: 'user',
            content: `资料名：${m.name}
以下是它开头的内容：

${body}

请判断：
1. topic：它属于什么领域/学科（10 字内）
2. summary：两三句话说清它讲了什么、能用来学什么（80 字内）
3. points：3–5 个它覆盖的关键内容（每条 12 字内）
4. suitable：适合拿来做什么（比如"入门课的材料"、"习题集"、"参考手册"，10 字内）

只输出：{"topic":"","summary":"","points":["",""],"suitable":""}`,
          },
        ],
        { json: true, temperature: 0.3, maxTokens: 700 },
      )
      const parsed = extractJson<{ topic: string; summary: string; points: string[]; suitable: string }>(r.text)
      return {
        ok: true,
        materialId: m.id,
        name: m.name,
        chars: m.char_count,
        topic: parsed?.topic ?? '',
        summary: parsed?.summary ?? '',
        points: Array.isArray(parsed?.points) ? parsed!.points.slice(0, 6) : [],
        suitable: parsed?.suitable ?? '',
      }
    } catch (e) {
      return {
        ok: true,
        materialId: m.id,
        name: m.name,
        chars: m.char_count,
        topic: '',
        summary: '看不出来（模型调用失败）。可以继续建课，进去再慢慢看。',
        points: [],
        suitable: '',
        error: e instanceof Error ? e.message : '',
      }
    }
  })

  app.post('/api/materials/fetch-url', async (req, reply) => {
    const b = (req.body ?? {}) as { url?: string; courseId?: string | null; name?: string }
    if (!b.url?.startsWith('http')) {
      reply.code(400)
      return { ok: false, error: 'url 必须以 http(s) 开头' }
    }
    try {
      const { title, text } = await fetchAsText(b.url)
      if (text.length < 80) {
        reply.code(400)
        return { ok: false, error: '抓到的正文太短，可能被反爬或页面是纯脚本渲染' }
      }
      const m = importText({
        name: b.name?.trim() || title,
        text: `# ${title}\n\n来源：${b.url}\n\n${text}`,
        courseId: b.courseId ?? null,
        sourceUrl: b.url,
        origin: 'web',
      })
      reply.code(201)
      return { ok: true, material: m, chars: text.length, title }
    } catch (e) {
      reply.code(400)
      return { ok: false, error: e instanceof Error ? e.message : '抓取失败' }
    }
  })

  /* ── 单条操作 ── */

  app.get('/api/materials/:id/chunks', async (req, reply) => {
    const { id } = req.params as { id: string }
    const m = getMaterial(id)
    if (!m) {
      reply.code(404)
      return { ok: false, error: 'material not found' }
    }
    const rows = one<{ c: number }>(`SELECT COUNT(*) AS c FROM chunk WHERE material_id = ?`, id)
    const preview = all<{ id: number; heading_path: string; text: string; char_count: number }>(
      `SELECT id, heading_path, text, char_count FROM chunk WHERE material_id = ? ORDER BY order_index LIMIT 50`,
      id,
    )
    return { ok: true, total: Number(rows?.c ?? 0), chunks: preview }
  })

  app.post('/api/materials/:id/exclude', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!excludeFromMemory(id)) {
      reply.code(404)
      return { ok: false, error: 'material not found' }
    }
    return { ok: true, material: getMaterial(id) }
  })

  app.post('/api/materials/:id/reinclude', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!reincludeInMemory(id)) {
      reply.code(404)
      return { ok: false, error: 'material not found' }
    }
    return { ok: true, material: getMaterial(id) }
  })

  app.post('/api/materials/:id/reprocess', async (req, reply) => {
    const { id } = req.params as { id: string }
    const m = getMaterial(id)
    if (!m) {
      reply.code(404)
      return { ok: false, error: 'material not found' }
    }
    run(
      `UPDATE material SET status = 'pending', stage = 'queued', progress = 0, error = NULL, updated_at = ? WHERE id = ?`,
      nowIso(),
      id,
    )
    await processMaterial(id)
    return { ok: true, material: getMaterial(id) }
  })

  app.delete('/api/materials/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!deleteMaterial(id)) {
      reply.code(404)
      return { ok: false, error: 'material not found' }
    }
    return { ok: true }
  })

  /* ── 全库操作 ── */

  app.post('/api/memory/reindex', async (req) => {
    const b = (req.body ?? {}) as { courseId?: string | null }
    const n = reindexAll(b.courseId ?? null)
    return { ok: true, queued: n }
  })

  app.post('/api/memory/warmup', async () => {
    const r = await warmupEmbedding()
    return r
  })

  app.get('/api/parse/probe', async () => {
    const p = await probePython()
    return { ok: true, ...p, cacheDir: CACHE_DIR }
  })

  /* ── 检索 ── */

  app.post('/api/search', async (req, reply) => {
    const b = (req.body ?? {}) as {
      q?: string
      courseId?: string | null
      topK?: number
      keywordOnly?: boolean
    }
    if (!b.q?.trim()) {
      reply.code(400)
      return { ok: false, error: 'q is required' }
    }
    const r = await hybridSearch(b.q, {
      courseId: b.courseId ?? null,
      topK: Number(b.topK ?? 8),
      keywordOnly: Boolean(b.keywordOnly),
    })
    return { ok: true, ...r }
  })
}

export function materialDebugPaths(): { uploads: string; cache: string } {
  return { uploads: UPLOADS_DIR, cache: CACHE_DIR }
}

void processMaterial
