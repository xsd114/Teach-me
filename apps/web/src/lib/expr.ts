/**
 * 极小的数学表达式求值器（递归下降）。
 *
 * 为什么不用 mathjs / eval：
 *   - eval 直接执行任意代码，教材里的表达式是模型产出的，不能信；
 *   - mathjs 打包 500KB+，只为一个函数图不值。
 *
 * 支持：数字、变量 x 与自定义参数、+ - * / ^、括号、常见函数
 *      sin cos tan asin acos atan sqrt abs exp ln log log10 floor ceil round min max
 *      常量 pi e
 */

export type Env = Record<string, number>

type Node = (env: Env) => number

const FUNCS: Record<string, (n: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
}

const CONSTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
}

class Parser {
  private i = 0
  constructor(private s: string) {}

  private ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++
  }

  private peek(): string {
    this.ws()
    return this.s[this.i] ?? ''
  }

  private eat(ch: string): boolean {
    if (this.peek() === ch) {
      this.i++
      return true
    }
    return false
  }

  parse(): Node {
    const node = this.expr()
    this.ws()
    if (this.i < this.s.length) throw new Error(`表达式有多余字符：${this.s.slice(this.i)}`)
    return node
  }

  private expr(): Node {
    let left = this.term()
    for (;;) {
      if (this.eat('+')) {
        const r = this.term()
        const l = left
        left = (e) => l(e) + r(e)
      } else if (this.eat('-')) {
        const r = this.term()
        const l = left
        left = (e) => l(e) - r(e)
      } else return left
    }
  }

  private term(): Node {
    let left = this.unary()
    for (;;) {
      if (this.eat('*')) {
        const r = this.unary()
        const l = left
        left = (e) => l(e) * r(e)
      } else if (this.eat('/')) {
        const r = this.unary()
        const l = left
        left = (e) => {
          const d = r(e)
          return d === 0 ? NaN : l(e) / d
        }
      } else return left
    }
  }

  private unary(): Node {
    if (this.eat('-')) {
      const n = this.unary()
      return (e) => -n(e)
    }
    if (this.eat('+')) return this.unary()
    return this.power()
  }

  private power(): Node {
    const base = this.primary()
    if (this.eat('^')) {
      const exp = this.unary() // 右结合
      return (e) => Math.pow(base(e), exp(e))
    }
    return base
  }

  private primary(): Node {
    this.ws()
    const ch = this.s[this.i]

    if (ch === '(') {
      this.i++
      const n = this.expr()
      if (!this.eat(')')) throw new Error('括号没闭合')
      return n
    }

    if (/[0-9.]/.test(ch)) {
      let num = ''
      while (this.i < this.s.length && /[0-9.]/.test(this.s[this.i])) num += this.s[this.i++]
      const v = Number(num)
      if (!Number.isFinite(v)) throw new Error(`数字写错了：${num}`)
      return () => v
    }

    if (/[a-zA-Z_]/.test(ch)) {
      let id = ''
      while (this.i < this.s.length && /[a-zA-Z0-9_]/.test(this.s[this.i])) id += this.s[this.i++]
      const lower = id.toLowerCase()

      // 函数调用
      if (this.peek() === '(') {
        this.i++
        const arg = this.expr()
        if (!this.eat(')')) throw new Error('括号没闭合')
        const f = FUNCS[lower]
        if (f) return (e) => f(arg(e))
        if (lower === 'min' || lower === 'max') {
          // min(a,b) / max(a,b)：再吃一个参数
          if (!this.eat(',')) return arg
          const b = this.expr()
          if (!this.eat(')')) throw new Error('括号没闭合')
          const a = arg
          return lower === 'min' ? (e) => Math.min(a(e), b(e)) : (e) => Math.max(a(e), b(e))
        }
        throw new Error(`不认识的函数：${id}`)
      }

      if (lower in CONSTS) {
        const v = CONSTS[lower]
        return () => v
      }
      if (lower === 'x') return (e) => e.x ?? 0
      return (e) => e[id] ?? e[lower] ?? 0
    }

    throw new Error(`看不懂这段表达式：${this.s.slice(this.i, this.i + 20)}`)
  }
}

export function compileExpr(src: string): (env: Env) => number {
  const cleaned = src
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/π/g, 'pi')
    .trim()
  if (!cleaned) return () => NaN
  return new Parser(cleaned).parse()
}

/** 批量采样，返回 [x, y] 数组（跳过非有限值） */
export function sample(expr: string, xMin: number, xMax: number, env: Env, n = 420): [number, number][] {
  let fn: (e: Env) => number
  try {
    fn = compileExpr(expr)
  } catch {
    return []
  }
  const out: [number, number][] = []
  const step = (xMax - xMin) / (n - 1)
  for (let i = 0; i < n; i++) {
    const x = xMin + i * step
    const y = fn({ ...env, x })
    if (Number.isFinite(y)) out.push([x, y])
  }
  return out
}
