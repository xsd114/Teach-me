/**
 * 前端报错回传。
 *
 * 目的很朴素：用户说「它崩了」的时候，我们手里得有点东西。
 * 这里接住三类错误，写到服务端 logs/client-*.log：
 *   · window.onerror          —— 同步脚本错误
 *   · unhandledrejection      —— 没人 catch 的 Promise
 *   · <ErrorBoundary>         —— React 渲染期抛错（白屏的常见原因）
 *
 * 限流：一次会话最多回传 20 条，同一条消息不重复报（一个坏循环能刷出几万条）。
 */
import { diagnosticsApi } from './api'

const MAX_PER_SESSION = 20
const seen = new Set<string>()
let sent = 0

export function reportClientError(kind: string, err: unknown, extra?: { url?: string }): void {
  let message = ''
  let stack = ''

  if (err instanceof Error) {
    message = `${err.name}: ${err.message}`
    stack = err.stack ?? ''
  } else if (typeof err === 'string') {
    message = err
  } else {
    try {
      message = JSON.stringify(err)
    } catch {
      message = String(err)
    }
  }
  if (!message) return

  // 同一条只报一次；总量封顶
  const key = `${kind}|${message.slice(0, 120)}`
  if (seen.has(key) || sent >= MAX_PER_SESSION) return
  seen.add(key)
  sent += 1

  void diagnosticsApi.clientError({
    kind,
    message: message.slice(0, 1000),
    stack: stack.slice(0, 4000),
    url: extra?.url ?? window.location.href,
    at: new Date().toISOString(),
  })
}

/** 在 main.tsx 里调一次，接管全局错误 */
export function installErrorReporting(): void {
  window.addEventListener('error', (e) => {
    reportClientError('window.onerror', e.error ?? e.message)
  })
  window.addEventListener('unhandledrejection', (e) => {
    reportClientError('unhandledrejection', e.reason)
  })
  // 资源加载失败（图片、字体、chunk）也给一条，白屏经常是 chunk 加载失败
  window.addEventListener(
    'error',
    (e) => {
      const t = e.target as HTMLElement | null
      if (t && t !== (window as unknown as HTMLElement) && 'src' in t) {
        const src = (t as HTMLImageElement).src || (t as HTMLScriptElement).src
        reportClientError('resource.load', new Error(`资源加载失败：${src}`))
      }
    },
    true,
  )
}
