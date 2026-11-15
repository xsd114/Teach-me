import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload,
  Globe,
  FolderSearch,
  Database,
  RefreshCw,
  Trash2,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
  FileText,
  Sparkles,
  ChevronRight,
} from 'lucide-react'
import { api } from '../lib/api'
import type { Material } from '../lib/types'
import { Modal } from './Modal'

type Stats = {
  materials: number
  indexed: number
  chunks: number
  vectors: number
  chars: number
  provider: string
}

type Suggest = { chars: number; files: number; suggest: 'off' | 'recommend' | 'force'; reason: string }

type ChunkPreview = {
  id: string
  name: string
  total: number
  chunks: { id: number; heading_path: string; text: string; char_count: number }[]
}

const STAGE_LABEL: Record<string, string> = {
  queued: '排队中',
  parsing: '解析中',
  chunking: '分片中',
  embedding: '建向量',
  done: '完成',
  failed: '失败',
  excluded: '已编出',
}

const STATUS_META: Record<
  Material['status'],
  { label: string; cls: string; icon: typeof CheckCircle2 }
> = {
  pending: { label: '处理中', cls: 'text-accent', icon: Loader2 },
  parsed: { label: '已解析', cls: 'text-info', icon: Clock },
  indexed: { label: '已入记忆库', cls: 'text-ok', icon: CheckCircle2 },
  failed: { label: '失败', cls: 'text-danger', icon: AlertTriangle },
  excluded: { label: '已编出', cls: 'text-ink-mute', icon: Clock },
}

