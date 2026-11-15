import { Fragment, type ReactNode } from 'react'
import { Figure, type FigureSpec } from './Figures'
import { latexToText } from '../lib/latex'

/**
 * 极简 Markdown 渲染：只支持教学场景真正会用到的那几种。
 * 不引入 react-markdown（体积和省事之间选了后者，且这样样式完全可控）。
 *
 * 支持：**加粗**、`行内代码`、- 列表、1. 有序列表、段落、> 引用、
 *      ```figure 块（JSON → 图，见 Figures.tsx）
 */

type Block =
  | { kind: 'text'; text: string }
  | { kind: 'figure'; spec: FigureSpec }
  | { kind: 'code'; text: string; lang: string }

/** 把 ```figure 和 ```代码块 从正文里切出来 */
function splitFences(src: string): Block[] {
  const out: Block[] = []
  const re = /```([a-zA-Z]*)\n([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ kind: 'text', text: src.slice(last, m.index) })
    const lang = (m[1] || '').toLowerCase()
    const body = m[2]

    if (lang === 'figure') {
      try {
        const spec = JSON.parse(body.trim()) as FigureSpec
        if (spec && (spec.type === 'plot' || spec.type === 'svg' || spec.type === 'wordcard')) {
          out.push({ kind: 'figure', spec })
        }
      } catch {
        // JSON 坏了就当普通代码块显示，别让整段消失
        out.push({ kind: 'code', text: body, lang: 'figure' })
      }
    } else {
      out.push({ kind: 'code', text: body, lang })
    }
    last = m.index + m[0].length
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) })
  return out
}



/**
 * 公式里的小标：a_{n} → a<sub>n</sub>，x^{2} → x<sup>2</sup>。
 * 不用 Unicode 下标字符（ₙ ₁ ₂ ），那批字符很多字体没有，出来是豆腐块。
 */

/* Unicode 上下标 → <sub>/<sup>。字体里没有这些字形时会变豆腐块，所以统一转掉 */
const SUB_MAP: Record<string, string> = {
  '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9',
  'ₐ':'a','ₑ':'e','ₒ':'o','ₓ':'x','ₕ':'h','ₖ':'k','ₗ':'l','ₘ':'m','ₙ':'n','ₚ':'p',
  'ₛ':'s','ₜ':'t','ᵢ':'i','ᵣ':'r','ᵤ':'u','ᵥ':'v','₊':'+','₋':'-','₌':'=','₍':'(','₎':')',
}
const SUP_MAP: Record<string, string> = {
  '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9',
  'ⁱ':'i','ⁿ':'n','ˣ':'x','⁺':'+','⁻':'-','⁼':'=','⁽':'(','⁾':')',
}

/** 把一段文字里的 Unicode 上下标还原成标签 */
function demoteScripts(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let buf = ''
  let mode: 'sub' | 'sup' | null = null
  let key = 0

  const flush = () => {
    if (!buf) return
    if (mode === 'sub') out.push(<sub key={key++} className="text-[0.72em]">{buf}</sub>)
    else if (mode === 'sup') out.push(<sup key={key++} className="text-[0.72em]">{buf}</sup>)
    else out.push(<Fragment key={key++}>{buf}</Fragment>)
    buf = ''
  }

  for (const ch of s) {
    const sub = SUB_MAP[ch]
    const sup = SUP_MAP[ch]
    if (sub) {
      if (mode !== 'sub') { flush(); mode = 'sub' }
      buf += sub
    } else if (sup) {
      if (mode !== 'sup') { flush(); mode = 'sup' }
      buf += sup
    } else {
      if (mode) { flush(); mode = null }
      buf += ch
    }
  }
  flush()
  return out
}

function FormulaText({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  const re = /([_^])\{([^{}]{1,12})\}/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>)
    const inner = m[2]
    parts.push(
      m[1] === '_' ? (
        <sub key={key++} className="text-[0.72em]">{inner}</sub>
      ) : (
        <sup key={key++} className="text-[0.72em]">{inner}</sup>
      ),
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>)
  return <>{parts}</>
}

export function MiniMarkdown({ text }: { text: string }) {
  const blocks = splitFences(text.replace(/\r\n/g, '\n'))
  return (
    <div className="text-[14.5px]">
      {blocks.map((b, i) => {
        if (b.kind === 'figure') return <Figure key={i} spec={b.spec} />
        if (b.kind === 'code')
          return (
            <pre
              key={i}
              className="my-3 overflow-x-auto rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-xs leading-relaxed text-ink-dim"
            >
              {b.text}
            </pre>
          )
        return <TextBlock key={i} text={b.text} />
      })}
    </div>
  )
}

function TextBlock({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let listBuf: string[] = []
  let listOrdered = false

  const flushList = () => {
    if (listBuf.length === 0) return
    const items = listBuf.map((line, i) => (
      <li key={i} className="leading-relaxed">
        {inline(line)}
      </li>
    ))
    blocks.push(
      listOrdered ? (
        <ol key={`l${blocks.length}`} className="my-2 ml-5 list-decimal space-y-1.5 text-[16px] leading-[1.8] text-ink-dim">
          {items}
        </ol>
      ) : (
        <ul key={`l${blocks.length}`} className="my-2 ml-5 list-disc space-y-1.5 text-[16px] leading-[1.8] text-ink-dim">
          {items}
        </ul>
      ),
    )
    listBuf = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushList()
      continue
    }
    const ul = /^[-*]\s+(.*)$/.exec(line)
    const ol = /^\d+[.)]\s+(.*)$/.exec(line)
    if (ul) {
      if (!listOrdered) flushList()
      listOrdered = false
      listBuf.push(ul[1])
      continue
    }
    if (ol) {
      if (listOrdered === false) flushList()
      listOrdered = true
      listBuf.push(ol[1])
      continue
    }
    flushList()

    if (line.startsWith('> ')) {
      blocks.push(
        <blockquote
          key={`b${blocks.length}`}
          className="my-2 border-l-2 border-accent/50 pl-3 text-sm text-ink-dim"
        >
          {inline(line.slice(2))}
        </blockquote>,
      )
      continue
    }
    const trimmed = line.trim()

    /* ── 重要定义：单独一行，居中放大加粗，带一个说明标签 ── */
    const def = /^(定义|定理|公理|推论|公式|性质|法则|判据|结论)\s*[:：]\s*(.+)$/.exec(trimmed)
    if (def) {
      blocks.push(
        <div
          key={`d${blocks.length}`}
          className="my-6 rounded-lg border border-accent/25 bg-accent-soft/40 px-5 py-4 text-center"
        >
          <div className="mb-1.5 text-[11px] font-medium tracking-[0.2em] text-accent/80">
            {def[1]}
          </div>
          <div className="text-[19px] font-semibold leading-relaxed text-ink">{inline(def[2])}</div>
        </div>,
      )
      continue
    }

    /* ── 公式：三种写法都吃 ──
       1. $$...$$ / \[...\]（模型按提示词该用这种）
       2. 整行没有中文、含数学关系符 —— 模型漏了定界符也不会落成段内小字
       3. 含 lim / ∫ / ∑ / ∂ 这类算子 */
    const hasDelim = (/^\$\$[\s\S]+\$\$$/.test(trimmed) || /^\\\[[\s\S]+\\\]$/.test(trimmed)) && trimmed.length < 240
    const noCjk = !/[\u4e00-\u9fff]/.test(trimmed)
    const hasRelation = /[=≈≠≤≥<>→]/.test(trimmed)
    const hasOperator = /\b(lim|sin|cos|tan|log|ln|exp|max|min|∫|∑|∂|√)\b/.test(trimmed)
    const bareFormula =
      !hasDelim &&
      noCjk &&
      trimmed.length >= 3 &&
      trimmed.length <= 140 &&
      hasRelation &&
      (hasOperator || /[0-9a-zA-Z_^²³]/.test(trimmed))

    if (hasDelim || bareFormula) {
      const body = latexToText(
        trimmed.replace(/^\$\$|^\s*\\\[/, '').replace(/\$\$$|\\\]$/, '').trim(),
      )
      blocks.push(
        <div
          key={`f${blocks.length}`}
          className="my-6 text-center font-mono text-[22px] font-semibold leading-relaxed tracking-wide text-ink"
        >
          <FormulaText text={body} />
        </div>,
      )
      continue
    }

    // 单独成行的英文单词/短语：当一个"词条"处理，居中放大
    const isWord =
      /^[A-Za-z][A-Za-z\s'’\-./()]{0,42}$/.test(trimmed) &&
      trimmed.split(/\s+/).length <= 6 &&
      !/[\u4e00-\u9fff]/.test(trimmed)
    if (isWord && trimmed.length >= 2) {
      blocks.push(
        <div
          key={`w${blocks.length}`}
          className="my-5 text-center text-[26px] font-semibold tracking-[0.06em] text-accent"
        >
          {trimmed}
        </div>,
      )
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const lv = h[1].length
      blocks.push(
        <p
          key={`h${blocks.length}`}
          className={
            lv <= 3
              ? 'mt-4 mb-1.5 text-[15px] font-semibold text-ink'
              : 'mt-3 mb-1 text-[14px] font-medium text-ink'
          }
        >
          {inline(h[2])}
        </p>,
      )
      continue
    }
    blocks.push(
      <p key={`p${blocks.length}`} className="my-2 indent-[2em] text-[16px] leading-[1.9] text-ink-dim">
        {inline(line)}
      </p>,
    )
  }
  flushList()

  return <>{blocks}</>
}

function inline(s: string): ReactNode {
  const parts: ReactNode[] = []
  // 一定要带上 $...$ 这一段，否则正文里的 $a_n$ 会原样露出来
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\$[^$\n]{1,80}\$)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push(<Fragment key={key++}>{s.slice(last, m.index)}</Fragment>)
    const tok = m[0]
    if (tok.startsWith('**')) {
      parts.push(
        <strong key={key++} className="font-semibold text-ink">
          {tok.slice(2, -2)}
        </strong>,
      )
    } else if (tok.startsWith('$')) {
      // 行内公式：保留等宽，但把 LaTeX 命令转成能读的符号
      parts.push(
        <code
          key={key++}
          className="rounded-sm bg-surface-3 px-1 py-0.5 font-mono text-[0.92em] text-accent"
        >
          <FormulaText text={latexToText(tok.slice(1, -1))} />
        </code>,
      )
    } else {
      parts.push(
        <code
          key={key++}
          className="rounded-sm bg-surface-3 px-1 py-0.5 font-mono text-[0.88em] text-accent"
        >
          {tok.slice(1, -1)}
        </code>,
      )
    }
    last = m.index + tok.length
  }
  if (last < s.length) parts.push(<Fragment key={key++}>{s.slice(last)}</Fragment>)
  // 把残留的 Unicode 上下标字符换成标签，避免缺字方块
  return <>{parts.map((p, i) => <Fragment key={i}>{typeof p === 'string' ? demoteScripts(p) : p}</Fragment>)}</>
}