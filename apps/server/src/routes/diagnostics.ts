/**
 * 日志与诊断接口（设置 → 关于 里那几个按钮）
 *
 *   GET  /api/diagnostics               面板用：结构化摘要 + 日志文件清单
 *   POST /api/diagnostics/bundle        生成一份 txt 落到 logs/，返回全文（前端顺手下载）
 *   GET  /api/diagnostics/files         日志文件清单
 *   GET  /api/diagnostics/files/:name   某个日志的尾巴（预览用）
 *   POST /api/diagnostics/clear         清空日志（当天 server 日志保留，正在写）
 *   POST /api/diagnostics/open-folder   在资源管理器里打开日志目录
 *   POST /api/diagnostics/client-error  前端报错回传（window.onerror / unhandledrejection）
 */
import type { FastifyInstance } from 'fastify'
import { spawn } from 'node:child_process'
import {
  appendLine,
  clearLogs,
  listLogs,
  LOGS_DIR_PATH,
  readTail,
} from '../lib/logfile.js'
import { buildBundle, collectDiagnostics } from '../services/diagnostics.js'

/** 前端报错不设上限会把磁盘刷爆：一个渲染循环就能写出几十万行 */
const clientErrorBudget = { windowStart: 0, count: 0, limit: 60 }

function takeClientBudget(): boolean {
  const now = Date.now()
  if (now - clientErrorBudget.windowStart > 60_000) {
    clientErrorBudget.windowStart = now
    clientErrorBudget.count = 0
  }
  clientErrorBudget.count += 1
  return clientErrorBudget.count <= clientErrorBudget.limit
}

function openInFileManager(dir: string): void {
  const cmd =
    process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  try {
    const child = spawn(cmd, [dir], { detached: true, stdio: 'ignore' })
    child.on('error', () => {
      /* 没装 xdg-open 之类就算了，前端会提示路径 */
    })
    child.unref()
  } catch {
    /* ignore */
  }
}

export async function diagnosticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/diagnostics', async () => {
    try {
      const info = await collectDiagnostics()
      return { ok: true, info, logsDir: LOGS_DIR_PATH, files: listLogs() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '收集失败' }
    }
  })

  app.post('/api/diagnostics/bundle', async (_req, reply) => {
    try {
      const r = await buildBundle()
      return { ok: true, ...r }
    } catch (e) {
      reply.code(500)
      return { ok: false, error: e instanceof Error ? e.message : '生成失败' }
    }
  })

  app.get('/api/diagnostics/files', async () => ({ ok: true, logsDir: LOGS_DIR_PATH, files: listLogs() }))

  app.get('/api/diagnostics/files/:name', async (req, reply) => {
    const { name } = req.params as { name: string }
    const q = (req.query ?? {}) as { lines?: string }
    // 只让读 logs 目录里的 .log/.txt，别让人用 ../ 读到别处
    if (name.includes('/') || name.includes('\\') || name.includes('..') || !/\.(log|txt)$/i.test(name)) {
      reply.code(400)
      return { ok: false, error: '文件名不合法' }
    }
    const lines = Math.min(2000, Math.max(20, Number(q.lines) || 300))
    return { ok: true, name, lines, body: readTail(name, lines) }
  })

  app.post('/api/diagnostics/clear', async () => {
    const r = clearLogs()
    appendLine('server', `[logs] 已清空 ${r.removed} 个日志文件，释放 ${(r.freedBytes / 1024).toFixed(0)} KB`, 'warn')
    return { ok: true, ...r }
  })

  app.post('/api/diagnostics/open-folder', async () => {
    openInFileManager(LOGS_DIR_PATH)
    return { ok: true, path: LOGS_DIR_PATH }
  })

  app.post('/api/diagnostics/client-error', async (req, reply) => {
    const b = (req.body ?? {}) as {
      message?: string
      stack?: string
      url?: string
      ua?: string
      at?: string
      kind?: string
    }
    if (!takeClientBudget()) {
      reply.code(429)
      return { ok: false, error: '报错太多，先歇一分钟' }
    }
    const kind = (b.kind ?? 'error').slice(0, 20)
    const lines = [
      `[${b.at ?? new Date().toISOString()}] ${kind}: ${String(b.message ?? '').slice(0, 1000)}`,
      b.url ? `  page: ${b.url.slice(0, 300)}` : '',
      b.ua ? `  ua:   ${b.ua.slice(0, 200)}` : '',
      b.stack ? `  stack:\n${String(b.stack).slice(0, 4000)}` : '',
    ].filter(Boolean)
    appendLine('client', lines.join('\n'), 'error')
    return { ok: true }
  })
}