function fmtChars(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万字`
  return `${n} 字`
}

export function MaterialsPanel({ courseId }: { courseId: string | null }) {
  const [materials, setMaterials] = useState<Material[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [suggest, setSuggest] = useState<Suggest | null>(null)
  const [vectorReady, setVectorReady] = useState(false)
  const [embedModel, setEmbedModel] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [urlOpen, setUrlOpen] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const [pathOpen, setPathOpen] = useState(false)
  const [pathValue, setPathValue] = useState('')
  const [preview, setPreview] = useState<ChunkPreview | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const [list, st, sg] = await Promise.all([
        api.listMaterials(courseId),
        api.memoryStats(courseId),
        api.memorySuggest(courseId),
      ])
      setMaterials(list.materials)
      setVectorReady(list.vector.ready)
      setStats(st.stats)
      setEmbedModel(st.embed.model)
      setSuggest(sg)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 有任务在跑就轮询
  useEffect(() => {
    const active = materials.some((m) => m.status === 'pending' || m.status === 'parsed')
    if (!active) return
    const t = setInterval(() => void refresh(), 1400)
    return () => clearInterval(t)
  }, [materials, refresh])

  const doUpload = async (files: FileList | File[]) => {
    const arr = Array.from(files)
    if (arr.length === 0) return
    setBusy(true)
    try {
      await api.uploadMaterials(arr, courseId)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }

  const doFetchUrl = async () => {
    if (!urlValue.trim()) return
    setBusy(true)
    try {
      await api.fetchUrl(urlValue.trim(), courseId)
      setUrlOpen(false)
      setUrlValue('')
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '抓取失败')
    } finally {
      setBusy(false)
    }
  }

  const doImportPath = async () => {
    if (!pathValue.trim()) return
    setBusy(true)
    try {
      await api.importPath(pathValue.trim(), courseId)
      setPathOpen(false)
      setPathValue('')
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  const openPreview = async (m: Material) => {
    try {
      const r = await api.materialChunks(m.id)
      setPreview({ id: m.id, name: m.name, total: r.total, chunks: r.chunks })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '读取分片失败')
    }
  }

  return (
    <div className="space-y-4">
      {/* 记忆库状态 */}
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Database size={15} className={vectorReady ? 'text-accent' : 'text-ink-mute'} />
            <span className="text-sm font-medium text-ink">记忆库</span>
          </div>

          <span
            className={`flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-2xs ${
              vectorReady ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-ink-mute'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${vectorReady ? 'bg-ok' : 'bg-ink-mute'}`} />
            {vectorReady ? '向量就绪' : '仅关键词'}
          </span>

          {stats && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-dim">
              <span className="tabular-nums">{stats.materials} 份资料</span>
              <span className="tabular-nums">{stats.chunks} 个分片</span>
              <span className="tabular-nums">{stats.vectors} 条向量</span>
              <span className="tabular-nums">{fmtChars(stats.chars)}</span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await api.warmupEmbedding()
                  setErr(r.ok ? null : (r.error ?? '预热失败'))
                  await refresh()
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy}
              className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 text-xs text-ink-dim hover:bg-surface-3 hover:text-ink disabled:opacity-40"
              title="首次使用向量检索前预热，避免第一次搜索卡住"
            >
              <Sparkles size={12} />
              预热模型
            </button>
            <button
              onClick={async () => {
                setBusy(true)
                try {
                  await api.reindexMemory(courseId)
                  await refresh()
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy}
              className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 text-xs text-ink-dim hover:bg-surface-3 hover:text-ink disabled:opacity-40"
            >
              <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
              重建索引
            </button>
          </div>
        </div>

        {suggest && (
          <div
            className={`mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-2xs leading-relaxed ${
              suggest.suggest === 'force'
                ? 'bg-warn/10 text-warn'
                : suggest.suggest === 'recommend'
                  ? 'bg-info/10 text-info'
                  : 'bg-surface-2 text-ink-mute'
            }`}
          >
            <ChevronRight size={12} className="mt-0.5 shrink-0" />
            <span>{suggest.reason}</span>
          </div>
        )}

        {embedModel && (
          <p className="mt-2 text-2xs text-ink-mute">
            嵌入模型：<span className="font-mono">{embedModel}</span>
          </p>
        )}
      </div>

      {/* 导入区 */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void doUpload(e.dataTransfer.files)
        }}
        className={`rounded-lg border border-dashed p-4 transition-colors ${
          dragOver ? 'border-accent bg-accent-soft' : 'border-line bg-surface/40'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
          >
            <Upload size={14} />
            上传文件
          </button>
          <button
            onClick={() => setUrlOpen(true)}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-xs text-ink-dim hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          >
            <Globe size={14} />
            抓网页
          </button>
          <button
            onClick={() => setPathOpen(true)}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-xs text-ink-dim hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          >
            <FolderSearch size={14} />
            本地路径
          </button>
          <span className="text-2xs text-ink-mute">
            支持 pdf / docx / pptx / xlsx / md / txt / csv，或把文件拖进来
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void doUpload(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {err && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {err}
        </div>
      )}

      {/* 资料列表 */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2/50" />
          ))}
        </div>
      ) : materials.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line text-sm text-ink-mute">
          <FileText size={22} strokeWidth={1.4} />
          还没有资料。上传教材、PPT、笔记，或让我去网上找
        </div>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {materials.map((m) => {
              const meta = STATUS_META[m.status]
              const Icon = meta.icon
              const spinning = m.status === 'pending' || m.status === 'parsed'
              return (
                <motion.li
                  key={m.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-lg border border-line bg-surface px-4 py-3"
                >
                  <div className="flex items-start gap-3">
                    <Icon
                      size={15}
                      className={`mt-0.5 shrink-0 ${meta.cls} ${spinning ? 'animate-spin' : ''}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="truncate text-sm font-medium text-ink" title={m.name}>
                          {m.name}
                        </span>
                        <span className={`text-2xs ${meta.cls}`}>
                          {meta.label}
                          {spinning && m.stage ? ` · ${STAGE_LABEL[m.stage] ?? m.stage}` : ''}
                        </span>
                        {m.degraded && (
                          <span className="rounded-sm bg-warn/15 px-1.5 py-0.5 text-2xs text-warn">
                            降级解析
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-mute">
                        <span className="tabular-nums">{fmtChars(m.charCount)}</span>
                        <span className="tabular-nums">{m.chunkCount} 片</span>
                        {m.parser && <span className="font-mono">{m.parser}</span>}
                        {m.origin === 'web' && m.sourceUrl && (
                          <a
                            href={m.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-info hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {m.sourceUrl}
                          </a>
                        )}
                      </div>

                      {spinning && (
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                          <div
                            className="h-full bg-accent transition-all duration-500"
                            style={{ width: `${m.progress}%` }}
                          />
                        </div>
                      )}

                      {m.error && m.status === 'failed' && (
                        <p className="mt-1 line-clamp-2 text-2xs text-danger">{m.error}</p>
                      )}
                    </div>

                    {/* 操作 */}
                    <div className="flex shrink-0 items-center gap-1">
                      {m.chunkCount > 0 && (
                        <IconBtn title="查看分片" onClick={() => void openPreview(m)}>
                          <Eye size={13} />
                        </IconBtn>
                      )}
                      {m.inMemory ? (
                        <button
                          onClick={async () => {
                            await api.excludeMaterial(m.id)
                            await refresh()
                          }}
                          className="rounded-md px-2 py-1 text-2xs text-ink-dim transition-colors hover:bg-surface-2 hover:text-warn"
                          title="从记忆库中移除（文件仍保留）"
                        >
                          编出
                        </button>
                      ) : (
                        <button
                          onClick={async () => {
                            await api.reincludeMaterial(m.id)
                            await refresh()
                          }}
                          className="rounded-md px-2 py-1 text-2xs text-accent transition-colors hover:bg-accent-soft"
                          title="重新编入记忆库"
                        >
                          编入
                        </button>
                      )}
                      <IconBtn
                        title="重新解析"
                        onClick={async () => {
                          await api.reprocessMaterial(m.id)
                          await refresh()
                        }}
                      >
                        <RefreshCw size={13} />
                      </IconBtn>
                      <IconBtn
                        title="删除"
                        danger
                        onClick={async () => {
                          if (!confirm(`删除「${m.name}」？分量与向量会一起清掉。`)) return
                          await api.deleteMaterial(m.id)
                          await refresh()
                        }}
                      >
                        <Trash2 size={13} />
                      </IconBtn>
                    </div>
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}

      {/* 抓网页 */}
      <Modal
        open={urlOpen}
        onClose={() => setUrlOpen(false)}
        title="抓一个网页进记忆库"
        subtitle="只抓正文，去广告与导航。抓不下来的站多半是纯前端渲染，改用「本地路径」"
        width={520}
        footer={
          <>
            <button
              onClick={() => setUrlOpen(false)}
              className="ml-auto h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink-dim hover:bg-surface-2"
            >
              取消
            </button>
            <button
              onClick={doFetchUrl}
              disabled={busy || !urlValue.trim()}
              className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? '抓取中…' : '抓取'}
            </button>
          </>
        }
      >
        <input
          autoFocus
          value={urlValue}
          onChange={(e) => setUrlValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void doFetchUrl()}
          placeholder="https://zh.wikipedia.org/wiki/粤菜"
          className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-mute focus:border-line-strong focus:outline-none"
        />
        <p className="mt-2 text-2xs text-ink-mute">
          入库后会自动分片并向量化。想按特定要求整理（例如"只保留技法段落"），在 M3 接上模型后可用提示词控制。
        </p>
      </Modal>

      {/* 本地路径 */}
      <Modal
        open={pathOpen}
        onClose={() => setPathOpen(false)}
        title="从本地路径导入"
        subtitle="适合批量导入整个文件夹里的教材"
        width={520}
        footer={
          <>
            <button
              onClick={() => setPathOpen(false)}
              className="ml-auto h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink-dim hover:bg-surface-2"
            >
              取消
            </button>
            <button
              onClick={doImportPath}
              disabled={busy || !pathValue.trim()}
              className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? '导入中…' : '导入'}
            </button>
          </>
        }
      >
        <input
          autoFocus
          value={pathValue}
          onChange={(e) => setPathValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void doImportPath()}
          placeholder="F:\教材\微积分.pdf"
          className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-mute focus:border-line-strong focus:outline-none"
        />
      </Modal>

      {/* 分片预览 */}
      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.name ?? ''}
        subtitle={`共 ${preview?.total ?? 0} 个分片（显示前 ${preview?.chunks.length ?? 0} 个）`}
        width={720}
      >
        <div className="space-y-2">
          {preview?.chunks.map((c, i) => (
            <div key={c.id} className="rounded-md border border-line bg-surface-2 px-3 py-2">
              <div className="mb-1 flex items-center gap-2 text-2xs text-ink-mute">
                <span className="tabular-nums">#{i + 1}</span>
                {c.heading_path && <span className="truncate">{c.heading_path}</span>}
                <span className="ml-auto tabular-nums">{c.char_count} 字</span>
              </div>
              <p className="line-clamp-4 text-2xs leading-relaxed whitespace-pre-wrap text-ink-dim">
                {c.text}
              </p>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: ReactNode
  onClick: () => void
  title: string
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-md p-1.5 text-ink-mute transition-colors hover:bg-surface-2 ${
        danger ? 'hover:text-danger' : 'hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}
