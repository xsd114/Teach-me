/**
 * 文本定位锚（Text Anchor）
 * =========================
 *
 * 问题：用户引用一句话来问 AI，可"这句话"离开屏幕就没了坐标。
 * 模型只看到一段孤立的文字，不知道它在第几章、哪一段、前后在讲什么，
 * 于是只能泛泛地答。
 *
 * 解法：引用时顺手记一份"锚"——章节号、段落编号（A2-3 这种）、
 * 段内字符偏移、以及前后各一小段原文。这份锚：
 *   · 界面上**不显示**（用户只看到 QQ 那样的引用气泡）
 *   · 发给模型时拼成一段【引用位置】说明，让它能精确定位
 *   · 存进消息里，跨页面（比如从右侧抽屉"全屏"到自习问答）也不会丢
 *
 * 依赖 DOM 上的两个属性（教材正文渲染时已经打了）：
 *   [data-source-id]  这一块是谁的（章节 id）
 *   [data-para]       段落下标（0 开始）
 * 可选：data-chapter-no / data-chapter-title / data-chapter-total
 */

export type AnchorKind = 'chapter' | 'material' | 'teach' | 'qa' | 'unknown'

export type TextAnchor = {
  kind: AnchorKind
  /** 章节 id / 资料 id，能点回去就看这个 */
  sourceId?: string | null
  /** 第几章（1 开始） */
  chapterNo?: number | null
  chapterTitle?: string
  /** 段落编号，形如 A2-3 */
  paraLabel?: string | null
  /** 段落下标（0 开始） */
  paraIndex?: number | null
  /** 段内字符偏移（0 开始，左闭右开） */
  charStart?: number | null
  charEnd?: number | null
  /** 引用原文 */
  quote: string
  /** 这一段的前后文，给模型做定位用 */
  before?: string
  after?: string
}

const MAX_QUOTE = 600
const MAX_CTX = 200

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function clip(s: string, n: number): string {
  const t = s.trim()
  return t.length <= n ? t : t.slice(0, n) + '…'
}

/** 从任意节点往上找最近的一个"段落块"和"来源块" */
function nearest(el: Element | null): { para: HTMLElement | null; root: HTMLElement | null } {
  const para = (el?.closest('[data-para]') as HTMLElement | null) ?? null
  const root = (el?.closest('[data-source-id]') as HTMLElement | null) ?? null
  return { para, root }
}

function elementOf(node: Node | null): Element | null {
  if (!node) return null
  if (node.nodeType === 1) return node as Element
  return node.parentElement
}

/**
 * 把 Range 变成锚。
 *
 * 段落内的字符偏移是拿"从段首到选区起点"的 Range 文本长度算的，
 * 跟用户眼睛看到的文字一致——不是 markdown 源码里的位置。
 */
export function anchorFromRange(range: Range, selectedRaw: string): TextAnchor {
  const quote = clip(norm(selectedRaw), MAX_QUOTE)
  const startEl = elementOf(range.startContainer)
  const { para, root } = nearest(startEl)

  const base: TextAnchor = { kind: 'unknown', quote }

  if (root) {
    base.sourceId = root.dataset.sourceId ?? null
    const no = Number(root.dataset.chapterNo ?? '')
    if (Number.isFinite(no) && no > 0) base.chapterNo = no
    if (root.dataset.chapterTitle) base.chapterTitle = root.dataset.chapterTitle
    base.kind = root.dataset.sourceKind === 'material' ? 'material' : 'chapter'
  }

  if (!para) {
    // 没有段落标记（上课讲解、对话气泡这类整块内容）：只保留前后文
    const container = root ?? nearest(startEl)?.root ?? (startEl?.closest('.prose-narrow') as HTMLElement | null) ?? startEl
    const text = norm(container?.textContent ?? '')
    const idx = text.indexOf(quote.slice(0, 40))
    if (idx >= 0) {
      base.before = clip(text.slice(Math.max(0, idx - MAX_CTX), idx), MAX_CTX)
      base.after = clip(text.slice(idx + quote.length, idx + quote.length + MAX_CTX), MAX_CTX)
    }
    return base
  }

  const paraIndex = Number(para.dataset.para ?? '')
  if (Number.isFinite(paraIndex)) base.paraIndex = paraIndex

  const paraText = norm(para.textContent ?? '')
  try {
    const pre = document.createRange()
    pre.selectNodeContents(para)
    pre.setEnd(range.startContainer, range.startOffset)
    const startOff = norm(pre.toString()).length
    base.charStart = startOff
    base.charEnd = startOff + quote.length
    base.before = clip(paraText.slice(Math.max(0, startOff - MAX_CTX), startOff), MAX_CTX)
    base.after = clip(paraText.slice(startOff + quote.length, startOff + quote.length + MAX_CTX), MAX_CTX)
  } catch {
    const idx = paraText.indexOf(quote.slice(0, 40))
    if (idx >= 0) {
      base.charStart = idx
      base.charEnd = idx + quote.length
      base.before = clip(paraText.slice(Math.max(0, idx - MAX_CTX), idx), MAX_CTX)
      base.after = clip(paraText.slice(idx + quote.length, idx + quote.length + MAX_CTX), MAX_CTX)
    }
  }

  if (base.chapterNo && Number.isFinite(paraIndex)) {
    base.paraLabel = `A${base.chapterNo}-${paraIndex + 1}`
  }

  return base
}

