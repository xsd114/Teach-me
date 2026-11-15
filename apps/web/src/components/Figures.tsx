import { useMemo, useState } from 'react'
import { sample } from '../lib/expr'

/* ============================================================
   图的统一入口。
   教材/讲解里的 ```figure 块解析成 JSON 后交给这里。
   ============================================================ */

export type FigureSpec =
  | {
      type: 'plot'
      title?: string
      caption?: string
      /** 用 x 作自变量，可带参数 */
      expr: string
      /** 参数滑块定义 */
      params?: { name: string; min?: number; max?: number; step?: number; value?: number; label?: string }[]
      /** x 轴范围 */
      range?: [number, number]
      /** y 轴范围，不填自适应 */
      yRange?: [number, number]
      /** 额外曲线（对比用） */
      compare?: string
      /** 标记点 */
      points?: { x: number; y?: number; label?: string }[]
      /** 是否画切线 */
      tangentAt?: number
    }
  | {
      type: 'svg'
      title?: string
      caption?: string
      /** 模型产出的 SVG 源码（会做白名单清洗） */
      svg: string
    }
  | {
      type: 'wordcard'
      title?: string
      caption?: string
      items: { word: string; phon?: string; meaning: string; example?: string; hint?: string }[]
    }

export function Figure({ spec }: { spec: FigureSpec }) {
  if (spec.type === 'plot') return <PlotFigure spec={spec} />
  if (spec.type === 'svg') return <SvgFigure spec={spec} />
  if (spec.type === 'wordcard') return <WordCard spec={spec} />
  return null
}

/* ============================================================
   函数图：可拖参数，曲线实时重算
   ============================================================ */

const W = 520
const H = 260
const PAD = 34

