import { all } from '../db/index.js'
import { renderPrompt } from '../prompts/index.js'
import { extractJson } from './llm.js'
import { chat } from './llm.js'
import { getCourse } from './course.js'
import { hybridSearch } from './search.js'

/**
 * 自习模式的问答。
 *
 * 和普通问答的区别：
 *   1. 必须先定位到"哪一段"（教材每段都有 §1.3 这样的编号）
 *   2. 问题模糊就先追问，不猜
 *   3. 学业类给思路，不给最终答案
 *   4. 文案要求：短句、口语、能听（因为要念出来）
 */

export type ParagraphRef = {
  label: string
  chapterId: string
  chapterNo: number
  paraNo: number
  text: string
  before: string
  after: string
}

export type SelfStudyResult = {
  kind: 'need_paragraph' | 'need_clarify' | 'answer'
  /** 给用户看的话（也是要念出来的那句） */
  message: string
  answer?: string
  figures?: unknown[]
  paragraph?: { label: string; text: string }
  /** 当 need_paragraph 时，给一份可点选的编号清单 */
  options?: { label: string; preview: string }[]
}

type ChapterRow = {
  id: string
  order_index: number
  title: string
  content_md: string
  goal: string
}


/* ── 语音进来的是"Q 三"这种中文数字，正则原来只认阿拉伯数字 ── */

const CN_DIGIT: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/** "三" → 3，"十二" → 12，"二十三" → 23；已经是数字就原样转 */
function cnToNum(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  if (/^\d+$/.test(t)) return Number(t)
  const chars = [...t]
  if (!chars.every((ch) => ch === '十' || ch in CN_DIGIT)) return null
  if (!t.includes('十')) {
    return chars.length === 1 ? CN_DIGIT[chars[0]] : null
  }
  const [a, b] = t.split('十')
  const tens = a ? CN_DIGIT[a] : 1
  const ones = b ? CN_DIGIT[b] : 0
  if (tens === undefined || ones === undefined) return null
  return tens * 10 + ones
}

/** 数字或中文数字，统一成 number */
function anyNum(s: string): number | null {
  return cnToNum(s)
}
/** 从问题里抠出 Q1 / Q三 / A1-3 / 第1章第3段 这类引用 */
export function parseRef(question: string): {
  chapterNo?: number
  paraNo?: number
  questionNo?: number
} {
  const q = question.replace(/\s+/g, '')

  const NUM = '[0-9一二三四五六七八九十两]{1,3}'

  // 题目编号：Q1 / Q 三 / q12（语音转出来常是中文数字）
  const qs = new RegExp(`[Qq]\\s*(${NUM})(?![\\d-])`).exec(q)
  if (qs) {
    const n = anyNum(qs[1])
    if (n && n > 0) return { questionNo: n }
  }

  // "第三题" / "第 3 题" / "问题三"
  const qcn = new RegExp(`第\\s*(${NUM})\\s*题`).exec(q)
  if (qcn) {
    const n = anyNum(qcn[1])
    if (n && n > 0) return { questionNo: n }
  }

  // 段落编号：A1-3 / A 一 杠三 / A1.3
  const letter = new RegExp(`[Aa]\\s*(${NUM})\\s*[-－.．杠]\\s*(${NUM})`).exec(q)
  if (letter) {
    const c1 = anyNum(letter[1])
    const p1 = anyNum(letter[2])
    if (c1 && p1) return { chapterNo: c1, paraNo: p1 }
  }

  // 兼容旧写法
  const sect = /§?\s*(\d{1,2})\s*[.．\-]\s*(\d{1,3})/.exec(q)
  if (sect) return { chapterNo: Number(sect[1]), paraNo: Number(sect[2]) }

  const cn = /第(\d{1,2})章第(\d{1,3})段/.exec(q)
  if (cn) return { chapterNo: Number(cn[1]), paraNo: Number(cn[2]) }

  const pOnly = /第(\d{1,3})段/.exec(q)
  if (pOnly) return { paraNo: Number(pOnly[1]) }

  return {}
}

function paragraphsOf(md: string): string[] {
  return md.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
}

