import path from 'node:path'
import { MODELS_DIR } from '../config.js'
import { one } from '../db/index.js'

export type EmbedProvider = 'local' | 'api'

export type EmbedResult = {
  vectors: Float32Array[]
  provider: EmbedProvider
  model: string
  dims: number
  ms: number
}

/* ------------------------------------------------------------------
   本地模型（transformers.js）
   ------------------------------------------------------------------ */

type Extractor = (texts: string[], opts: Record<string, unknown>) => Promise<{
  dims: number[]
  tolist: () => number[][]
}>

let extractorPromise: Promise<Extractor> | null = null
let loadedModel = ''

const DEFAULT_LOCAL_MODEL = 'Xenova/bge-small-zh-v1.5'

export function localModelId(): string {
  const row = one<{ value: string }>(`SELECT value FROM setting WHERE key = 'embed.model'`)
  return row?.value || DEFAULT_LOCAL_MODEL
}

async function getExtractor(model: string): Promise<Extractor> {
  if (extractorPromise && loadedModel === model) return extractorPromise
  loadedModel = model
  extractorPromise = (async () => {
    const tf = await import('@huggingface/transformers')
    const env = tf.env as unknown as Record<string, unknown>
    // 模型缓存放到用户数据目录，不污染仓库
    env.cacheDir = path.join(MODELS_DIR, 'transformers')
    // 国内 huggingface.co 直连不通（实测超时），默认走镜像，可用环境变量覆盖
    env.remoteHost = process.env.ALP_HF_HOST || 'https://hf-mirror.com'
    env.allowLocalModels = true
    env.allowRemoteModels = true

    const pipe = await tf.pipeline('feature-extraction', model, { dtype: 'fp32' })
    return pipe as unknown as Extractor
  })()
  return extractorPromise
}

async function embedLocal(texts: string[]): Promise<EmbedResult> {
  const t0 = Date.now()
  const model = localModelId()
  const ex = await getExtractor(model)
  const out = await ex(texts, { pooling: 'mean', normalize: true })
  const rows = out.tolist()
  const vectors = rows.map((r) => Float32Array.from(r))
  return {
    vectors,
    provider: 'local',
    model,
    dims: vectors[0]?.length ?? 0,
    ms: Date.now() - t0,
  }
}

/* ------------------------------------------------------------------
   远程 API（OpenAI 兼容 /embeddings）
   ------------------------------------------------------------------ */

type ApiCfg = {
  baseUrl: string
  apiKey: string
  model: string
}

function readEmbedApiCfg(): ApiCfg | null {
  const rows = one<{ value: string }>(`SELECT value FROM setting WHERE key = 'embed.apiKey'`)
  if (!rows?.value) return null
  const base = one<{ value: string }>(`SELECT value FROM setting WHERE key = 'embed.baseUrl'`)
  const model = one<{ value: string }>(`SELECT value FROM setting WHERE key = 'embed.apiModel'`)
  return {
    baseUrl: (base?.value || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: rows.value,
    model: model?.value || 'text-embedding-3-small',
  }
}

async function embedApi(texts: string[], cfg: ApiCfg): Promise<EmbedResult> {
  const t0 = Date.now()
  const res = await fetch(`${cfg.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, input: texts }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`embedding API ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] }
  const vectors = json.data.map((d) => Float32Array.from(d.embedding))
  return {
    vectors,
    provider: 'api',
    model: cfg.model,
    dims: vectors[0]?.length ?? 0,
    ms: Date.now() - t0,
  }
}

/* ------------------------------------------------------------------
   统一入口
   ------------------------------------------------------------------ */

export function embedProvider(): EmbedProvider {
  const row = one<{ value: string }>(`SELECT value FROM setting WHERE key = 'embed.provider'`)
  return row?.value === 'api' ? 'api' : 'local'
}

export async function embedTexts(texts: string[]): Promise<EmbedResult> {
  if (texts.length === 0) {
    return { vectors: [], provider: 'local', model: '', dims: 0, ms: 0 }
  }
  const provider = embedProvider()
  if (provider === 'api') {
    const cfg = readEmbedApiCfg()
    if (!cfg) {
      // 没配 API key 就退回本地，不让导入卡死
      return embedLocal(texts)
    }
    try {
      return await embedApi(texts, cfg)
    } catch (e) {
      const local = await embedLocal(texts)
      local.model = `${local.model} (api 失败回退: ${e instanceof Error ? e.message.slice(0, 60) : ''})`
      return local
    }
  }
  return embedLocal(texts)
}

/** 把 Float32Array 转成 sqlite-vec 需要的二进制 */
export function toVecBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer.slice(0))
}

/** 预热模型（用户点"建索引"时可先跑一次，避免第一次导入卡太久） */
export async function warmupEmbedding(): Promise<{ ok: boolean; model: string; dims: number; ms: number; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await embedTexts(['预热'])
    return { ok: true, model: r.model, dims: r.dims, ms: Date.now() - t0 }
  } catch (e) {
    return {
      ok: false,
      model: localModelId(),
      dims: 0,
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : '预热失败',
    }
  }
}
