import { all, getDb, one } from '../db/index.js'
import { embedTexts } from './vector.js'
import { knn, vectorStatus } from './vectorStore.js'

export type Hit = {
  chunkId: number
  materialId: string
  materialName: string
  courseId: string | null
  headingPath: string
  text: string
  score: number
  via: 'vector' | 'fulltext' | 'both'
  distance?: number
  rankFts?: number
  rankVec?: number
}

export type SearchOptions = {
  courseId?: string | null
  /** 是否跨课程（null/undefined 表示全局） */
  topK?: number
  /** RRF 常数，越大越平缓 */
  rrfK?: number
  /** 只用关键词，不跑向量（用户没下模型时的降级） */
  keywordOnly?: boolean
}

type ChunkRow = {
  id: number
  material_id: string
  course_id: string | null
  heading_path: string
  text: string
  name: string
}

const STOP = new Set([
  '的', '了', '是', '在', '和', '与', '我', '你', '他', '它', '这', '那', '什么', '怎么', '为什么',
  '如何', '一下', '可以', '要', '吗', '呢', '吧', '啊', '一个', '有', '没', '不',
])

/** 单字停用集合：中文提问里"为什么/怎么/要/过"这类字会把检索词粘成一整串，先切掉 */
const STOP_CHARS = new Set(
  [...'的了吗呢吧啊呀哦嗯是在和有没不我要你他她它怎么为何什如何过把给让被从对向于其这那些个就都也很还再又只才请帮告诉能会不会是否'],
)

/** 把中文长句切成实词段（按停用字断开） */
function segmentCJK(s: string): string[] {
  const parts: string[] = []
  let buf = ''
  for (const ch of s) {
    const isCJK = /[\u4e00-\u9fa5]/.test(ch)
    if (isCJK && !STOP_CHARS.has(ch)) {
      buf += ch
    } else {
      if (buf) parts.push(buf)
      buf = ''
      // 非中文按分隔符处理
      if (!isCJK && !/[\w]/.test(ch)) continue
    }
  }
  if (buf) parts.push(buf)
  return parts
}

/**
 * 把查询拆成检索词。
 * - trigram 索引要求 >=3 字符，所以 <3 的走 LIKE 兜底
 * - 中文无空格，必须先按停用字切段，否则整句 MATCH 一定空（实测踩过）
 */
export function tokenizeQuery(q: string): { long: string[]; short: string[] } {
  const cleaned = q.trim().replace(/[，。、；：！？""''（）()【】\[\]?,.;:!?]/g, ' ')
  const raw = cleaned.split(/\s+/).map((t) => t.trim()).filter(Boolean)

  const long: string[] = []
  const short: string[] = []

  for (const t of raw) {
    if (STOP.has(t)) continue
    const segs = /[\u4e00-\u9fa5]/.test(t) ? segmentCJK(t) : [t]
    for (const seg of segs) {
      if (!seg) continue
      if (seg.length >= 3) {
        long.push(seg)
      } else if (seg.length === 2) {
        short.push(seg)
      }
    }
  }

  // 去重并按长度降序（长词更能代表意图）
  const uniqLong = [...new Set(long)].sort((a, b) => b.length - a.length).slice(0, 6)
  const uniqShort = [...new Set(short)].sort((a, b) => b.length - a.length).slice(0, 4)

  // 完全没有可用词（例如查询就是"为什么"）→ 退化为整句
  if (uniqLong.length === 0 && uniqShort.length === 0) {
    const whole = cleaned.replace(/\s+/g, '')
    if (whole.length >= 2) (whole.length >= 3 ? uniqLong : uniqShort).push(whole)
  }

  return { long: uniqLong, short: uniqShort }
}

function ftsSearch(q: string, opts: SearchOptions, limit: number): { chunkId: number; rank: number }[] {
  const { long } = tokenizeQuery(q)

  if (long.length > 0) {
    // 先试 AND（同时命中所有实词，最精确），没有再退回 OR
    if (long.length > 1) {
      const andExpr = long.map((t) => `"${t.replace(/"/g, '')}"`).join(' AND ')
      const andRows = all<{ id: number }>(
        `SELECT rowid AS id FROM chunk_fts WHERE chunk_fts MATCH ? ORDER BY rank LIMIT ?`,
        andExpr,
        limit,
      )
      if (andRows.length > 0) return andRows.map((r, i) => ({ chunkId: Number(r.id), rank: i }))
    }

    const expr = long.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ')
    const rows = all<{ id: number }>(
      `SELECT rowid AS id FROM chunk_fts WHERE chunk_fts MATCH ? ORDER BY rank LIMIT ?`,
      expr,
      limit,
    )
    if (rows.length > 0) return rows.map((r, i) => ({ chunkId: Number(r.id), rank: i }))
  }

  // 短词（<3 字）trigram 查不到，用 LIKE 兜底
  const pieces = [...tokenizeQuery(q).short, ...long].filter(Boolean).slice(0, 4)
  if (pieces.length === 0) return []

  const where = pieces.map(() => 'c.text LIKE ?').join(' OR ')
  const params: unknown[] = pieces.map((p) => `%${p}%`)
  const sql = opts.courseId
    ? `SELECT c.id FROM chunk c WHERE c.course_id = ? AND (${where}) LIMIT ?`
    : `SELECT c.id FROM chunk c WHERE (${where}) LIMIT ?`
  const args = opts.courseId ? [opts.courseId, ...params, limit] : [...params, limit]
  const rows = all<{ id: number }>(sql, ...args)
  return rows.map((r, i) => ({ chunkId: Number(r.id), rank: i }))
}

