import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { one } from '../db/index.js'

export type ChatRole = 'system' | 'user' | 'assistant'
export type ChatMessage = { role: ChatRole; content: string }

export type ChatOptions = {
  temperature?: number
  maxTokens?: number
  /** 要求模型返回 JSON（会在提示词里加约束，并在解析失败时兜底） */
  json?: boolean
  timeoutMs?: number
}

export type ChatResult = {
  text: string
  model: string
  ms: number
  usage?: { prompt: number; completion: number; total: number }
}

export type LlmConfig = {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
  temperature: number
  maxTokens: number
}

function setting(key: string, fallback = ''): string {
  const r = one<{ value: string }>(`SELECT value FROM setting WHERE key = ?`, key)
  return r?.value?.trim() ? r.value : fallback
}

/**
 * 读出 LLM 配置。优先级：数据库里的 key > 环境变量。
 * 优先级：数据库里的 key > 环境变量（开源项目绝不能把 key 写进代码或仓库）。
 */
export function llmConfig(): LlmConfig {
  const provider = setting('llm.provider', 'api')
  const baseUrl = setting('llm.baseUrl', 'https://api.deepseek.com').replace(/\/+$/, '')
  const model = setting('llm.model', 'deepseek-chat')
  const fromDb = setting('llm.apiKey')
  const apiKey =
    fromDb ||
    process.env.ALP_LLM_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ''
  return {
    provider,
    baseUrl,
    model,
    apiKey,
    temperature: Number(setting('llm.temperature', '0.6')) || 0.6,
    maxTokens: Number(setting('llm.maxTokens', '1200')) || 1200,
  }
}

export function hasApiKey(): boolean {
  const kind = providerKind()
  if (kind === 'dsh-cli') return true // dsh 自己管凭据（DSH_HOME 里的 .credentials）
  if (kind === 'dsh-web') return setting('llm.dshToken').length > 0
  return llmConfig().apiKey.length > 0
}

/** baseUrl 可能已经带 /v1，也可能不带，两种都要能拼对 */
function completionsUrl(baseUrl: string): string {
  const b = baseUrl.replace(/\/+$/, '')
  if (/\/v\d+$/.test(b)) return `${b}/chat/completions`
  return `${b}/v1/chat/completions`
}

/* ------------------------------------------------------------------
   provider 分发：api / dsh-cli / dsh-web
   ------------------------------------------------------------------ */

export type ProviderKind = 'api' | 'dsh-cli' | 'dsh-web'

export function providerKind(): ProviderKind {
  const p = setting('llm.provider', 'api')
  return p === 'dsh-cli' || p === 'dsh-web' ? p : 'api'
}

/**
 * 走本机 dsh CLI 的一次性任务。
 *
 * 说明：dsh headless 是"给一个任务、跑完退出"的形态，不是 chat 协议。
 * 所以这里把对话压成一段带角色标记的文本，**写进临时文件**再让 dsh 读
 * （Windows 上命令行长度和中文引号都会咬人，实测踩过）。
 * 代价：每次调用起一个进程 + 一次 agent 回合，通常 5–20 秒。
 * 好处：能用 dsh 的工具链（读文件、跑命令）。纯问答建议还是用 api。
 */
function dshCliChat(messages: ChatMessage[], timeoutMs = 240_000): Promise<ChatResult> {
  const cfg = llmConfig()
  const transcript = messages
    .map((m) => `【${m.role === 'system' ? '系统' : m.role === 'user' ? '用户' : '助手'}】\n${m.content}`)
    .join('\n\n')

  const task = `这是一次"只回答、不动手"的纯对话请求。

${transcript}

【硬要求】
- 只输出"助手"这一轮要说的内容本身。
- 不要复述上面的对话，不要加"助手："前缀。
- 不要创建、修改、删除任何文件，不要执行任何命令。
- 直接给答案。`

  const t0 = Date.now()
  const tmp = path.join(os.tmpdir(), `alp-dsh-${Date.now()}.md`)
  try {
    fs.writeFileSync(tmp, task, 'utf8')
  } catch (e) {
    return Promise.reject(new Error(`写临时任务文件失败：${e instanceof Error ? e.message : e}`))
  }

  const isWin = process.platform === 'win32'
  const bin = process.env.ALP_DSH_BIN || (isWin ? 'dsh.cmd' : 'dsh')
  const args = ['--profile', 'headless', `Read ${tmp} and answer it. Do not create or modify any files.`]

  const cmd = isWin ? 'cmd.exe' : bin
  const cmdArgs = isWin ? ['/d', '/s', '/c', bin, ...args] : args

  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      cmdArgs,
      {
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          DSH_HOME: process.env.DSH_HOME || 'D:/dsh-home',
          DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE || 'danger-full-access',
        },
      },
      (err, stdout, stderr) => {
        fs.rm(tmp, { force: true }, () => {})
        if (err) {
          reject(
            new Error(
              `dsh CLI 调用失败：${String(stderr || err.message).slice(0, 300)}\n` +
                `（确认 dsh 装着且能跑，或设环境变量 ALP_DSH_BIN 指向 dsh.cmd 的完整路径）`,
            ),
          )
          return
        }
        const text = String(stdout)
          .split('\n')
          .filter((l) => !l.startsWith('dsh: reasoning:'))
          .join('\n')
          .trim()
        resolve({ text, model: `dsh-cli:${cfg.model}`, ms: Date.now() - t0 })
      },
    )
  })
}

