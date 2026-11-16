import { all, one, run } from '../db/index.js'
import { newId, nowIso } from '../lib/id.js'
import { clampText } from '../lib/verbosity.js'
import { chat } from './llm.js'
import { hybridSearch, type Hit } from './search.js'
import { getCourse } from './course.js'
import { renderAnchor, resolveAnchor, type AnchorInput } from '../lib/anchor.js'


export type Citation = {
  n: number
  materialId: string
  materialName: string
  headingPath: string
  snippet: string
  chunkId: number
}

export type AskResult = {
  threadId: string
  messageId: string
  answer: string
  citations: Citation[]
  meta: { mode: string; hits: number; ms: number; model: string }
}

const QA_SYSTEM = (maxChars: number, scope: string) => `你是 ALP 的私人教师，正在回答学生的问题。

${scope}

铁律：
1. 正文不超过 ${maxChars} 个汉字。宁可只答一半，也不要长篇大论。
2. 先给结论，再给理由。不要复述问题，不要客套。
3. 如果资料里有答案，用资料里的说法，并在句末标 [1] [2] 指向来源。
4. 如果资料里没有，直接说"资料里没有"，然后用你自己的知识回答并说明这一点。
5. 不要编造文件名或页码。
6. 不确定的地方，说不确定。`

export function listThreads(courseId: string | null): {
  id: string
  title: string
  courseId: string | null
  updatedAt: string
  messageCount: number
}[] {
  const rows = all<{ id: string; title: string; course_id: string | null; updated_at: string; n: number }>(
    `SELECT t.id, t.title, t.course_id, t.updated_at,
            (SELECT COUNT(*) FROM qa_message m WHERE m.thread_id = t.id) AS n
       FROM qa_thread t
      WHERE ${courseId ? 't.course_id = ?' : '1=1'}
      ORDER BY t.updated_at DESC LIMIT 50`,
    ...(courseId ? [courseId] : []),
  )
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    courseId: r.course_id,
    updatedAt: r.updated_at,
    messageCount: Number(r.n),
  }))
}

export function threadMessages(threadId: string): {
  id: string
  role: string
  content: string
  citations: Citation[]
  /** 引用锚（划词问过的、引用过的位置信息），没有就是 null */
  attach: { quote?: string; anchor?: AnchorInput | null } | null
  createdAt: string
}[] {
  const rows = all<{
    id: string
    role: string
    content: string
    citations_json: string
    attach_json: string
    created_at: string
  }>(
    `SELECT id, role, content, citations_json, attach_json, created_at
       FROM qa_message WHERE thread_id = ? ORDER BY created_at`,
    threadId,
  )
  return rows.map((r) => {
    let citations: Citation[] = []
    let attach: { quote?: string; anchor?: AnchorInput | null } | null = null
    try {
      citations = JSON.parse(r.citations_json)
    } catch {
      citations = []
    }
    try {
      const raw = r.attach_json ? JSON.parse(r.attach_json) : null
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        if (raw.quote || raw.anchor) attach = raw
      }
    } catch {
      attach = null
    }
    return { id: r.id, role: r.role, content: r.content, citations, attach, createdAt: r.created_at }
  })
}

export function deleteThread(id: string): boolean {
  return run(`DELETE FROM qa_thread WHERE id = ?`, id).changes > 0
}

/**
 * 问答：先检索记忆库，再让模型在证据上回答。
 * 没有命中时也会明说，避免模型假装看过资料。
 */
