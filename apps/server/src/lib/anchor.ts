/**
 * 文本定位锚（服务端）
 * ====================
 *
 * 前端 `apps/web/src/lib/anchor.ts` 负责"从哪里选出来的"，
 * 这里负责"怎么讲给模型听"，以及"能不能真的翻到那一段"。
 *
 * 两个用途：
 *   1. renderAnchor()  把锚拼成【引用位置】提示块，塞进 prompt
 *   2. resolveAnchor() 拿着段落编号回数据库翻原文，核对用户引用的内容
 *      （模型最怕的不是没有上下文，是上下文看着像、其实错了一段）
 */

import { all } from '../db/index.js'

export type AnchorInput = {
  kind?: string
  sourceId?: string | null
  chapterNo?: number | null
  chapterTitle?: string
  paraLabel?: string | null
  paraIndex?: number | null
  charStart?: number | null
  charEnd?: number | null
  quote?: string
  before?: string
  after?: string
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n) + '…'
}

/** 锚 → 给模型看的位置说明（界面上不渲染） */
export function renderAnchor(a: AnchorInput | null | undefined, extra?: string): string {
  if (!a) return ''
  const where: string[] = []
  if (a.chapterNo) where.push(`第 ${a.chapterNo} 章`)
  if (a.chapterTitle) where.push(`《${a.chapterTitle}》`)
  if (a.paraLabel) where.push(`段落 ${a.paraLabel}`)
  if (a.paraIndex !== null && a.paraIndex !== undefined) where.push(`第 ${a.paraIndex + 1} 段`)
  if (a.charStart !== null && a.charStart !== undefined && a.charEnd) {
    where.push(`段内第 ${a.charStart}–${a.charEnd} 字`)
  }
  if (!where.length) where.push('正文（没有编号，按引用的原文找）')

  const lines: string[] = [`【引用位置】${where.join(' · ')}`]
  if (a.quote) lines.push(`【引用原文】「${clip(a.quote, 600)}」`)
  if (a.before) lines.push(`【上文】…${clip(a.before, 200)}`)
  if (a.after) lines.push(`【下文】${clip(a.after, 200)}…`)
  if (extra) lines.push(extra)
  return lines.join('\n')
}

/* ── 真的翻到那一段 ── */

type ChapterRow = { id: string; order_index: number; title: string; content_md: string }

function paragraphsOf(md: string): string[] {
  return md.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
}

/**
 * 拿锚里的章节号/段落下标，回到教材里把原文取出来。
 * 取不到就返回 null —— 调用方按"只有引用"的路子走，不要瞎猜。
 */
export function resolveAnchor(
  courseId: string | null,
  a: AnchorInput | null | undefined,
): { label: string; chapterTitle: string; text: string; before: string; after: string } | null {
  if (!courseId || !a) return null

  const chapters = all<ChapterRow>(
    `SELECT c.id, c.order_index, c.title, c.content_md
       FROM textbook_chapter c JOIN textbook b ON b.id = c.textbook_id
      WHERE b.course_id = ? ORDER BY c.order_index`,
    courseId,
  )
  if (!chapters.length) return null

  const ch =
    (a.chapterNo ? chapters.find((c) => c.order_index + 1 === a.chapterNo) : null) ??
    (a.paraLabel ? chapters.find((c) => a.paraLabel!.startsWith(`A${c.order_index + 1}-`)) : null) ??
    (a.sourceId ? chapters.find((c) => c.id === a.sourceId) : null)
  if (!ch) return null

  const paras = paragraphsOf(ch.content_md)
  let idx = -1
  if (a.paraIndex !== null && a.paraIndex !== undefined && paras[a.paraIndex]) idx = a.paraIndex
  else if (a.quote) {
    const needle = a.quote.slice(0, 24)
    idx = paras.findIndex((p) => p.replace(/\s+/g, ' ').includes(needle))
  }
  if (idx < 0 || idx >= paras.length) return null

  return {
    label: `A${ch.order_index + 1}-${idx + 1}`,
    chapterTitle: ch.title,
    text: paras[idx],
    before: paras.slice(Math.max(0, idx - 1), idx).join('\n'),
    after: paras.slice(idx + 1, idx + 2).join('\n'),
  }
}

/** 段落编号里的第几段（A2-3 → {chapterNo:2, paraNo:3}），不认中文数字，前端已归一 */
export function parseParaLabel(label: string): { chapterNo?: number; paraNo?: number } {
  const m = /^A(\d+)-(\d+)$/i.exec(label.trim())
  if (!m) return {}
  return { chapterNo: Number(m[1]), paraNo: Number(m[2]) }
}
