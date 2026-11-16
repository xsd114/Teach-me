/**
 * 日志落盘。
 *
 * 为什么自己写：pino 默认往 stdout 打，打包成 Electron 之后子进程的 stdout 进了父进程管道，
 * 用户机器上一个字节都留不下来 —— 出了事只能靠猜。这里做三件事：
 *
 *   1. 把 stdout / stderr 全量 tee 到 `ALP_HOME/logs/server-YYYY-MM-DD.log`（按天切）
 *   2. 内存里留最近 RING_MAX 行，导出诊断时不用读盘，也不怕文件被删
 *   3. 接住 uncaughtException / unhandledRejection，单独写 `crash-*.log`
 *
 * 保留策略：14 天或 24MB 封顶，超了从最旧的删。
 */
import fs from 'node:fs'
import path from 'node:path'
import { ensureDirs, LOGS_DIR } from '../config.js'

const KEEP_DAYS = 14
const MAX_TOTAL_BYTES = 24 * 1024 * 1024
/** 内存里留多少行（导诊断时直接用，不读盘） */
const RING_MAX = 1500

export type LogKind = 'server' | 'app' | 'client' | 'crash'
export type RingLine = { at: string; level: 'info' | 'warn' | 'error'; text: string }

const ring: RingLine[] = []
const streams = new Map<LogKind, fs.WriteStream>()

let installed = false

function day(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function time(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

export function logFileOf(kind: LogKind): string {
  return path.join(LOGS_DIR, `${kind}-${day()}.log`)
}

function streamOf(kind: LogKind): fs.WriteStream | null {
  try {
    ensureDirs()
    const file = logFileOf(kind)
    const cached = streams.get(kind)
    // 跨天要换文件，不然一整年都写同一个名字
    if (cached && cached.path === file) return cached
    cached?.end()
    const s = fs.createWriteStream(file, { flags: 'a' })
    s.on('error', () => streams.delete(kind))
    streams.set(kind, s)
    return s
  } catch {
    return null
  }
}

/** pino 的 level 数字 → 我们的三档 */
function levelOf(n: number): RingLine['level'] {
  if (n >= 50) return 'error'
  if (n >= 40) return 'warn'
  return 'info'
}

/** 从一行里尽量榨出「级别 + 正文」，拿不到就按原文存 */
function parseLine(raw: string): { level: RingLine['level']; text: string } {
  const t = raw.trim()
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(t) as { level?: number; msg?: string; err?: { message?: string; stack?: string } }
      const msg = [o.msg, o.err?.message].filter(Boolean).join(' · ') || t
      return { level: levelOf(Number(o.level ?? 30)), text: msg.slice(0, 1200) }
    } catch {
      /* 不是 JSON，按纯文本处理 */
    }
  }
  const low = t.toLowerCase()
  const level: RingLine['level'] =
    low.includes(' error') || low.startsWith('error') || low.includes('[alp] 启动失败') ? 'error' : low.includes('warn') ? 'warn' : 'info'
  return { level, text: t.slice(0, 1200) }
}

/** 往某个文件追加一行，同时进内存环 */
export function appendLine(kind: LogKind, raw: string, level?: RingLine['level']): void {
  const text = String(raw ?? '').replace(/\r?\n+$/, '')
  if (!text) return
  const parsed = level ? { level, text } : parseLine(text)
  ring.push({ at: `${day()} ${time()}`, level: parsed.level, text: parsed.text })
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX)

  const s = streamOf(kind)
  if (!s) return
  try {
    s.write(raw.endsWith('\n') ? raw : `${raw}\n`)
  } catch {
    /* 磁盘满了不该把服务带崩 */
  }
}

