/**
 * 讲解字数预算（服务端副本）。
 *
 * ⚠️ 与 `apps/web/src/theme.ts` 的 VERBOSITY_MAX_CHARS 必须保持一致。
 * 服务端要用它做硬截断，前端要用它做提示文案，所以两边各留一份。
 * 改这里记得改那边。
 */
export type Verbosity = 1 | 2 | 3 | 4 | 5

export const VERBOSITY_MAX_CHARS: Record<Verbosity, number> = {
  1: 1200,
  2: 2000,
  3: 3200,
  4: 4500,
  5: 6000,
}

export const VERBOSITY_MAX_POINTS: Record<Verbosity, number> = {
  1: 2,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
}

/** 例题单步字数上限 */
export const STEP_MAX_CHARS = 60

/**
 * 硬截断：模型不听字数预算时，服务端兜底。
 * 尽量在句末断，避免切一半。
 */
export function clampText(text: string, maxChars: number): string {
  const s = text.replace(/\r\n/g, '\n').trim()
  if (s.length <= maxChars) return s
  const cut = s.slice(0, maxChars)
  const lastStop = Math.max(
    cut.lastIndexOf('。'),
    cut.lastIndexOf('\n'),
    cut.lastIndexOf('！'),
    cut.lastIndexOf('？'),
    cut.lastIndexOf('. '),
  )
  if (lastStop > maxChars * 0.55) return cut.slice(0, lastStop + 1).trim()
  return cut.trim() + '…'
}
