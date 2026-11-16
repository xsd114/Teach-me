/**
 * 诊断包：用户点了「生成日志」，这里把能说明问题的东西全捞出来。
 *
 * 原则：
 *   1. **绝不带密钥**。llmConfig() 会把 apiKey 原样返回，这里只取 keyHint（****1234）
 *   2. 能看懂：先给人读的 txt（可以直接贴 issue），再附机器读的 JSON 段
 *   3. 不猜：拿不到的东西写「未知」，不编一个看起来正常的值
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { all, one } from '../db/index.js'
import {
  ALP_HOME,
  APP_VERSION,
  CACHE_DIR,
  DB_PATH,
  IS_DEV,
  LOGS_DIR,
  MODELS_DIR,
  UPLOADS_DIR,
} from '../config.js'
import { llmConfig, hasApiKey } from './llm.js'
import { mossConfig, liveStatus } from './mossLive.js'
import { probePython } from '../lib/python.js'
import { vectorStatus, vectorCount, configuredDims } from './vectorStore.js'
import { localModelId, embedProvider } from './vector.js'
import { getDb } from '../db/index.js'
import { listLogs, logFileOf, readRing, readTail, type LogFileInfo } from '../lib/logfile.js'

export type DiagnosticsBundle = {
  generatedAt: string
  filename: string
  filePath: string
  bytes: number
  text: string
}

/** 万一哪天真的把 key 塞进来了，这里再兜一层 */
export function redact(input: string): string {
  return input
    .replace(/(sk|pk|ak)-[A-Za-z0-9_-]{8,}/g, '$1-***')
    .replace(/("?(?:api_?key|token|secret|password)"?\s*[:=]\s*"?)([^\s",}]{4,})/gi, '$1***')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/g, '$1***')
}

function mask(key: string): string {
  const k = key.trim()
  if (!k) return ''
  return k.length <= 8 ? '****' : `****${k.slice(-4)}`
}

