import { randomUUID } from 'node:crypto'

/** 短 ID：前缀_8位uuid片段+时间戳尾巴，够唯一又不会长到界面放不下 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}${Date.now().toString(36).slice(-4)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}