export async function ask(input: {
  question: string
  courseId?: string | null
  threadId?: string | null
  topK?: number
  /** 划词问答：选中处前后各若干字的原文 */
  context?: string
  /** 划词问答：被选中的那段原话 */
  quote?: string
  /** 文本定位锚：用户选中的话在教材里的精确坐标（第几章、第几段、第几个字） */
  anchor?: AnchorInput | null
}): Promise<AskResult> {
  const t0 = Date.now()
  const courseId = input.courseId && input.courseId !== 'null' ? input.courseId : null
  const course = courseId ? getCourse(courseId) : null
  const maxChars = course ? [180, 260, 350, 520, 760][course.verbosity - 1] ?? 350 : 350

  // 1. 检索
  const sr = await hybridSearch(input.question, { courseId, topK: input.topK ?? 6 })

  const citations: Citation[] = sr.hits.map((h: Hit, i) => ({
    n: i + 1,
    materialId: h.materialId,
    materialName: h.materialName,
    headingPath: h.headingPath,
    snippet: h.text.replace(/\s+/g, ' ').slice(0, 160),
    chunkId: h.chunkId,
  }))

  const scope = course
    ? `本次只回答《${course.title}》范围内的问题；超出范围时说明这一点。`
    : `本次可以跨全部课程回答。`

  // 2. 组织上下文
  const ctx = sr.hits.length
    ? sr.hits
        .map((h, i) => `[${i + 1}]（${h.materialName}${h.headingPath ? ' · ' + h.headingPath : ''}）\n${h.text}`)
        .join('\n\n---\n\n')
        .slice(0, 9000)
    : ''

  // 划词问答：把"选中的那段 + 前后各约一千字"作为主上下文，
  // 检索到的片段退居其次——学生问的是眼前这句话，不是全库。
  const passage = (input.context ?? '').trim()
  const quote = (input.quote ?? '').trim()

  // 文本定位锚：有坐标就把教材里的原段翻出来，模型不用猜"这句在哪"
  const anchor = input.anchor ?? null
  const resolved = anchor ? resolveAnchor(courseId, anchor) : null
  const anchorBlock = anchor
    ? renderAnchor(anchor, resolved ? `【这一段在教材里的原文】${resolved.text}` : '')
    : ''

  const passageBlock = passage
    ? `【学生正在读的原文段落（他选中的部分已用 ≪≫ 标出）】\n${passage}\n\n`
    : quote
      ? `【学生选中的原文】\n≪${quote}≫\n\n`
      : ''

  const questionBlock = quote
    ? `【他的问题】关于 ≪${quote}≫ —— ${input.question}`
    : `【他的问题】${input.question}`

  const messages = [
    { role: 'system' as const, content: QA_SYSTEM(maxChars, scope) },
    {
      role: 'user' as const,
      content: ctx
        ? `${anchorBlock ? anchorBlock + '\n\n' : ''}${passageBlock}资料片段：\n${ctx}\n\n${questionBlock}\n\n请优先结合"学生正在读的原文段落"来回答；需要补充时再用资料片段，标出编号。`
        : `${anchorBlock ? anchorBlock + '\n\n' : ''}${passageBlock}资料库里没有额外检索到相关内容。\n\n${questionBlock}\n\n请优先结合"学生正在读的原文段落"回答；确实没有依据就说清楚，再用你自己的知识补充。`,
    },
  ]

  const r = await chat(messages, { temperature: 0.5, maxTokens: 900 })
  const answer = clampText(r.text, maxChars * 1.4)

  // 3. 落库
  let threadId = input.threadId ?? null
  if (!threadId) {
    threadId = newId('qat')
    run(
      `INSERT INTO qa_thread(id, course_id, title, created_at, updated_at) VALUES (?,?,?,?,?)`,
      threadId,
      courseId,
      input.question.slice(0, 40),
      nowIso(),
      nowIso(),
    )
  }

  run(
    `INSERT INTO qa_message(id, thread_id, role, content, citations_json, attach_json, created_at)
     VALUES (?,?, 'user', ?, '[]', ?, ?)`,
    newId('qam'),
    threadId,
    input.question,
    quote || anchor
      ? JSON.stringify({ quote: quote || anchor?.quote || '', anchor: anchor ?? null })
      : '[]',
    nowIso(),
  )

  const msgId = newId('qam')
  run(
    `INSERT INTO qa_message(id, thread_id, role, content, citations_json, attach_json, created_at)
     VALUES (?,?, 'assistant', ?, ?, '[]', ?)`,
    msgId,
    threadId,
    answer,
    JSON.stringify(citations),
    nowIso(),
  )
  run(`UPDATE qa_thread SET updated_at = ? WHERE id = ?`, nowIso(), threadId)

  return {
    threadId,
    messageId: msgId,
    answer,
    citations,
    meta: {
      mode: sr.meta.mode,
      hits: sr.hits.length,
      ms: Date.now() - t0,
      model: r.model,
    },
  }
}

/** 问答页顶部的状态条：记忆库里到底有多少东西可用 */
export function qaScopeStatus(courseId: string | null): {
  materials: number
  chunks: number
  courses: { id: string; title: string }[]
} {
  const c = one<{ materials: number; chunks: number }>(
    `SELECT (SELECT COUNT(*) FROM material ${courseId ? 'WHERE course_id = ?' : ''}) AS materials,
            (SELECT COUNT(*) FROM chunk ${courseId ? 'WHERE course_id = ?' : ''}) AS chunks`,
    ...(courseId ? [courseId, courseId] : []),
  )
  const courses = all<{ id: string; title: string }>(
    `SELECT id, title FROM course WHERE status = 'active' ORDER BY sort_index`,
  )
  return {
    materials: Number(c?.materials ?? 0),
    chunks: Number(c?.chunks ?? 0),
    courses,
  }
}
