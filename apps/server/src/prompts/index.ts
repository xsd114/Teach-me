import { all, one, run } from '../db/index.js'
import { nowIso } from '../lib/id.js'
import { PROMPTS, PROMPT_MAP, type PromptDef } from './registry.js'

/**
 * 提示词的取用与覆盖。
 *
 * 优先级：数据库里的用户改动 → 内置默认。
 * 内置默认编译进程序，所以别人装这个软件，开箱就是同一个效果。
 */

/** 把 {{var}} 换成实际值 */
function fill(tpl: string, vars: Record<string, string | number | undefined>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    const v = vars[k]
    return v === undefined || v === null ? '' : String(v)
  })
}

export function getRawPrompt(key: string): { system?: string; body: string; overridden: boolean } {
  const def = PROMPT_MAP.get(key)
  if (!def) return { body: '', overridden: false }

  const rows = all<{ field: string; value: string }>(
    `SELECT field, value FROM prompt_override WHERE key = ?`,
    key,
  )
  const ov = new Map(rows.map((r) => [r.field, r.value]))

  return {
    system: ov.get('system') ?? def.system,
    body: ov.get('body') ?? def.body,
    overridden: ov.size > 0,
  }
}

/** 渲染一条提示词，返回给 chat() 用的 messages */
export function renderPrompt(
  key: string,
  vars: Record<string, string | number | undefined> = {},
): { system: string | undefined; user: string; overridden: boolean } {
  const raw = getRawPrompt(key)
  return {
    system: raw.system ? fill(raw.system, vars) : undefined,
    user: fill(raw.body, vars),
    overridden: raw.overridden,
  }
}

/* ───────── 管理接口用 ───────── */

export type PromptView = PromptDef & {
  system: string
  body: string
  systemDefault: string
  bodyDefault: string
  overridden: boolean
}

export function listPrompts(): PromptView[] {
  return PROMPTS.map((def) => {
    const raw = getRawPrompt(def.key)
    return {
      ...def,
      system: raw.system ?? '',
      body: raw.body,
      systemDefault: def.system ?? '',
      bodyDefault: def.body,
      overridden: raw.overridden,
    }
  })
}

export function savePromptOverride(key: string, patch: { system?: string; body?: string }): boolean {
  if (!PROMPT_MAP.has(key)) return false
  const def = PROMPT_MAP.get(key)!
  const ts = nowIso()

  const put = (field: string, value: string, original: string) => {
    // 和默认一模一样就删掉覆盖，保持"没改过"的状态
    if (value.trim() === original.trim()) {
      run(`DELETE FROM prompt_override WHERE key = ? AND field = ?`, key, field)
      return
    }
    run(
      `INSERT INTO prompt_override(key, field, value, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(key, field) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      field,
      value,
      ts,
    )
  }

  if (typeof patch.system === 'string') put('system', patch.system, def.system ?? '')
  if (typeof patch.body === 'string') put('body', patch.body, def.body)
  return true
}

export function resetPrompt(key: string): boolean {
  if (!PROMPT_MAP.has(key)) return false
  run(`DELETE FROM prompt_override WHERE key = ?`, key)
  return true
}

export function resetAllPrompts(): number {
  return run(`DELETE FROM prompt_override`).changes
}

/** 给设置页显示：改过几条 */
export function promptStats(): { total: number; overridden: number } {
  const n = one<{ c: number }>(`SELECT COUNT(DISTINCT key) AS c FROM prompt_override`)
  return { total: PROMPTS.length, overridden: Number(n?.c ?? 0) }
}

export { PROMPTS }
export type { PromptDef }
