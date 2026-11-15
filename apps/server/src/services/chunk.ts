export type Chunk = {
  orderIndex: number
  text: string
  headingPath: string
  charCount: number
  tokenEst: number
}

export type ChunkOptions = {
  /** 单片目标字数 */
  maxChars?: number
  /** 滑窗重叠字数 */
  overlap?: number
  /** 小于这个长度的碎片并入上一片 */
  minChars?: number
}

const DEFAULT: Required<ChunkOptions> = {
  maxChars: 512,
  overlap: 80,
  minChars: 60,
}

/** 粗估 token：中日韩按 0.8/字，其余按 1/4 字符 */
export function estimateTokens(s: string): number {
  let cjk = 0
  let other = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0x3040 && c <= 0x30ff) ||
      (c >= 0xac00 && c <= 0xd7af)
    ) {
      cjk++
    } else {
      other++
    }
  }
  return Math.max(1, Math.ceil(cjk * 0.8 + other / 4))
}

type Section = { headingPath: string; body: string }

function splitSections(md: string): Section[] {
  const lines = md.split(/\r?\n/)
  const sections: Section[] = []
  const stack: { level: number; title: string }[] = []
  let buf: string[] = []

  const flush = () => {
    const body = buf.join('\n').trim()
    if (body) {
      sections.push({ headingPath: stack.map((s) => s.title).join(' > '), body })
    }
    buf = []
  }

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line)
    if (m) {
      flush()
      const level = m[1].length
      const title = m[2].trim()
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
      stack.push({ level, title })
      continue
    }
    buf.push(line)
  }
  flush()

  // 没有标题的纯文本：按空行分段
  if (sections.length === 0) {
    const paras = md.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    return paras.length > 0 ? paras.map((p) => ({ headingPath: '', body: p })) : []
  }
  return sections
}

/** 超长段滑窗切分，尽量在句号/换行处断开 */
function slideSplit(text: string, maxChars: number, overlap: number): string[] {
  if (text.length <= maxChars) return [text]
  const out: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length)
    if (end < text.length) {
      // 往回找最近的句子边界（最多退 120 字）
      const window = text.slice(start, end)
      const cut = Math.max(
        window.lastIndexOf('。'),
        window.lastIndexOf('\n'),
        window.lastIndexOf('；'),
        window.lastIndexOf('. '),
      )
      if (cut > maxChars * 0.5) end = start + cut + 1
    }
    const piece = text.slice(start, end).trim()
    if (piece) out.push(piece)
    if (end >= text.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return out
}

/** 清掉 markitdown 表格里的分隔行与空单元格，它们对检索是纯噪声 */
function cleanMarkdownTables(s: string): string {
  const lines = s.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  for (const line of lines) {
    // 纯分隔行：| --- | --- |
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue
    if (line.trim().startsWith('|')) {
      // 表格行：拆单元格、去掉空的，再拼回去（原来一屏里全是 |  |  |）
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)
      if (cells.length === 0) continue
      out.push(`| ${cells.join(' | ')} |`)
      continue
    }
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

/**
 * 把一篇文档切成检索用的片段。
 *
 * 策略：先按 Markdown 标题分层，再对超长段落做滑窗；
 * 每片都带 headingPath，检索命中后能告诉用户"在《XX》第几章"。
 */
export function chunkText(md: string, options: ChunkOptions = {}): Chunk[] {
  const { maxChars, overlap, minChars } = { ...DEFAULT, ...options }
  const normalized = cleanMarkdownTables(md.replace(/\r\n/g, '\n').trim())
  if (!normalized) return []

  const sections = splitSections(normalized)
  const chunks: Chunk[] = []
  let order = 0

  for (const sec of sections) {
    const pieces = slideSplit(sec.body, maxChars, overlap)
    for (let i = 0; i < pieces.length; i++) {
      const text = pieces[i]
      // 太短且不是本段第一片 → 并入上一片
      if (text.length < minChars && chunks.length > 0 && chunks[chunks.length - 1].headingPath === sec.headingPath) {
        const prev = chunks[chunks.length - 1]
        prev.text = `${prev.text}\n${text}`
        prev.charCount = prev.text.length
        prev.tokenEst = estimateTokens(prev.text)
        continue
      }
      const prefix = sec.headingPath && pieces.length > 1 ? `【${sec.headingPath}】` : ''
      const finalText = prefix ? `${prefix}\n${text}` : text
      chunks.push({
        orderIndex: order++,
        text: finalText,
        headingPath: sec.headingPath,
        charCount: finalText.length,
        tokenEst: estimateTokens(finalText),
      })
    }
  }

  return chunks
}

/** 统计一份文档的基本信息，用于阈值判断 */
export function docStats(text: string): { chars: number; lines: number; tokens: number } {
  return {
    chars: text.length,
    lines: text.split('\n').length,
    tokens: estimateTokens(text),
  }
}
