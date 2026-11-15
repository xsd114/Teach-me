/**
 * 把要念出来的文本"说人话"。
 *
 * 屏幕上看 x²−1 很清楚，但 TTS 会念成"x 上标二减一"，
 * 或者干脆跳过符号。所以念之前先翻译成口语。
 *
 * 只处理数学符号和上标，普通中文不动 —— 宁可少转，不要乱转。
 */

const SUP: Record<string, string> = {
  '²': '的平方',
  '³': '的立方',
  '⁴': '的四次方',
  '⁵': '的五次方',
  'ⁿ': '的 n 次方',
  '⁻¹': '的负一次方',
  '⁰': '的零次方',
  '¹': '的一次方',
}

/** 符号 → 念法。顺序有讲究：长的放前面，避免被短规则先吃掉 */
const SYMBOLS: [RegExp, string][] = [
  // 先处理复合符号
  [/≥/g, '大于等于'],
  [/≤/g, '小于等于'],
  [/≠/g, '不等于'],
  [/≈/g, '约等于'],
  [/≡/g, '恒等于'],
  [/→/g, '趋近于'],
  [/⇒|⟹/g, '推出'],
  [/∞/g, '无穷'],
  [/√/g, '根号'],
  [/∑/g, '求和'],
  [/∫/g, '积分'],
  [/∂/g, '偏导'],
  [/π/g, '派'],
  [/ε|ϵ/g, '伊普西龙'],
  [/δ/g, '德尔塔'],
  [/Δ/g, '德尔塔'],
  [/α/g, '阿尔法'],
  [/β/g, '贝塔'],
  [/θ/g, '西塔'],
  [/λ/g, '兰姆达'],
  [/μ/g, '缪'],
  [/σ/g, '西格玛'],
  [/∀/g, '任意'],
  [/∃/g, '存在'],

  // 运算
  [/×/g, '乘'],
  [/÷/g, '除以'],
  [/·/g, '乘'],
  [/±/g, '正负'],
  [/\^/g, '的'], // x^2 这种漏网的
]

/** 单独的 + - = 只在"像公式"的上下文里替换，避免把破折号、连字符读成"减" */
function convertOperators(s: string): string {
  return s
    .replace(/\s*\+\s*/g, ' 加 ')
    .replace(/\s*[−–](?!\d{4})\s*/g, ' 减 ') // U+2212 和 en dash，但不碰年份区间
    .replace(/(?<=[\w\u4e00-\u9fff）)])\s*-\s*(?=[\w\u4e00-\u9fff（(])/g, ' 减 ')
    .replace(/\s*=\s*/g, ' 等于 ')
    .replace(/\s*\/\s*/g, ' 除以 ')
}

/** 上标和次方 */
function convertPowers(s: string): string {
  let out = s
  for (const [k, v] of Object.entries(SUP)) {
    out = out.split(k).join(v)
  }
  // x^{2} / x^2 → x 的平方 / x 的 2 次方
  out = out.replace(/\^\s*\{?\s*2\s*\}?/g, ' 的平方')
  out = out.replace(/\^\s*\{?\s*3\s*\}?/g, ' 的立方')
  out = out.replace(/\^\s*\{?\s*([\w\d]+)\s*\}?/g, ' 的 $1 次方')
  return out
}

/** 去掉 markdown / LaTeX 残留 */
function cleanMarkup(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, '（这里有一张图）')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\[a-zA-Z]+\s*/g, '')
    .replace(/[{}]/g, '')
    .replace(/\|/g, '，')
}

export function speechify(input: string): string {
  if (!input) return ''

  let s = cleanMarkup(input)
  s = convertPowers(s)

  for (const [re, to] of SYMBOLS) {
    s = s.replace(re, to)
  }

  // 只对「含数学味」的片段转 + - = /
  // 判断依据：这一行里有数字或字母运算，或者本来就居中的公式
  s = s
    .split('\n')
    .map((line) => {
      const looksMath = /[0-9][+\-−=/×÷]|[+\-−=/×÷][0-9]|[a-zA-Z]\s*[+\-−=/]\s*[a-zA-Z0-9]/.test(line)
      return looksMath ? convertOperators(line) : line
    })
    .join('\n')

  // 收尾
  s = s
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{2,}/g, '。\n')
    .replace(/\s+([，。！？、；：])/g, '$1')
    .trim()

  return s
}
