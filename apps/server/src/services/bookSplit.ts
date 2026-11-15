import fs from 'node:fs'
import { all, one } from '../db/index.js'

/**
 * 拆书与比书。
 *
 * 为什么和 textbook.ts 分开：那边在生成教材，这边只做"把现成的书切开"和"两本书对一对"，
 * 互不干扰，改一边不会碰坏另一边。
 */

export type Section = {
  title: string
  chars: number
  /** 前 40 字，给预览用 */
  preview: string
  /** 完整正文，落库时才用 */
  body: string
}

/** 把一份资料按它自己的结构拆成节（不落库） */
export function previewSplit(materialId: string): { name: string; sections: Section[] } {
  const mat = one<{ id: string; name: string; file_path: string | null }>(
    `SELECT id, name, file_path FROM material WHERE id = ?`,
    materialId,
  )
  if (!mat) throw new Error('资料不存在')

  const chunks = all<{ text: string; heading_path: string; order_index: number }>(
    `SELECT text, heading_path, order_index FROM chunk WHERE material_id = ? ORDER BY order_index`,
    materialId,
  )

  type Raw = { title: string; body: string[] }
  const raws: Raw[] = []

  if (chunks.length > 0) {
    for (const c of chunks) {
      const head = (c.heading_path || '').split('>').pop()?.trim() || ''
      const title = head || '正文'
      const last = raws[raws.length - 1]
      if (last && last.title === title) last.body.push(c.text)
      else raws.push({ title, body: [c.text] })
    }
  }

  // chunk 里没有像样的标题结构 → 退回按原文的 # 标题切
  if (raws.length <= 1) {
    const raw =
      mat.file_path && fs.existsSync(mat.file_path)
        ? fs.readFileSync(mat.file_path, 'utf8')
        : chunks.map((c) => c.text).join('\n\n')

    const parts = raw.split(/\n(?=#{1,3}\s)/)
    if (parts.length > 1) {
      raws.length = 0
      for (const part of parts) {
        const m = /^#{1,3}\s+(.*)$/m.exec(part)
        raws.push({
          title: m ? m[1].trim() : '正文',
          body: [part.replace(/^#{1,3}\s+.*$/m, '').trim()],
        })
      }
    }
  }

  if (raws.length === 0 || (raws.length === 1 && raws[0].body.join('').trim().length < 20)) {
    const raw =
      mat.file_path && fs.existsSync(mat.file_path) ? fs.readFileSync(mat.file_path, 'utf8') : ''
    raws.length = 0
    raws.push({ title: '全文', body: [raw || chunks.map((c) => c.text).join('\n\n') || '（没解析出内容）'] })
  }

  const sections: Section[] = raws.map((r) => {
    const body = r.body.join('\n\n').trim()
    return {
      title: r.title.slice(0, 80),
      chars: body.length,
      preview: body.replace(/\s+/g, ' ').slice(0, 40),
      body,
    }
  })

  return { name: mat.name.replace(/\.[^.]+$/, ''), sections }
}

/* ------------------------------------------------------------------
   两本书对比
   ------------------------------------------------------------------ */

export type DiffRow = {
  /** left = 只在 A，right = 只在 B，both = 两边都有 */
  kind: 'both' | 'left' | 'right'
  titleA?: string
  titleB?: string
  charsA?: number
  charsB?: number
  /** 标题相似度 0–1，只在 both 时有 */
  titleSim?: number
  /** 字数差百分比，只在 both 时有 */
  sizeGap?: number
  /** 给 UI 的三色标 */
  flag: 'same' | 'near' | 'onlyLeft' | 'onlyRight' | 'sizeGap'
}

/** 归一化：去掉标点、空白、章节序号，只留实词 */
function norm(s: string): string {
  return s
    .replace(/^第[一二三四五六七八九十百\d]+[章节篇讲]\s*/, '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[，。、：；！？,.:;!?（）()【】\[\]《》<>"'`~·—…-]/g, '')
    .toLowerCase()
}

/** 最长公共子串长度 */
function lcsLen(x: string, y: string): number {
  if (!x || !y) return 0
  let best = 0
  const row = new Array(y.length + 1).fill(0)
  for (let i = 1; i <= x.length; i++) {
    let diag = 0
    for (let j = 1; j <= y.length; j++) {
      const prev = row[j]
      row[j] = x[i - 1] === y[j - 1] ? diag + 1 : 0
      if (row[j] > best) best = row[j]
      diag = prev
    }
  }
  return best
}

/** 简单的字符级相似度（Dice 系数），够用来判断"是不是同一章" */
function similarity(a: string, b: string): number {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1

  const grams = (s: string) => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    if (s.length === 1) set.add(s)
    return set
  }
  const ga = grams(x)
  const gb = grams(y)
  let hit = 0
  for (const g of ga) if (gb.has(g)) hit++
  const dice = (2 * hit) / (ga.size + gb.size)

  // 关键词重叠：像「认识火候」和「火候是什么」，字面只差一个词，
  // 但 Dice 会被短标题拉低。只要共同片段占较短标题的 40% 以上，就认。
  const lcs = lcsLen(x, y)
  const shorter = Math.min(x.length, y.length)
  const keyOverlap = shorter > 0 ? lcs / shorter : 0
  if (keyOverlap >= 0.4) return Math.max(dice, 0.55 + keyOverlap * 0.3)

  return dice
}

/**
 * 对齐两本书的章节。
 * 先用标题做最佳匹配，匹配不上的归到各自那一边。
 */
export function compareBooks(
  a: { name: string; sections: Section[] },
  b: { name: string; sections: Section[] },
): { rows: DiffRow[]; stats: { same: number; near: number; onlyLeft: number; onlyRight: number } } {
  const usedB = new Set<number>()
  const rows: DiffRow[] = []

  for (const sa of a.sections) {
    let best = -1
    let bestSim = 0
    for (let j = 0; j < b.sections.length; j++) {
      if (usedB.has(j)) continue
      const sim = similarity(sa.title, b.sections[j].title)
      if (sim > bestSim) {
        bestSim = sim
        best = j
      }
    }

    if (best >= 0 && bestSim >= 0.5) {
      usedB.add(best)
      const sb = b.sections[best]
      const gap = Math.abs(sa.chars - sb.chars) / Math.max(1, Math.max(sa.chars, sb.chars))
      rows.push({
        kind: 'both',
        titleA: sa.title,
        titleB: sb.title,
        charsA: sa.chars,
        charsB: sb.chars,
        titleSim: Number(bestSim.toFixed(2)),
        sizeGap: Number((gap * 100).toFixed(0)),
        flag: bestSim >= 0.8 ? 'same' : 'near',
      })
    } else {
      rows.push({ kind: 'left', titleA: sa.title, charsA: sa.chars, flag: 'onlyLeft' })
    }
  }

  for (let j = 0; j < b.sections.length; j++) {
    if (usedB.has(j)) continue
    rows.push({ kind: 'right', titleB: b.sections[j].title, charsB: b.sections[j].chars, flag: 'onlyRight' })
  }

  const stats = {
    same: rows.filter((r) => r.flag === 'same').length,
    near: rows.filter((r) => r.flag === 'near' || r.flag === 'sizeGap').length,
    onlyLeft: rows.filter((r) => r.flag === 'onlyLeft').length,
    onlyRight: rows.filter((r) => r.flag === 'onlyRight').length,
  }
  return { rows, stats }
}
