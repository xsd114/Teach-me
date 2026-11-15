/**
 * 把 LaTeX 片段转成能直接读的 Unicode 文本。
 *
 * 为什么不用 KaTeX：它要 270KB，而我们只需要"看得懂"，不需要排版引擎。
 * 教材里真实出现的命令就那么二十来个，直接替换性价比更高。
 *
 * 提示词里已经禁了 LaTeX，这层是兜底 —— 模型偶尔漏写，也不能让用户看到 \frac{1}{n}。
 */

type Rep = string | ((...args: string[]) => string)
const SYMBOLS: [RegExp, Rep][] = [
  // 分式：\frac{a}{b} → a/b（单字符不加括号）
  [/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, a: string, b: string) => {
    const wrap = (s: string) => (/^[\d.a-zA-Z]$/.test(s.trim()) ? s.trim() : `(${s.trim()})`)
    return `${wrap(a)}/${wrap(b)}`
  }],
  [/\\dfrac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, a: string, b: string) => {
    const wrap = (s: string) => (/^[\d.a-zA-Z]$/.test(s.trim()) ? s.trim() : `(${s.trim()})`)
    return `${wrap(a)}/${wrap(b)}`
  }],
  [/\\sqrt\s*\{([^{}]*)\}/g, '√($1)'],
  [/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, '$1√($2)'],

  // 省略号（必须在通用命令剥离之前处理）
  [/\\dots\b|\\ldots\b|\\cdots\b/g, '…'],
  [/\\cdotp\b/g, '·'],

  // 常见算子与符号
  [/\\lim\s*_\{([^{}]*)\}/g, 'lim($1)'],
  [/\\lim\s*_(\w)/g, 'lim($1)'],
  [/\\lim/g, 'lim'],
  [/\\to\b/g, '→'],
  [/\\rightarrow/g, '→'],
  [/\\infty/g, '∞'],
  [/\\times/g, '×'],
  [/\\cdot/g, '·'],
  [/\\div/g, '÷'],
  [/\\pm/g, '±'],
  [/\\leq?\b/g, '≤'],
  [/\\geq?\b/g, '≥'],
  [/\\neq?\b/g, '≠'],
  [/\\approx/g, '≈'],
  [/\\equiv/g, '≡'],
  [/\\sum/g, '∑'],
  [/\\prod/g, '∏'],
  [/\\int/g, '∫'],
  [/\\partial/g, '∂'],
  [/\\Delta/g, 'Δ'],
  [/\\delta/g, 'δ'],
  [/\\varepsilon|\\epsilon/g, 'ε'],
  [/\\alpha/g, 'α'],
  [/\\beta/g, 'β'],
  [/\\gamma/g, 'γ'],
  [/\\theta/g, 'θ'],
  [/\\lambda/g, 'λ'],
  [/\\mu/g, 'μ'],
  [/\\pi/g, 'π'],
  [/\\sigma/g, 'σ'],
  [/\\varphi|\\phi/g, 'φ'],
  [/\\omega/g, 'ω'],
  [/\\forall/g, '∀'],
  [/\\exists/g, '∃'],
  [/\\in\b/g, '∈'],
  [/\\notin/g, '∉'],
  [/\\subset/g, '⊂'],
  [/\\cup/g, '∪'],
  [/\\cap/g, '∩'],
  [/\\mathbb\{R\}/g, 'ℝ'],
  [/\\mathbb\{N\}/g, 'ℕ'],
  [/\\mathbb\{Z\}/g, 'ℤ'],
  [/\\sin/g, 'sin'],
  [/\\cos/g, 'cos'],
  [/\\tan/g, 'tan'],
  [/\\log/g, 'log'],
  [/\\ln/g, 'ln'],
  [/\\exp/g, 'exp'],
  [/\\max/g, 'max'],
  [/\\min/g, 'min'],

  // 修饰符
  [/\\left\s*/g, ''],
  [/\\right\s*/g, ''],
  [/\\[,;!]/g, ' '],
  [/\\quad|\\qquad/g, '  '],
  [/\\text\s*\{([^{}]*)\}/g, '$1'],
  [/\\mathrm\s*\{([^{}]*)\}/g, '$1'],
  [/\\displaystyle/g, ''],
]

export function latexToText(src: string): string {
  let s = src

  for (const [re, rep] of SYMBOLS) {
    s = s.replace(re, rep as unknown as string)
  }

  // 上下标统一成 ^{...} / _{...} 的写法，由渲染层用 <sup>/<sub> 出，
  // 不用 Unicode 上下标字符（ₙ ₁ ₂ 这类在很多字体里是豆腐块）
  s = s.replace(/\^\{([^{}]{1,8})\}/g, (_m, b: string) => `^{${b}}`)
  s = s.replace(/\^(\w)/g, (_m, b: string) => `^{${b}}`)
  s = s.replace(/_\{([^{}]{1,8})\}/g, (_m, b: string) => `_{${b}}`)
  s = s.replace(/_(\w)/g, (_m, b: string) => `_{${b}}`)

  // 收尾：先给上下标结构占位，避免下面清括号时把它们一起删了
  const marks: string[] = []
  s = s.replace(/([_^])\{([^{}]{1,8})\}/g, (_m, sym: string, body: string) => {
    marks.push(`${sym}{${body}}`)
    return `\u0001${marks.length - 1}\u0002`
  })

  s = s.replace(/\\([a-zA-Z]+)/g, '$1')
  s = s.replace(/[{}]/g, '')

  // 还原
  s = s.replace(/\u0001(\d+)\u0002/g, (_m, i: string) => marks[Number(i)] ?? '')
  s = s.replace(/\s{2,}/g, ' ')

  return s.trim()
}