function humanBytes(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function safeSize(p: string): number {
  try {
    return fs.statSync(p).size
  } catch {
    return 0
  }
}

function dbVersion(): number {
  try {
    const row = one<{ v: number | null }>(`SELECT MAX(version) AS v FROM schema_migration`)
    return Number(row?.v ?? 0)
  } catch {
    return 0
  }
}

function counts(): Record<string, number> {
  const q = (sql: string): number => {
    try {
      return Number(one<{ n: number }>(sql)?.n ?? 0)
    } catch {
      return -1
    }
  }
  return {
    course: q(`SELECT COUNT(*) AS n FROM course`),
    lesson: q(`SELECT COUNT(*) AS n FROM lesson`),
    material: q(`SELECT COUNT(*) AS n FROM material`),
    chunk: q(`SELECT COUNT(*) AS n FROM chunk`),
    textbook: q(`SELECT COUNT(*) AS n FROM textbook`),
    chapter: q(`SELECT COUNT(*) AS n FROM textbook_chapter`),
    annotation: q(`SELECT COUNT(*) AS n FROM annotation`),
    question: q(`SELECT COUNT(*) AS n FROM question`),
    mistake: q(`SELECT COUNT(*) AS n FROM mistake`),
    qaThread: q(`SELECT COUNT(*) AS n FROM qa_thread`),
  }
}

/** 失败的资料最值得看：用户常抱怨「传了没反应」 */
function failedMaterials(): { name: string; error: string }[] {
  try {
    return all<{ name: string; error: string; stage: string }>(
      `SELECT name, COALESCE(error,'') AS error, COALESCE(stage,'') AS stage
         FROM material WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 10`,
    ).map((m) => ({ name: m.name, error: m.error || m.stage || '（没记错误信息）' }))
  } catch {
    return []
  }
}

function recentTeachingLogs(): string[] {
  try {
    return all<{ pace: string | null; reason: string | null; created: string }>(
      `SELECT pace, reason, COALESCE(ended_at, started_at) AS created
         FROM teaching_log ORDER BY started_at DESC LIMIT 5`,
    ).map((r) => `${r.created ?? ''} · ${r.pace ?? '—'} · ${r.reason ?? ''}`)
  } catch {
    return []
  }
}

/** 每次启动都会出现、但不算问题的行（列在诊断里只会把真错误挤下去） */
const NOISE = ['ExperimentalWarning', 'FastifyDeprecation', '--trace-warnings', 'DeprecationWarning']

export type DiagnosticsInfo = {
  generatedAt: string
  app: Record<string, string | number | boolean>
  paths: Record<string, string>
  db: { version: number; sizeBytes: number; counts: Record<string, number> }
  model: Record<string, string | number | boolean>
  voice: Record<string, string | boolean>
  parse: Record<string, string | boolean>
  vector: Record<string, string | number | boolean>
  logs: { files: LogFileInfo[]; ringLines: number; errors: number }
  problems: { failedMaterials: { name: string; error: string }[]; teaching: string[]; recentErrors: string[] }
}

/** 收集一份结构化诊断（不落盘，用来预览/复制） */
export async function collectDiagnostics(): Promise<DiagnosticsInfo> {
  const cfg = llmConfig()
  const moss = mossConfig()
  let parse: Record<string, string | boolean> = { python: false, markitdown: false, note: '探测失败' }
  try {
    const p = await probePython()
    parse = {
      python: Boolean(p.python),
      markitdown: Boolean(p.markitdown),
      version: String(p.version ?? ''),
    }
  } catch {
    /* 保留默认 */
  }

  let vector: Record<string, string | number | boolean> = { ready: false }
  try {
    const st = vectorStatus()
    vector = {
      ready: st.ready,
      dims: st.dims || configuredDims(),
      error: st.error || '',
      model: localModelId(),
      provider: embedProvider(),
      vectors: (() => {
        try {
          return vectorCount(getDb())
        } catch {
          return -1
        }
      })(),
    }
  } catch {
    /* ignore */
  }

  const ring = readRing(400)
  const recentErrors = ring
    .filter((l) => l.level === 'error' || l.level === 'warn')
    // 这两类每次启动都有，属于噪音；留着会把真错误挤出去
    .filter((l) => !NOISE.some((n) => l.text.includes(n)))
    .slice(-25)
    .map((l) => `${l.at} [${l.level}] ${l.text}`)

  return {
    generatedAt: new Date().toISOString(),
    app: {
      version: APP_VERSION,
      env: IS_DEV ? 'development' : 'production',
      node: process.version,
      electron: process.env.ALP_ELECTRON_VERSION || '',
      platform: `${process.platform} ${process.arch}`,
      osRelease: `${os.type()} ${os.release()}`,
      osUptimeMin: Math.round(os.uptime() / 60),
      pid: process.pid,
      uptimeMin: Math.round(process.uptime() / 60),
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    paths: {
      home: ALP_HOME,
      db: DB_PATH,
      uploads: UPLOADS_DIR,
      cache: CACHE_DIR,
      models: MODELS_DIR,
      logs: LOGS_DIR,
    },
    db: {
      version: dbVersion(),
      sizeBytes: safeSize(DB_PATH),
      counts: counts(),
    },
    model: {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      hasKey: hasApiKey(),
      keyHint: mask(cfg.apiKey),
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
    },
    voice: {
      configured: Boolean(moss.apiKey),
      keyHint: mask(moss.apiKey),
      model: moss.model,
      enabled: moss.enabled,
      voiceId: moss.voiceId,
      lastError: (() => {
        try {
          return String(liveStatus().lastError ?? '')
        } catch {
          return ''
        }
      })(),
    },
    parse,
    vector,
    logs: {
      files: listLogs().slice(0, 20),
      ringLines: ring.length,
      errors: recentErrors.length,
    },
    problems: {
      failedMaterials: failedMaterials(),
      teaching: recentTeachingLogs(),
      recentErrors,
    },
  }
}

/** 结构化诊断 → 人读的 txt（贴 issue 直接能用） */
export function renderDiagnostics(d: DiagnosticsInfo): string {
  const L: string[] = []
  const kv = (k: string, v: unknown) => L.push(`  ${k.padEnd(14, ' ')} ${String(v ?? '—')}`)

  L.push('Teach me 诊断报告')
  L.push('='.repeat(60))
  L.push(`生成时间  ${d.generatedAt}`)
  L.push('')

  L.push('【基本信息】')
  kv('版本', d.app.version)
  kv('环境', d.app.env)
  kv('Node', d.app.node)
  kv('Electron', d.app.electron || '（浏览器里打开，没有）')
  kv('系统', `${d.app.platform} · ${d.app.osRelease}`)
  kv('进程', `pid ${d.app.pid} · 跑了 ${d.app.uptimeMin} 分钟 · 内存 ${d.app.rssMB}MB`)
  L.push('')

  L.push('【数据目录】')
  for (const [k, v] of Object.entries(d.paths)) kv(k, v)
  L.push('')

  L.push('【数据库】')
  kv('schema', `v${d.db.version}`)
  kv('大小', humanBytes(d.db.sizeBytes))
  kv('记录数', Object.entries(d.db.counts).map(([k, v]) => `${k}=${v}`).join('  '))
  L.push('')

  L.push('【模型】')
  for (const [k, v] of Object.entries(d.model)) kv(k, v)
  L.push('')

  L.push('【语音】')
  for (const [k, v] of Object.entries(d.voice)) kv(k, v)
  L.push('')

  L.push('【文档解析】')
  for (const [k, v] of Object.entries(d.parse)) kv(k, v)
  L.push('')

  L.push('【向量检索】')
  for (const [k, v] of Object.entries(d.vector)) kv(k, v)
  L.push('')

  if (d.problems.failedMaterials.length) {
    L.push('【解析失败的资料】')
    for (const m of d.problems.failedMaterials) L.push(`  · ${m.name} → ${m.error}`)
    L.push('')
  }

  if (d.problems.teaching.length) {
    L.push('【最近几次上课】')
    for (const t of d.problems.teaching) L.push(`  · ${t}`)
    L.push('')
  }

  L.push(`【最近的错误 / 警告】共 ${d.problems.recentErrors.length} 条`)
  if (d.problems.recentErrors.length === 0) L.push('  （干净的，没有报错）')
  for (const e of d.problems.recentErrors) L.push(`  ${e}`)
  L.push('')

  // 日志尾巴：出问题往往就在最后几行，各文件都塞一段
  // 只取 .log（.txt 是以前导出的诊断包，读它们只会互相套娃）
  const tailFiles = d.logs.files
    .filter((f) => f.name.endsWith('.log'))
    .sort((a, b) => {
      const aToday = a.name === path.basename(logFileOf('server')) ? 0 : 1
      const bToday = b.name === path.basename(logFileOf('server')) ? 0 : 1
      return aToday - bToday
    })
  const tails: { name: string; body: string }[] = []
  for (const f of tailFiles.slice(0, 5)) {
    // 今天就这一次的 server 日志给多一点，其他给少的
    const isToday = f.name === path.basename(logFileOf('server'))
    const body = readTail(f.name, isToday ? 160 : 40).trim()
    if (body) tails.push({ name: f.name, body })
  }
  if (tails.length) {
    L.push('【日志尾巴】')
    for (const t of tails) {
      L.push(`--- ${t.name} ${'-'.repeat(Math.max(0, 46 - t.name.length))}`)
      L.push(t.body)
      L.push('')
    }
  } else {
    L.push('【日志尾巴】')
    L.push('  （还没有日志文件；日志从这一版才开始往磁盘写）')
    L.push('')
  }

  L.push('【日志文件清单】')
  if (d.logs.files.length === 0) L.push('  （空）')
  for (const f of d.logs.files) L.push(`  ${f.name}  ${humanBytes(f.bytes)}  ${f.mtime}`)
  L.push('')

  L.push('【原始 JSON（给程序看的）】')
  L.push(JSON.stringify(d, null, 2))
  L.push('')

  return redact(L.join('\n'))
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 落盘：logs/teachme-diagnostics-YYYYMMDD-HHmmss.txt */
export async function buildBundle(): Promise<DiagnosticsBundle> {
  const info = await collectDiagnostics()
  const text = renderDiagnostics(info)
  const filename = `teachme-diagnostics-${stamp()}.txt`
  const filePath = path.join(LOGS_DIR, filename)
  fs.mkdirSync(LOGS_DIR, { recursive: true })
  fs.writeFileSync(filePath, text, 'utf8')
  return {
    generatedAt: info.generatedAt,
    filename,
    filePath,
    bytes: Buffer.byteLength(text, 'utf8'),
    text,
  }
}

export { humanBytes }
