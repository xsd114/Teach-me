import fs from 'node:fs'
import path from 'node:path'
import { runPython } from '../lib/python.js'

export type ParseResult = {
  ok: boolean
  text: string
  parser: string
  degraded: boolean
  ms: number
  error?: string
}

const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.csv', '.json', '.log', '.html', '.htm', '.tex'])
const MARKITDOWN_EXT = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.xls', '.epub', '.msg', '.ipynb'])

export function extOf(filePath: string): string {
  return path.extname(filePath).toLowerCase()
}

/** 纯 JS 兜底的清洗：把 html 剥成文本 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 极简 PDF 文本抽取兜底：抓未压缩的文本流里的 Tj/TJ 片段（覆盖不了复杂排版，但聊胜于无） */
function roughPdfText(buf: Buffer): string {
  const latin = buf.toString('latin1')
  const chunks: string[] = []
  const re = /\((?:\\.|[^\\)])*\)\s*Tj|\[(?:[^\]]*)\]\s*TJ/g
  const matches = latin.match(re) ?? []
  for (const m of matches) {
    const parts = m.match(/\((?:\\.|[^\\)])*\)/g) ?? []
    for (const p of parts) {
      chunks.push(
        p
          .slice(1, -1)
          .replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '' })[c as string] ?? c),
      )
    }
  }
  return chunks.join(' ').replace(/\s{2,}/g, ' ').trim()
}

/**
 * 解析一个文件为纯文本 / Markdown。
 *
 * 顺序：纯文本格式直接读 → markitdown（Python，主力）→ 纯 JS 兜底（标记 degraded=1）
 * 结果会缓存到 cache 目录，避免重复解析。
 */
export async function parseFile(filePath: string): Promise<ParseResult> {
  const t0 = Date.now()
  const ext = extOf(filePath)

  // 1. 纯文本直接读
  if (TEXT_EXT.has(ext)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const text = ext === '.html' || ext === '.htm' ? stripHtml(raw) : raw
      return { ok: true, text, parser: 'plain', degraded: false, ms: Date.now() - t0 }
    } catch (e) {
      return {
        ok: false,
        text: '',
        parser: 'plain',
        degraded: false,
        ms: Date.now() - t0,
        error: e instanceof Error ? e.message : 'read failed',
      }
    }
  }

  // 2. markitdown（主力）
  if (MARKITDOWN_EXT.has(ext)) {
    const r = await runPython(['-m', 'markitdown', filePath], { timeoutMs: 300_000 })
    const text = r.stdout.trim()
    if (r.ok && text.length > 0) {
      return { ok: true, text, parser: 'markitdown', degraded: false, ms: Date.now() - t0 }
    }

    // 3. 纯 JS 兜底
    const fallback = await jsFallback(filePath, ext)
    if (fallback.ok) {
      return {
        ok: true,
        text: fallback.text,
        parser: `js-${ext.slice(1)}`,
        degraded: true,
        ms: Date.now() - t0,
        error: r.ok ? 'markitdown 输出为空' : r.stderr.slice(0, 200),
      }
    }
    return {
      ok: false,
      text: '',
      parser: 'none',
      degraded: true,
      ms: Date.now() - t0,
      error: (r.ok ? '解析结果为空，' : r.stderr.slice(0, 300)) + `；兜底也失败：${fallback.error ?? ''}`,
    }
  }

  // 4. 未知扩展名，尝试当文本读
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    if (raw.length > 0) {
      return { ok: true, text: raw, parser: 'guess-text', degraded: true, ms: Date.now() - t0 }
    }
  } catch {
    /* ignore */
  }

  return {
    ok: false,
    text: '',
    parser: 'none',
    degraded: false,
    ms: Date.now() - t0,
    error: `不支持的类型：${ext || '(无扩展名)'}`,
  }
}

async function jsFallback(
  filePath: string,
  ext: string,
): Promise<{ ok: boolean; text: string; error?: string }> {
  try {
    if (ext === '.pdf') {
      const buf = fs.readFileSync(filePath)
      const t = roughPdfText(buf)
      return { ok: t.length > 40, text: t, error: t.length > 40 ? undefined : 'PDF 可能是扫描件或加密' }
    }
    if (ext === '.docx' || ext === '.pptx' || ext === '.xlsx') {
      // 这三种本质是 zip+xml，粗略抽取 <w:t>/<a:t> 文本
      const { execFileSync } = await import('node:child_process')
      void execFileSync
      const buf = fs.readFileSync(filePath)
      const latin = buf.toString('latin1')
      const pieces = (latin.match(/<[awt]:t[^>]*>([\s\S]*?)<\/[awt]:t>/g) ?? [])
        .map((s) => s.replace(/<[^>]+>/g, ''))
        .join(' ')
      const text = pieces.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
      return { ok: text.length > 20, text, error: text.length > 20 ? undefined : '压缩流无法直接抽取' }
    }
  } catch (e) {
    return { ok: false, text: '', error: e instanceof Error ? e.message : 'fallback failed' }
  }
  return { ok: false, text: '', error: '无可用兜底' }
}