function PlotFigure({ spec }: { spec: Extract<FigureSpec, { type: 'plot' }> }) {
  const [vals, setVals] = useState<Record<string, number>>(() => {
    const v: Record<string, number> = {}
    for (const p of spec.params ?? []) v[p.name] = p.value ?? 1
    return v
  })

  const [xMin, xMax] = spec.range ?? [-6, 6]

  const env = useMemo(() => ({ ...vals }), [vals])
  const pts = useMemo(() => sample(spec.expr, xMin, xMax, env), [spec.expr, xMin, xMax, env])
  const cmp = useMemo(
    () => (spec.compare ? sample(spec.compare, xMin, xMax, env) : []),
    [spec.compare, xMin, xMax, env],
  )

  // y 范围
  const yAuto = useMemo(() => {
    const ys = pts.map((p) => p[1]).filter((y) => Number.isFinite(y))
    if (ys.length === 0) return [-5, 5] as [number, number]
    const lo = Math.min(...ys)
    const hi = Math.max(...ys)
    const span = Math.max(1, hi - lo)
    return [lo - span * 0.12, hi + span * 0.12] as [number, number]
  }, [pts])

  const [yMin, yMax] = spec.yRange ?? yAuto

  const sx = (x: number) => PAD + ((x - xMin) / (xMax - xMin)) * (W - PAD * 2)
  const sy = (y: number) => H - PAD - ((y - yMin) / (yMax - yMin)) * (H - PAD * 2)

  const path = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`)
    .join(' ')

  const cmpPath = cmp
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`)
    .join(' ')

  // 零轴
  const xAxisY = sy(Math.max(yMin, Math.min(yMax, 0)))
  const yAxisX = sx(Math.max(xMin, Math.min(xMax, 0)))

  // 切线
  let tangent: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (typeof spec.tangentAt === 'number') {
    const tx = spec.tangentAt
    const h = 1e-4
    const y0 = sample(spec.expr, tx - h, tx + h, env, 3)
    if (y0.length >= 2) {
      const slope = (y0[2][1] - y0[0][1]) / (y0[2][0] - y0[0][0])
      const yAt = y0[1][1]
      const dx = (xMax - xMin) * 0.18
      tangent = {
        x1: sx(tx - dx),
        y1: sy(yAt - slope * dx),
        x2: sx(tx + dx),
        y2: sy(yAt + slope * dx),
      }
    }
  }

  return (
    <figure className="my-4 overflow-hidden rounded-lg border border-line bg-surface">
      {spec.title && (
        <figcaption className="border-b border-line px-3 py-1.5 text-2xs font-medium text-ink-dim">
          {spec.title}
        </figcaption>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block w-full" style={{ maxWidth: 660 }}>
        {/* 网格 */}
        {gridLines(xMin, xMax, 8).map((x) => (
          <line
            key={`gx${x}`}
            x1={sx(x)}
            y1={PAD}
            x2={sx(x)}
            y2={H - PAD}
            stroke="var(--color-line)"
            strokeWidth={1}
          />
        ))}
        {gridLines(yMin, yMax, 5).map((y) => (
          <line
            key={`gy${y}`}
            x1={PAD}
            y1={sy(y)}
            x2={W - PAD}
            y2={sy(y)}
            stroke="var(--color-line)"
            strokeWidth={1}
          />
        ))}

        {/* 轴 */}
        <line x1={PAD} y1={xAxisY} x2={W - PAD} y2={xAxisY} stroke="var(--color-line-strong)" strokeWidth={1.2} />
        <line x1={yAxisX} y1={PAD} x2={yAxisX} y2={H - PAD} stroke="var(--color-line-strong)" strokeWidth={1.2} />

        {/* 刻度 */}
        {gridLines(xMin, xMax, 8)
          .filter((x) => Math.abs(x) > 1e-9)
          .map((x) => (
            <text key={`tx${x}`} x={sx(x)} y={xAxisY + 12} textAnchor="middle" fontSize="9" fill="var(--color-ink-mute)">
              {fmt(x)}
            </text>
          ))}
        {gridLines(yMin, yMax, 5)
          .filter((y) => Math.abs(y) > 1e-9)
          .map((y) => (
            <text key={`ty${y}`} x={yAxisX - 5} y={sy(y) + 3} textAnchor="end" fontSize="9" fill="var(--color-ink-mute)">
              {fmt(y)}
            </text>
          ))}

        {/* 对比曲线 */}
        {cmpPath && (
          <path d={cmpPath} fill="none" stroke="var(--color-ink-mute)" strokeWidth={1.4} strokeDasharray="4 3" opacity={0.7} />
        )}

        {/* 主曲线 */}
        <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2.1} strokeLinecap="round" />

        {/* 切线 */}
        {tangent && (
          <line
            x1={tangent.x1}
            y1={tangent.y1}
            x2={tangent.x2}
            y2={tangent.y2}
            stroke="var(--color-info)"
            strokeWidth={1.4}
            strokeDasharray="5 3"
          />
        )}

        {/* 标记点 */}
        {(spec.points ?? []).map((p, i) => {
          const y = p.y ?? 0
          return (
            <g key={i}>
              <circle cx={sx(p.x)} cy={sy(y)} r={3} fill="var(--color-danger)" />
              {p.label && (
                <text x={sx(p.x) + 6} y={sy(y) - 6} fontSize="9" fill="var(--color-ink-dim)">
                  {p.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* 参数滑块 */}
      {(spec.params ?? []).length > 0 && (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          {(spec.params ?? []).map((p) => {
            const min = p.min ?? -3
            const max = p.max ?? 3
            const step = p.step ?? 0.1
            return (
              <div key={p.name} className="flex items-center gap-2">
                <code className="w-10 shrink-0 font-mono text-2xs text-accent">{p.name}</code>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={vals[p.name] ?? 0}
                  onChange={(e) => setVals((v) => ({ ...v, [p.name]: Number(e.target.value) }))}
                  className="h-1 flex-1 accent-[var(--color-accent)]"
                />
                <span className="w-10 shrink-0 text-right text-2xs tabular-nums text-ink-dim">
                  {(vals[p.name] ?? 0).toFixed(1)}
                </span>
              </div>
            )
          })}
          <p className="text-2xs text-ink-mute">
            拖一下滑块，看曲线怎么变 · <code className="font-mono">y = {spec.expr}</code>
          </p>
        </div>
      )}
      {!(spec.params ?? []).length && spec.caption && (
        <p className="border-t border-line px-3 py-1.5 text-2xs text-ink-mute">{spec.caption}</p>
      )}
    </figure>
  )
}

function gridLines(min: number, max: number, count: number): number[] {
  const step = niceStep((max - min) / count)
  const start = Math.ceil(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)))
  return out
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)))
  const n = raw / pow
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return mult * pow
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

/* ============================================================
   AI 生成的 SVG 示意图
   ============================================================ */

/** 只放行安全的 SVG 子集：去掉 script / 事件属性 / 外链 */
function sanitizeSvg(raw: string): string {
  let s = raw.trim()
  const start = s.indexOf('<svg')
  if (start > 0) s = s.slice(start)
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\s(href|xlink:href)\s*=\s*("[^"]*"|'[^']*')/gi, '')
}

function SvgFigure({ spec }: { spec: Extract<FigureSpec, { type: 'svg' }> }) {
  const html = useMemo(() => sanitizeSvg(spec.svg), [spec.svg])
  return (
    <figure className="my-4 overflow-hidden rounded-lg border border-line bg-surface">
      {spec.title && (
        <figcaption className="border-b border-line px-3 py-1.5 text-2xs font-medium text-ink-dim">
          {spec.title}
        </figcaption>
      )}
      <div
        className="mx-auto flex items-center justify-center bg-white/[0.02] p-3 [&_svg]:h-auto [&_svg]:w-full"
        style={{ maxWidth: 720 }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {spec.caption && <p className="border-t border-line px-3 py-1.5 text-2xs text-ink-mute">{spec.caption}</p>}
    </figure>
  )
}

/* ============================================================
   单词卡（英语等）
   ============================================================ */

function WordCard({ spec }: { spec: Extract<FigureSpec, { type: 'wordcard' }> }) {
  return (
    <figure className="my-4 overflow-hidden rounded-lg border border-line bg-surface">
      {spec.title && (
        <figcaption className="border-b border-line px-3 py-1.5 text-2xs font-medium text-ink-dim">
          {spec.title}
        </figcaption>
      )}
      <div className="grid gap-px bg-line sm:grid-cols-2">
        {spec.items.map((it, i) => (
          <div key={i} className="bg-surface px-3 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-ink">{it.word}</span>
              {it.phon && <span className="font-mono text-2xs text-ink-mute">{it.phon}</span>}
            </div>
            <p className="mt-0.5 text-2xs text-ink-dim">{it.meaning}</p>
            {it.example && (
              <p className="mt-1 border-l-2 border-line-strong pl-2 text-2xs leading-relaxed text-ink-mute">
                {it.example}
              </p>
            )}
            {it.hint && <p className="mt-1 text-2xs text-accent/80">{it.hint}</p>}
          </div>
        ))}
      </div>
      {spec.caption && <p className="border-t border-line px-3 py-1.5 text-2xs text-ink-mute">{spec.caption}</p>}
    </figure>
  )
}