/** 当前选区 → 锚（拿不到选区就 null） */
export function anchorFromSelection(): TextAnchor | null {
  const s = window.getSelection()
  if (!s || s.rangeCount === 0) return null
  const text = s.toString().trim()
  if (!text) return null
  try {
    return anchorFromRange(s.getRangeAt(0), text)
  } catch {
    return { kind: 'unknown', quote: clip(norm(text), MAX_QUOTE) }
  }
}

/** 没有 DOM 上下文时（比如程序化引用），至少给个只有原文的锚 */
export function quoteAnchor(text: string, kind: AnchorKind = 'unknown'): TextAnchor {
  return { kind, quote: clip(norm(text), MAX_QUOTE) }
}

/* ────────────────────── 展示 ────────────────────── */

/** 界面上只显示这一行小字：第2章 · A2-3 */
export function anchorLabel(a: TextAnchor | null | undefined): string {
  if (!a) return ''
  const bits: string[] = []
  if (a.chapterNo) bits.push(`第 ${a.chapterNo} 章`)
  else if (a.chapterTitle) bits.push(a.chapterTitle)
  if (a.paraLabel) bits.push(a.paraLabel)
  if (!bits.length && a.kind === 'teach') bits.push('上课讲解')
  if (!bits.length && a.kind === 'qa') bits.push('对话')
  return bits.join(' · ')
}

/* ────────────────────── 给模型看 ────────────────────── */

/**
 * 拼出发给模型的那段"位置说明"。
 * 界面上永远不渲染这个字符串——它是给模型的坐标，不是给人看的。
 */
export function anchorPromptBlock(a: TextAnchor | null | undefined): string {
  if (!a || !a.quote) return ''
  const where: string[] = []
  if (a.chapterNo) where.push(`第 ${a.chapterNo} 章`)
  if (a.chapterTitle) where.push(`《${a.chapterTitle}》`)
  if (a.paraLabel) where.push(`段落 ${a.paraLabel}`)
  if (a.paraIndex !== null && a.paraIndex !== undefined) where.push(`第 ${a.paraIndex + 1} 段`)
  if (a.charStart !== null && a.charStart !== undefined && a.charEnd) {
    where.push(`段内第 ${a.charStart}–${a.charEnd} 字`)
  }
  if (!where.length) where.push('正文（没有编号，按引用的原文找）')

  const lines = [`【引用位置】${where.join(' · ')}`]
  lines.push(`【引用原文】「${a.quote}」`)
  if (a.before) lines.push(`【上文】…${a.before}`)
  if (a.after) lines.push(`【下文】${a.after}…`)
  return lines.join('\n')
}

/** 一行版：塞进教学提问字符串里用 */
export function anchorInline(a: TextAnchor | null | undefined): string {
  if (!a || !a.quote) return ''
  const blk = anchorPromptBlock(a)
  return blk ? `\n\n${blk}\n（按上面的位置直接翻到原文回答，不要让我再说一遍在哪）` : ''
}

/** 存消息时用的紧凑序列化（qa_message.attach_json 之类） */
export function packAnchor(a: TextAnchor): string {
  try {
    return JSON.stringify({ v: 1, ...a })
  } catch {
    return ''
  }
}

export function unpackAnchor(raw: string | null | undefined): TextAnchor | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as TextAnchor & { v?: number }
    if (!o || typeof o.quote !== 'string') return null
    return o
  } catch {
    return null
  }
}