/** 按编号取出那一段 + 前后文 */
export function locateParagraph(
  courseId: string,
  ref: { chapterNo?: number; paraNo?: number },
): ParagraphRef | null {
  if (!ref.paraNo) return null

  const chapters = all<ChapterRow>(
    `SELECT c.id, c.order_index, c.title, c.content_md, c.goal
       FROM textbook_chapter c JOIN textbook b ON b.id = c.textbook_id
      WHERE b.course_id = ? ORDER BY c.order_index`,
    courseId,
  )
  if (chapters.length === 0) return null

  const ch = ref.chapterNo
    ? chapters.find((c) => c.order_index + 1 === ref.chapterNo)
    : // 没给章号就在全书里找第一个存在的段号
      chapters.find((c) => paragraphsOf(c.content_md).length >= (ref.paraNo ?? 0))
  if (!ch) return null

  const paras = paragraphsOf(ch.content_md)
  const idx = (ref.paraNo ?? 1) - 1
  if (idx < 0 || idx >= paras.length) return null

  return {
    label: `A${ch.order_index + 1}-${ref.paraNo}`,
    chapterId: ch.id,
    chapterNo: ch.order_index + 1,
    paraNo: ref.paraNo,
    text: paras[idx],
    before: paras.slice(Math.max(0, idx - 2), idx).join('\n\n'),
    after: paras.slice(idx + 1, idx + 3).join('\n\n'),
  }
}

