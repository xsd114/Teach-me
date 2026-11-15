import { all, one, run } from '../db/index.js'
import { newId, nowIso } from '../lib/id.js'
import { clampText } from '../lib/verbosity.js'
import { renderPrompt } from '../prompts/index.js'
import { chat, extractJson } from './llm.js'
import { getCourse } from './course.js'

export type ChapterInsert = {
  id: string
  chapterId: string
  anchorIndex: number
  anchorText: string
  title: string
  contentMd: string
  sourceText: string
  depth: number
  createdAt: string
}

type Row = {
  id: string
  chapter_id: string
  anchor_index: number
  anchor_text: string
  title: string
  content_md: string
  source_text: string
  depth: number
  created_at: string
}

function toInsert(r: Row): ChapterInsert {
  return {
    id: r.id,
    chapterId: r.chapter_id,
    anchorIndex: r.anchor_index,
    anchorText: r.anchor_text,
    title: r.title,
    contentMd: r.content_md,
    sourceText: r.source_text,
    depth: r.depth,
    createdAt: r.created_at,
  }
}

export function listInserts(chapterId: string): ChapterInsert[] {
  return all<Row>(
    `SELECT * FROM chapter_insert WHERE chapter_id = ? ORDER BY anchor_index, created_at`,
    chapterId,
  ).map(toInsert)
}

export function deleteInsert(id: string): boolean {
  return run(`DELETE FROM chapter_insert WHERE id = ?`, id).changes > 0
}

/** 从正文里按空行分段，方便前端按段插入 */
export function splitParagraphs(md: string): string[] {
  return md
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 「多讲讲」：以选中的那段话为锚，就地续写一段教材。
 *
 * 和划词问答的区别：问答是临时的、不落教材；这个是**写进书里**的，
 * 所以要贴着前后文，不能自说自话，也不能重复原文说过的话。
 */
export async function expandChapter(input: {
  chapterId: string
  sourceText: string
  anchorIndex?: number
  /** 学生点选时的上下文（前后各若干字），用来确保新写的内容接得上 */
  contextBefore?: string
  contextAfter?: string
}): Promise<ChapterInsert> {
  const ch = one<{
    id: string
    textbook_id: string
    title: string
    summary: string
    content_md: string
    goal: string
    order_index: number
  }>(
    `SELECT id, textbook_id, title, summary, content_md, goal, order_index FROM textbook_chapter WHERE id = ?`,
    input.chapterId,
  )
  if (!ch) throw new Error('章节不存在')

  const book = one<{ course_id: string }>(`SELECT course_id FROM textbook WHERE id = ?`, ch.textbook_id)
  const course = book ? getCourse(book.course_id) : null

  const paragraphs = splitParagraphs(ch.content_md)
  const anchorIndex =
    typeof input.anchorIndex === 'number' && input.anchorIndex >= 0
      ? Math.min(input.anchorIndex, paragraphs.length - 1)
      : findAnchorIndex(paragraphs, input.sourceText)

  const before = input.contextBefore || paragraphs.slice(0, anchorIndex + 1).join('\n\n').slice(-1500)
  const after = input.contextAfter || paragraphs.slice(anchorIndex + 1).join('\n\n').slice(0, 1200)

  const pGrow = renderPrompt('grow.expand', {
    courseTitle: course?.title ?? '一门课',
    kindLabel: course?.kind === 'academic' ? '学业类' : '技能类',
    chapterNo: ch.order_index + 1,
    chapterTitle: ch.title,
    chapterGoal: ch.goal || ch.summary,
    sourceText: input.sourceText,
    before: before || '（无）',
    after: after || '（无）',
  })

  const r = await chat(
    [
      { role: 'system', content: pGrow.system ?? '' },
      { role: 'user', content: pGrow.user },
    ],
    { json: true, temperature: 0.7, maxTokens: 2200 },
  )

  const parsed = extractJson<{ title: string; content: string }>(r.text)
  const content = clampText(parsed?.content?.trim() || r.text.trim(), 900)
  const title = (parsed?.title ?? '').trim().slice(0, 20) || `补充：${input.sourceText.slice(0, 10)}`

  const id = newId('ins')
  run(
    `INSERT INTO chapter_insert(id, chapter_id, anchor_index, anchor_text, title, content_md, source_text, depth, created_at)
     VALUES (?,?,?,?,?,?,?,1,?)`,
    id,
    input.chapterId,
    anchorIndex,
    paragraphs[anchorIndex]?.slice(0, 120) ?? '',
    title,
    content,
    input.sourceText.slice(0, 500),
    nowIso(),
  )

  const row = one<Row>(`SELECT * FROM chapter_insert WHERE id = ?`, id)!
  return toInsert(row)
}

function findAnchorIndex(paragraphs: string[], sourceText: string): number {
  const needle = sourceText.trim().slice(0, 40)
  if (!needle) return paragraphs.length - 1
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].includes(needle)) return i
  }
  // 找不到就找最相似的段（按共同字符粗判）
  let best = paragraphs.length - 1
  let bestScore = 0
  for (let i = 0; i < paragraphs.length; i++) {
    let hit = 0
    for (const ch of new Set(needle)) if (paragraphs[i].includes(ch)) hit++
    if (hit > bestScore) {
      bestScore = hit
      best = i
    }
  }
  return best
}