function hydrate(ids: number[]): Map<number, ChunkRow> {
  if (ids.length === 0) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const rows = all<ChunkRow>(
    `SELECT c.id, c.material_id, c.course_id, c.heading_path, c.text, m.name
     FROM chunk c JOIN material m ON m.id = c.material_id
     WHERE c.id IN (${placeholders})`,
    ...ids,
  )
  return new Map(rows.map((r) => [Number(r.id), r]))
}

/**
 * 混合检索：全文（FTS5 trigram）+ 向量（sqlite-vec）→ RRF 融合。
 *
 * 为什么用 RRF 而不是加权分数：两路分数量纲完全不同，
 * 排名融合不需要调参，中文场景下比加权稳定得多。
 */
export async function hybridSearch(q: string, opts: SearchOptions = {}): Promise<{
  hits: Hit[]
  meta: { mode: string; fts: number; vec: number; ms: number }
}> {
  const t0 = Date.now()
  const topK = opts.topK ?? 8
  const rrfK = opts.rrfK ?? 60
  const candidateLimit = Math.max(topK * 4, 30)

  const fts = ftsSearch(q, opts, candidateLimit)

  let vec: { chunkId: number; distance: number }[] = []
  const vs = vectorStatus()
  const useVec = !opts.keywordOnly && vs.ready
  if (useVec) {
    try {
      const r = await embedTexts([q])
      if (r.vectors[0]) {
        vec = knn(getDb(), r.vectors[0], candidateLimit)
      }
    } catch {
      vec = []
    }
  }

  const scores = new Map<number, { score: number; rankFts?: number; rankVec?: number; distance?: number }>()
  // 先写向量路：RRF 等权时 Map 的插入顺序决定平局，语义命中通常比词频更贴近意图
  vec.forEach((h, i) => {
    scores.set(h.chunkId, {
      score: 1 / (rrfK + i + 1),
      rankVec: i + 1,
      distance: h.distance,
    })
  })
  fts.forEach((h) => {
    const cur = scores.get(h.chunkId) ?? { score: 0 }
    cur.score += 1 / (rrfK + h.rank + 1)
    cur.rankFts = h.rank + 1
    scores.set(h.chunkId, cur)
  })

  const ordered = [...scores.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, topK)
  const rows = hydrate(ordered.map(([id]) => id))

  const hits: Hit[] = []
  for (const [id, s] of ordered) {
    const row = rows.get(id)
    if (!row) continue
    // 课程过滤（向量路不带 where，这里统一裁）
    if (opts.courseId && row.course_id !== opts.courseId) continue
    hits.push({
      chunkId: id,
      materialId: row.material_id,
      materialName: row.name,
      courseId: row.course_id,
      headingPath: row.heading_path,
      text: row.text,
      score: Number(s.score.toFixed(6)),
      via: s.rankFts !== undefined && s.rankVec !== undefined ? 'both' : s.rankFts !== undefined ? 'fulltext' : 'vector',
      distance: s.distance,
      rankFts: s.rankFts,
      rankVec: s.rankVec,
    })
  }

  return {
    hits,
    meta: {
      mode: useVec ? 'hybrid' : 'keyword-only',
      fts: fts.length,
      vec: vec.length,
      ms: Date.now() - t0,
    },
  }
}

/** 阈值判断：决定这门课到底要不要开向量库 */
export function memorySuggestion(courseId: string | null): {
  chars: number
  files: number
  suggest: 'off' | 'recommend' | 'force'
  reason: string
} {
  const sql = courseId
    ? `SELECT COUNT(*) AS files, COALESCE(SUM(char_count),0) AS chars FROM material WHERE course_id = ? AND status != 'excluded'`
    : `SELECT COUNT(*) AS files, COALESCE(SUM(char_count),0) AS chars FROM material WHERE status != 'excluded'`
  const r = one<{ files: number; chars: number }>(sql, ...(courseId ? [courseId] : []))
  const chars = Number(r?.chars ?? 0)
  const files = Number(r?.files ?? 0)

  if (chars > 150_000 || files > 20) {
    return { chars, files, suggest: 'force', reason: `资料已达 ${(chars / 10000).toFixed(1)} 万字 / ${files} 个文件，建议开启向量库` }
  }
  if (chars >= 30_000 || files >= 3) {
    return { chars, files, suggest: 'recommend', reason: `资料约 ${(chars / 10000).toFixed(1)} 万字 / ${files} 个文件，开启检索更省 token` }
  }
  return { chars, files, suggest: 'off', reason: `资料只有 ${chars} 字 / ${files} 个文件，直接整篇读更准，不必建索引` }
}