/** 给一份"这章有哪些段"的清单，让用户点 */
export function paragraphOptions(courseId: string, chapterNo?: number, limit = 30) {
  const chapters = all<ChapterRow>(
    `SELECT c.id, c.order_index, c.title, c.content_md, c.goal
       FROM textbook_chapter c JOIN textbook b ON b.id = c.textbook_id
      WHERE b.course_id = ? ORDER BY c.order_index`,
    courseId,
  )
  const out: { label: string; preview: string }[] = []
  for (const ch of chapters) {
    if (chapterNo && ch.order_index + 1 !== chapterNo) continue
    const paras = paragraphsOf(ch.content_md)
    paras.forEach((p, i) => {
      if (out.length >= limit) return
      const plain = p.replace(/[#*`>\-]/g, '').replace(/\s+/g, ' ').trim()
      if (plain.length < 8) return
      out.push({
        label: `A${ch.order_index + 1}-${i + 1}`,
        preview: `第${ch.order_index + 1}章 · ${plain.slice(0, 34)}`,
      })
    })
  }
  return out
}


/* ── 题目：Q1 / Q2 这种编号，和段落一样能被问 ── */

type QuestionRow = {
  id: string
  stem: string
  options_json: string
  answer: string
  explain: string
  type: string
  created_at: string
}

export function locateQuestion(courseId: string, n: number): { label: string; q: QuestionRow } | null {
  const rows = all<QuestionRow>(
    `SELECT id, stem, options_json, answer, explain, type, created_at
       FROM question WHERE course_id = ? ORDER BY created_at LIMIT 200`,
    courseId,
  )
  const q = rows[n - 1]
  if (!q) return null
  return { label: `Q${n}`, q }
}

export function listQuestions(courseId: string, limit = 30) {
  return all<QuestionRow>(
    `SELECT id, stem, options_json, answer, explain, type, created_at
       FROM question WHERE course_id = ? ORDER BY created_at LIMIT ?`,
    courseId,
    limit,
  ).map((q, i) => ({
    label: `Q${i + 1}`,
    preview: q.stem.replace(/\s+/g, ' ').slice(0, 34),
  }))
}

/** 问题太短/太空 → 需要追问"你是哪里不明白" */
function looksVague(question: string): boolean {
  const q = question.replace(/[?？。，、\s]/g, '')
  if (q.length <= 4) return true
  const vague = ['不懂', '没懂', '不明白', '看不懂', '这里', '这段', '这什么意思', '啥意思', '什么意思', '为什么', '怎么理解']
  return vague.some((v) => q === v || q === v + '啊' || q === v + '呢')
}

const SYSTEM = (kind: string, verbosity: number) => `你是 ALP 的自习陪伴老师。学生在自己读教材，读到某一段卡住了，问你。

${kind === 'academic' ? '这是学业课：**先给思路，不要直接给最终答案**。让他自己往下推一步。真的卡死时，给一个更小的提示，而不是答案。' : '这是技能课：给可操作的做法和判断标准，别讲空道理。'}

文案要求（很重要，因为这段话会被念出来听）：
1. 用短句。一句不超过 25 字。
2. 不用括号套括号，不用破折号连接三个以上分句。
3. 不要"综上所述""值得注意的是""首先其次最后"这类。
4. 口语，像面对面说话。
5. 总长度 ${verbosity >= 4 ? '300' : '180'} 字以内。

需要配图时输出 figure（函数图 / 示意图），不要硬塞。
只输出 JSON。`

/**
 * 自习问答主入口。
 */
export async function selfStudyAsk(input: {
  courseId: string
  question: string
  /** 用户点选的编号（可选，优先于从问题里解析） */
  label?: string
}): Promise<SelfStudyResult> {
  const course = getCourse(input.courseId)
  if (!course) throw new Error('课程不存在')

  const question = input.question.trim()
  if (!question) throw new Error('请先输入问题')

  // 1. 先解析编号
  let ref = parseRef(input.label ?? question)
  if (input.label) {
    const r = parseRef(input.label)
    ref = r
  }

  // 1.5 题目编号优先（Q1 / Q2）
  if (ref.questionNo) {
    const hit = locateQuestion(input.courseId, ref.questionNo)
    if (!hit) {
      return {
        kind: 'need_paragraph',
        message: `没找到 Q${ref.questionNo} 这道题。你是想问下面哪一道？`,
        options: listQuestions(input.courseId),
      }
    }
    const opts = (() => {
      try {
        const arr = JSON.parse(hit.q.options_json || '[]') as string[]
        return arr.map((o, i) => `${'ABCD'[i]}. ${o}`).join('\n')
      } catch {
        return ''
      }
    })()

    const r = await chat(
      [
        { role: 'system', content: SYSTEM(course.kind, course.verbosity) },
        {
          role: 'user',
          content: renderPrompt('selfstudy.question', {
            label: hit.label,
            stem: hit.q.stem,
            options: opts ? `选项：\n${opts}\n` : '',
            answer: hit.q.answer,
            explain: hit.q.explain ? `解析：${hit.q.explain}\n` : '',
            question,
            kindRule:
              course.kind === 'academic'
                ? '这是学业课：先给思路，不要直接给最终答案。指着关键那一步反问他。'
                : '这是技能课：给可操作的做法和判断标准。',
          }).user,
        },
      ],
      { json: true, temperature: 0.6, maxTokens: 1400 },
    )
    const p2 = extractJson<{ answer: string; figures?: unknown[] }>(r.text)
    const ans = (p2?.answer ?? r.text).trim()
    return {
      kind: 'answer',
      message: ans.slice(0, 900),
      answer: ans,
      figures: Array.isArray(p2?.figures) ? p2!.figures : [],
      paragraph: { label: hit.label, text: hit.q.stem.slice(0, 200) },
    }
  }

  // 2. 没有编号 → 让他选
  if (!ref.paraNo) {
    const options = paragraphOptions(input.courseId)
    const qs = listQuestions(input.courseId, 10)
    return {
      kind: 'need_paragraph',
      message:
        options.length > 0
          ? '你问的是哪一段或哪道题？告诉我编号（段落是 A1-3，题目是 Q1），或者从下面点一个。'
          : '这本教材还没有分段编号。先去「教材」页让它生成，或者切到「自己找书」。',
      options: [...options.slice(0, 20), ...qs],
    }
  }

  // 3. 定位段落
  const para = locateParagraph(input.courseId, ref)
  if (!para) {
    const options = paragraphOptions(input.courseId)
    return {
      kind: 'need_paragraph',
      message: `没找到 A${ref.chapterNo ?? '?'}-${ref.paraNo} 这一段。你是想说下面哪个？`,
      options,
    }
  }

  // 4. 问题太模糊 → 追问
  if (looksVague(question)) {
    return {
      kind: 'need_clarify',
      message: '你是哪里不明白？是这一步为什么这么做，还是不知道该怎么判断？',
      paragraph: { label: para.label, text: para.text.slice(0, 200) },
    }
  }

  // 5. 找一点资料做补充
  let extra = ''
  try {
    const sr = await hybridSearch(`${para.text.slice(0, 60)} ${question}`, {
      courseId: input.courseId,
      topK: 3,
    })
    extra = sr.hits.map((h) => h.text).join('\n---\n').slice(0, 2500)
  } catch {
    extra = ''
  }

  const pAns = renderPrompt('selfstudy.answer', {
    label: para.label,
    paragraph: para.text,
    before: para.before || '（无）',
    after: para.after || '（无）',
    question,
    extra: extra ? `可参考的资料：\n${extra}` : '',
    kindRule:
      course.kind === 'academic'
        ? '这是学业课：**先给思路，不要直接给最终答案**。让他自己往下推一步。'
        : '这是技能课：给可操作的做法和判断标准。',
    maxLen: course.verbosity >= 4 ? '300' : '180',
  })
  const userPrompt = pAns.user

  const r = await chat(
    [
      { role: 'system', content: pAns.system ?? SYSTEM(course.kind, course.verbosity) },
      { role: 'user', content: userPrompt },
    ],
    { json: true, temperature: 0.6, maxTokens: 1600 },
  )

  const parsed = extractJson<{ answer: string; figures?: unknown[] }>(r.text)
  const answer = (parsed?.answer ?? r.text).trim()

  return {
    kind: 'answer',
    message: answer.slice(0, 900),
    answer,
    figures: Array.isArray(parsed?.figures) ? parsed!.figures : [],
    paragraph: { label: para.label, text: para.text.slice(0, 200) },
  }
}