function appendBlock(kind: LogKind, title: string, detail: unknown): void {
  const err = detail instanceof Error ? detail : null
  const head = `[${day()} ${time()}] ${title}`
  const body = err
    ? `${head}\n${err.stack || `${err.name}: ${err.message}`}`
    : `${head} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
  appendLine(kind, body, 'error')
}

/** 把 stdout / stderr / 崩溃都接过来（只装一次） */
export function startFileLogging(): void {
  if (installed) return
  installed = true
  ensureDirs()

  // 今日第一次写之前，先把过期的清掉
  void pruneLogs()

  try {
    const origOut = process.stdout.write.bind(process.stdout)
    const origErr = process.stderr.write.bind(process.stderr)
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      try {
        appendLine('server', String(chunk))
      } catch {
        /* ignore */
      }
      return (origOut as (...a: unknown[]) => boolean)(chunk, ...rest)
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
      try {
        appendLine('server', String(chunk))
      } catch {
        /* ignore */
      }
      return (origErr as (...a: unknown[]) => boolean)(chunk, ...rest)
    }) as typeof process.stderr.write
  } catch {
    /* 拿不到就只留崩溃日志 */
  }

  // 不 exit：进程活着用户才导得出日志。真正致命的错误 Fastify 的 errorHandler 已经兜了一层。
  process.on('uncaughtException', (e) => appendBlock('crash', '未捕获异常', e))
  process.on('unhandledRejection', (r) => appendBlock('crash', '未处理的 Promise 拒绝', r as Error))
  // 不监听 process.on('warning')：Node 自己会把警告打到 stderr，再听一遍等于每行记两次

  appendLine(
    'server',
    `[${day()} ${time()}] —— 日志开始（pid ${process.pid}，node ${process.version}，${process.platform}）`,
    'info',
  )
}

/** 主进程（Electron）写自己的日志用，包里只有一份实现，省得两边逻辑跑偏 */
export function logFromHost(line: string, level: RingLine['level'] = 'info'): void {
  appendLine('app', `[${day()} ${time()}] ${line}`, level)
}

/* ── 读取 / 清理 ── */

export function readRing(limit = RING_MAX): RingLine[] {
  return ring.slice(Math.max(0, ring.length - limit))
}

export type LogFileInfo = { name: string; kind: string; bytes: number; mtime: string }

export function listLogs(): LogFileInfo[] {
  try {
    ensureDirs()
    return fs
      .readdirSync(LOGS_DIR)
      .filter((f) => f.endsWith('.log') || f.endsWith('.txt'))
      .map((f) => {
        const st = fs.statSync(path.join(LOGS_DIR, f))
        return {
          name: f,
          kind: f.split('-')[0],
          bytes: st.size,
          mtime: st.mtime.toISOString(),
        }
      })
      .sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
  } catch {
    return []
  }
}

/** 读某个日志的尾巴（导出诊断时塞进去） */
export function readTail(name: string, lines = 200): string {
  try {
    const p = path.join(LOGS_DIR, path.basename(name))
    if (!fs.existsSync(p)) return ''
    const all = fs.readFileSync(p, 'utf8').split(/\r?\n/)
    return all.slice(Math.max(0, all.length - lines)).join('\n')
  } catch {
    return ''
  }
}

export function clearLogs(): { removed: number; freedBytes: number } {
  let removed = 0
  let freedBytes = 0
  try {
    ensureDirs()
    for (const f of fs.readdirSync(LOGS_DIR)) {
      if (!f.endsWith('.log') && !f.endsWith('.txt')) continue
      // 正在写的那个不删（Windows 上也删不掉）
      if (f === path.basename(logFileOf('server'))) continue
      const p = path.join(LOGS_DIR, f)
      try {
        freedBytes += fs.statSync(p).size
        fs.unlinkSync(p)
        removed += 1
      } catch {
        /* 被占用就跳过 */
      }
    }
  } catch {
    /* ignore */
  }
  return { removed, freedBytes }
}

/** 14 天 / 24MB 两条线，超了从最旧的删 */
export async function pruneLogs(): Promise<void> {
  try {
    ensureDirs()
    const files = fs
      .readdirSync(LOGS_DIR)
      .filter((f) => f.endsWith('.log'))
      .map((f) => {
        const p = path.join(LOGS_DIR, f)
        const st = fs.statSync(p)
        return { p, f, bytes: st.size, mtime: st.mtimeMs }
      })
      .sort((a, b) => a.mtime - b.mtime)

    const cutoff = Date.now() - KEEP_DAYS * 86_400_000
    let total = files.reduce((n, f) => n + f.bytes, 0)

    for (const f of files) {
      if (f.f === path.basename(logFileOf('server'))) continue
      const tooOld = f.mtime < cutoff
      const tooBig = total > MAX_TOTAL_BYTES
      if (!tooOld && !tooBig) continue
      try {
        fs.unlinkSync(f.p)
        total -= f.bytes
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export const LOGS_DIR_PATH = LOGS_DIR
export const LOG_RING_SIZE = RING_MAX