/**
 * 走本机 dsh web 的 HTTP 接口。
 * dsh web 的 /api/* 有内核鉴权围栏（无 token 一律 401），
 * 所以这里需要用户在设置里填一个可用的 token/cookie；没填就明确报错，不做无声降级。
 */
async function dshWebChat(messages: ChatMessage[], timeoutMs = 120_000): Promise<ChatResult> {
  const cfg = llmConfig()
  const token = setting('llm.dshToken')
  const base = setting('llm.dshBaseUrl', 'http://127.0.0.1:3080').replace(/\/+$/, '')
  if (!token) {
    throw new Error('dsh web 需要访问 token：在设置里填「dsh web token」（从 dsh web 启动日志或登录后 cookie 里取）')
  }
  const t0 = Date.now()
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Cookie: `token=${token}`,
    },
    body: JSON.stringify({ messages, model: cfg.model }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`dsh web ${res.status}：${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as { text?: string; content?: string; message?: string }
  return {
    text: json.text ?? json.content ?? json.message ?? '',
    model: `dsh-web:${cfg.model}`,
    ms: Date.now() - t0,
  }
}

/** 统一的对话入口（OpenAI Chat Completions 兼容协议，DeepSeek/火山/自建 vLLM 都通） */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const kind = providerKind()
  if (kind === 'dsh-cli') return dshCliChat(messages, opts.timeoutMs)
  if (kind === 'dsh-web') return dshWebChat(messages, opts.timeoutMs)

  const cfg = llmConfig()
  if (!cfg.apiKey) {
    throw new Error(
      '还没有配置模型 API Key。到「设置 → 模型」里填一个，或设环境变量 DEEPSEEK_API_KEY。',
    )
  }

  const t0 = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000)

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: opts.temperature ?? cfg.temperature,
    max_tokens: opts.maxTokens ?? cfg.maxTokens,
    stream: false,
  }
  if (opts.json) body.response_format = { type: 'json_object' }

  try {
    const res = await fetch(completionsUrl(cfg.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`模型接口 ${res.status}：${text.slice(0, 300)}`)
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    const text = json.choices?.[0]?.message?.content ?? ''
    return {
      text,
      model: cfg.model,
      ms: Date.now() - t0,
      usage: json.usage
        ? {
            prompt: json.usage.prompt_tokens ?? 0,
            completion: json.usage.completion_tokens ?? 0,
            total: json.usage.total_tokens ?? 0,
          }
        : undefined,
    }
  } finally {
    clearTimeout(timeout)
  }
}

/** 从可能带 ```json 围栏的回复里抠出 JSON */
export function extractJson<T>(text: string): T | null {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T
      } catch {
        return null
      }
    }
    return null
  }
}

/** 连通性测试 */
export async function testLlm(): Promise<{
  ok: boolean
  provider: string
  model: string
  baseUrl: string
  ms: number
  reply?: string
  error?: string
}> {
  const cfg = llmConfig()
  const kind = providerKind()
  const t0 = Date.now()

  if (kind === 'dsh-cli') {
    try {
      const r = await chat(
        [
          { role: 'system', content: '你是一个测试助手。' },
          { role: 'user', content: '只回两个字：通了' },
        ],
        { maxTokens: 20, timeoutMs: 90_000 },
      )
      return {
        ok: true,
        provider: kind,
        model: r.model,
        baseUrl: 'dsh CLI (headless)',
        ms: Date.now() - t0,
        reply: r.text.trim().slice(0, 40),
      }
    } catch (e) {
      return {
        ok: false,
        provider: kind,
        model: cfg.model,
        baseUrl: 'dsh CLI',
        ms: Date.now() - t0,
        error: e instanceof Error ? e.message : '调用失败',
      }
    }
  }

  if (kind === 'dsh-web') {
    try {
      const r = await chat(
        [
          { role: 'system', content: '你是一个测试助手。' },
          { role: 'user', content: '只回两个字：通了' },
        ],
        { maxTokens: 20, timeoutMs: 60_000 },
      )
      return {
        ok: true,
        provider: kind,
        model: r.model,
        baseUrl: setting('llm.dshBaseUrl', 'http://127.0.0.1:3080'),
        ms: Date.now() - t0,
        reply: r.text.trim().slice(0, 40),
      }
    } catch (e) {
      return {
        ok: false,
        provider: kind,
        model: cfg.model,
        baseUrl: setting('llm.dshBaseUrl', 'http://127.0.0.1:3080'),
        ms: Date.now() - t0,
        error: e instanceof Error ? e.message : '调用失败',
      }
    }
  }

  if (!cfg.apiKey) {
    return { ok: false, provider: kind, model: cfg.model, baseUrl: cfg.baseUrl, ms: 0, error: '未配置 API Key' }
  }
  try {
    const r = await chat(
      [
        { role: 'system', content: '你是一个测试助手。' },
        { role: 'user', content: '只回两个字：通了' },
      ],
      { maxTokens: 20, temperature: 0 },
    )
    return {
      ok: true,
      provider: kind,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      ms: Date.now() - t0,
      reply: r.text.trim().slice(0, 40),
    }
  } catch (e) {
    return {
      ok: false,
      provider: kind,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : '调用失败',
    }
  }
}
