import { VERBOSITY_MAX_CHARS, type Verbosity } from '../lib/verbosity.js'

export type CourseCtx = {
  title: string
  kind: 'skill' | 'academic'
  goal: string
  baseline: string
  verbosity: number
}

function verbosityOf(n: number): Verbosity {
  const v = Math.round(n)
  return (v >= 1 && v <= 5 ? v : 3) as Verbosity
}

export function maxCharsFor(verbosity: number): number {
  return VERBOSITY_MAX_CHARS[verbosityOf(verbosity)]
}

/**
 * 教学系统提示词。
 * 字数预算是硬约束——不是"尽量简洁"，而是给了具体数字，后面还会在服务端再裁一次。
 */
export function teachSystemPrompt(course: CourseCtx, maxChars: number): string {
  const kindRule =
    course.kind === 'academic'
      ? '这是学业课：要讲清定义、为什么成立、怎么用；讲完一个点就出一道小题检验。'
      : '这是技能课：要讲清"手上怎么做"，给可判定的状态（温度、秒数、颜色、手感），别讲空泛原理。'

  return `你是 ALP 的私人教师，学生只有一个人。你在一节一节地给他写书。

铁律（违反即失败）：
1. **正文不少于 ${maxChars} 个汉字**。这是下限，不是上限。
   不要压缩（Do not compress your responses）。宁可写长，不要砍成骨架。
2. 按「定义 → 为什么要有它 → 怎么来的(I Do) → 跟着走一遍(We Do) → 你自己试(You Do) → 两个坑」这六块写满。
   少一块就算没讲完。
3. 定义要用「定义：」开头单独一行。公式单独一行，用 $ 包起来。
4. 讲具体：给数字、给判据、给"错在哪怎么救"。别停在"要注意""要多练"这种话上。
5. 绝不写"总结一下""希望对你有帮助""让我们开始吧"这类废话。
6. 该停的时候停：讲完这一节的全部六块再停，别在中途问"要不要展开"。
7. 学生说"不懂/太快"就换一个更小的例子，不要重复原话。

${kindRule}

语气：平静、具体、有生活感。不说教，不吹捧，不用感叹号堆热情。`
}

/** 大纲生成 */
export function outlinePrompt(
  course: CourseCtx,
  materials: { name: string; chars: number; headings: string[] }[],
  existingTitles: string[],
): { system: string; user: string } {
  const matBlock =
    materials.length > 0
      ? materials
          .map(
            (m) =>
              `- ${m.name}（${Math.round(m.chars / 1000)}k 字）` +
              (m.headings.length ? `\n  可参考的章节：${m.headings.slice(0, 12).join(' / ')}` : ''),
          )
          .join('\n')
      : '（暂无资料，靠你的领域知识排）'

  const system = `你是课程设计师。只输出 JSON，不要任何解释文字。`

  const user = `为下面这门课设计课时大纲。

课程：${course.title}
类型：${course.kind === 'academic' ? '学业类（有考试，需要出题与复习）' : '技能类（动手练，要出成果）'}
目标：${course.goal || '（未填写）'}
学生现状：${course.baseline || '（未填写）'}

可用资料：
${matBlock}

${existingTitles.length ? `已有的课时（不要重复）：${existingTitles.join(' / ')}` : ''}

要求：
- 设计 6–12 个课时，按学习依赖排序
- title ≤ 12 字，要像人话，不要"第X章"
- summary ≤ 40 字，说清这一节具体练什么、做到什么算过关
- focus ≤ 10 字，这一节最关键的那一个动作或概念
- 学业类：概念→例题→变式的顺序；技能类：先能做出成品，再抠细节

只输出这个结构的 JSON：
{"lessons":[{"title":"","summary":"","focus":""}]}`

  return { system, user }
}

/** 单节课的分步脚本 */
export function lessonPlanPrompt(
  course: CourseCtx,
  lessonTitle: string,
  lessonSummary: string,
  context: string,
): { system: string; user: string } {
  const system = `你是教学设计师。只输出 JSON，不要解释。`

  const user = `把这一节课拆成 4–7 个教学步骤。

课程：${course.title}
课时：${lessonTitle}
目标：${lessonSummary}

可引用的资料片段（如与本课无关可忽略）：
${context.slice(0, 4000) || '（无）'}

每一步的内容：
- kind: "point"（讲一个要点）/ "example"（给例子）/ "practice"（让学生动手或答题）/ "check"（检验理解）
- title: ≤14 字
- goal: ≤30 字，这一步要让学生获得什么
- hint: 给老师看的提示（这一句可以长一点，最多 60 字）

要求：第一步必须是最小可理解的切入点，不要一上来就讲全貌。最后一步是检验。

只输出：
{"steps":[{"kind":"point","title":"","goal":"","hint":""}]}`

  return { system, user }
}

