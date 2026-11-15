/**
 * ALP 设计令牌 · TypeScript 侧
 *
 * 颜色**不在这里定义** —— 唯一来源是 src/index.css 里的 @theme 块。
 * 这里只导出：
 *   1) CSS 变量的语义别名（给 Recharts 之类需要字符串的地方用）
 *   2) 与视觉无关的业务常量（话痨档位、字数预算等）
 *
 * 想在组件里用颜色：优先 Tailwind 类（bg-surface / text-ink / border-line）；
 * 必须用字符串时，用下面的 cssVar.*，永远不要写 #rrggbb。
 */

export const cssVar = {
  base: 'var(--color-base)',
  surface: 'var(--color-surface)',
  surface2: 'var(--color-surface-2)',
  surface3: 'var(--color-surface-3)',
  line: 'var(--color-line)',
  lineStrong: 'var(--color-line-strong)',
  ink: 'var(--color-ink)',
  inkDim: 'var(--color-ink-dim)',
  inkMute: 'var(--color-ink-mute)',
  accent: 'var(--color-accent)',
  accentHover: 'var(--color-accent-hover)',
  ok: 'var(--color-ok)',
  warn: 'var(--color-warn)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)',
} as const

/** 图表配色序列：主色打头，其余为低饱和辅助色，保证深色背景下不刺眼 */
export const chartPalette = [
  cssVar.accent,
  '#7c9fd4',
  '#8fb98a',
  '#c98b8b',
  '#a48cc4',
  '#c9b083',
] as const

/* ------------------------------------------------------------------
   教学字数预算（你定的硬要求：字多稀释质量，人懒得看）
   ------------------------------------------------------------------ */
export type Verbosity = 1 | 2 | 3 | 4 | 5

export const VERBOSITY_LABEL: Record<Verbosity, string> = {
  1: '极简',
  2: '简洁',
  3: '适中（默认）',
  4: '详细',
  5: '话痨',
}

/** 单节讲解正文上限（汉字数） */
export const VERBOSITY_MAX_CHARS: Record<Verbosity, number> = {
  1: 1200,
  2: 2000,
  3: 3200,
  4: 4500,
  5: 6000,
}

/** 单节要点条数上限 */
export const VERBOSITY_MAX_POINTS: Record<Verbosity, number> = {
  1: 2,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
}

/** 例题单步字数上限 */
export const STEP_MAX_CHARS = 60

/** 记忆库阈值（见 DECISIONS D16） */
export const MEMORY_THRESHOLD = {
  /** 低于此字数：不建议开向量库，全文直塞 */
  offBelowChars: 30_000,
  /** 低于此文件数：同上 */
  offBelowFiles: 3,
  /** 高于此字数：强制开启 */
  forceAboveChars: 150_000,
  /** 高于此文件数：强制开启 */
  forceAboveFiles: 20,
} as const

/* ------------------------------------------------------------------
   路由与端口
   ------------------------------------------------------------------ */
export const API_BASE = '/api'
export const DEV_WEB_PORT = 5273
export const DEV_API_PORT = 5274