/** 讲一个步骤 */
export function teachStepPrompt(
  course: CourseCtx,
  lessonTitle: string,
  stepTitle: string,
  stepGoal: string,
  context: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  maxChars: number,
): { system: string; user: string } {
  const system = teachSystemPrompt(course, maxChars)

  const ctx = context.trim()
    ? `\n\n可以引用的资料（只在相关时用，用不到就别提）：\n${context.slice(0, 3000)}`
    : ''

  const user = `当前课时：${lessonTitle}
当前这一步：${stepTitle}
这一步要让学生获得：${stepGoal}
${ctx}

现在开始讲这一步。讲完就停，不要预告下一步，不要问"准备好了吗"。`

  return { system, user: user + (history.length ? '' : '') }
}

/** 学生追问 / 要求换例子 / 说不会 */
export function followupPrompt(
  course: CourseCtx,
  intent: 'explain' | 'example' | 'simpler' | 'confused' | 'more',
  question: string,
  context: string,
  maxChars: number,
): { system: string; user: string } {
  const system = teachSystemPrompt(course, maxChars)

  const map: Record<typeof intent, string> = {
    explain: '学生想更深入地理解刚才那一点。往下挖一层，但依然要短。',
    example: '学生要一个具体例子。给一个能立刻上手的。',
    simpler: '学生觉得太难。把门槛降到最低，用小一号的例子重讲。',
    confused: '学生没听懂。承认这一点，换一个完全不同的说法。',
    more: '学生想继续。直接进入下一步的内容。',
  }

  const user = `${map[intent]}

${question ? `学生原话：${question}\n` : ''}${
    context ? `可用资料：\n${context.slice(0, 2000)}\n` : ''
  }`
  return { system, user }
}

/** 按教材章节讲一步 */
export function teachChapterPrompt(
  course: CourseCtx,
  chapterNo: number,
  chapterTitle: string,
  chapterContent: string,
  step: { kind: string; title: string; goal: string; hint: string },
  maxChars: number,
): { system: string; user: string } {
  const system = teachSystemPrompt(course, maxChars)

  const user = `你在带学生读他自己那本教材的第 ${chapterNo} 章「${chapterTitle}」。
这一章的正文（他手上有，你能引用，但**不要照抄整段**）：

${chapterContent.slice(0, 4500)}

当前这一步：${step.title}
这一步要让他获得：${step.goal}
${step.hint ? `提示：${step.hint}` : ''}

现在讲这一步。这是**讲课**，不是读书摘要。要求：

1. **不少于 ${maxChars} 字**。不要压缩。宁可写长，不要砍成骨架。
   按这个顺序展开，每块都不能省：
   - 【定义】先把这一步涉及的东西**定义清楚**：变量是什么、成立条件是什么、边界在哪。
     定义用「定义：」开头单独一行。
   - 【为什么要有它】3–5 句说清它解决什么问题，没有它会怎样。
   - 【怎么来的】(I Do) 一步步推或做，**每一步说清"为什么走这一步"**，不只是给结果。
   - 【跟着走一遍】(We Do) 一个完整例子，边做边解释每个判断点。
   - 【你自己试】(You Do) 给一个只差一步的变体，停在这里让他自己推。
   - 【两个坑】错在哪、怎么看出来、怎么救。
2. 用正文里的说法和判据，别自己另编一套。
3. 界面旁边有这一章的图，讲到的时候说"上面那张图" / "把参数拖一下"。
4. 公式单独一行用 $ 包起来；重要结论用「定义：」「判据：」开头单独一行。
5. 讲完就停，不要预告下一步。`

  return { system, user }
}

/** 开课前的"优先阅读条目"生成 */
export function memoryPinPrompt(
  course: CourseCtx,
  lessons: { title: string; state: string; mastery: number }[],
  recentLogs: { at: string; pace: string; reason: string; hint: string }[],
  previousPin: string,
): { system: string; user: string } {
  const system = `你在给老师写一张"上课前速览卡"。只输出 JSON。`

  const user = `课程：${course.title}
目标：${course.goal}

课时进度：
${lessons.map((l) => `- ${l.title}（${l.state}，掌握 ${Math.round(l.mastery * 100)}%）`).join('\n') || '（还没有课时）'}

最近几次课：
${recentLogs.map((r) => `- ${r.at.slice(0, 10)} 节奏=${r.pace} 原因=${r.reason} 建议=${r.hint}`).join('\n') || '（还没上过）'}

上一次的速览卡（可以沿用或更新）：
${previousPin || '（无）'}

写三段话，总字数不超过 120 字：
1. 上次到哪、卡在哪
2. 今天从哪开始最省力
3. 一个提醒（学生容易犯的错）

只输出：{"pin":"..."}`

  return { system, user }
}

/** 课后小结 */
export function recapPrompt(
  course: CourseCtx,
  covered: string[],
  signals: { action: string; count: number }[],
): { system: string; user: string } {
  const system = `你在写课堂记录。只输出 JSON。`
  const user = `课程：${course.title}
本节覆盖：${covered.join('、') || '（未记录）'}
学生行为：${signals.map((s) => `${s.action}×${s.count}`).join('，') || '（无）'}

输出：
{"summary":"≤50字，这一节到底教会了什么","nextHint":"≤30字，下次从哪接着来","mastery":0.0到1.0之间的数}`

  return { system, user }
}
