import { useEffect, useMemo, useState } from 'react'
import { Highlighter, Loader2, Database, ChevronRight, Search } from 'lucide-react'
import { api } from '../lib/api'

/**
 * 重点标记栏。
 *
 * 三段式：左边是标记条目，中间是被标记的那段原文（命中部分高亮），
 * 右边是它出自哪里。筛选条在顶上，能按颜色过滤。
 */

type Mark = {
  id: string
  text: string
  note: string
  color: string
  sourceKind: string
  sourceId: string | null
  inMemory: boolean
  createdAt: string
}

const COLORS: { k: string; label: string; cls: string; dot: string }[] = [
  { k: 'all', label: '全部', cls: 'border-line', dot: 'bg-ink-mute' },
  { k: 'yellow', label: '黄', cls: 'border-amber-400/50 bg-amber-400/10', dot: 'bg-amber-400' },
  { k: 'white', label: '白', cls: 'border-slate-300/50 bg-slate-300/10', dot: 'bg-slate-200' },
  { k: 'blue', label: '蓝', cls: 'border-sky-400/50 bg-sky-400/10', dot: 'bg-sky-400' },
]

function dotOf(color: string) {
  if (color === 'yellow') return 'bg-amber-400'
  if (color === 'white') return 'bg-slate-200'
  if (color === 'blue') return 'bg-sky-400'
  return 'bg-ink-mute'
}

function markCls(color: string) {
  if (color === 'yellow') return 'bg-amber-300/40 text-amber-50 shadow-[inset_0_-2px_0_rgba(254,240,138,.95)]'
  if (color === 'white') return 'bg-slate-100/30 text-white shadow-[inset_0_-2px_0_rgba(248,250,252,.9)]'
  if (color === 'blue') return 'bg-sky-400/30 text-sky-100 shadow-[inset_0_-2px_0_rgba(56,189,248,.85)]'
  return 'bg-surface-3'
}

export function MarksPanel({ courseId }: { courseId: string }) {
  const [marks, setMarks] = useState<Mark[] | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [pick, setPick] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const r = await api.annotations(courseId)
      setMarks((r.annotations ?? []) as Mark[])
    } catch {
      setMarks([])
    }
  }

  useEffect(() => {
    void load()
  }, [courseId])

  const shown = useMemo(() => {
    let list = marks ?? []
    if (filter !== 'all') list = list.filter((m) => m.color === filter)
    if (q.trim()) {
      const k = q.trim().toLowerCase()
      list = list.filter(
        (m) => m.text.toLowerCase().includes(k) || (m.note ?? '').toLowerCase().includes(k),
      )
    }
    return list
  }, [marks, filter, q])

  const active = shown.find((m) => m.id === pick) ?? shown[0] ?? null

  /** 把没进记忆库的标记交给 AI 归纳，再写入记忆库 */
  const pushToMemory = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.rememberMarks(courseId, filter === 'all' ? undefined : filter)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: marks?.length ?? 0, yellow: 0, white: 0, blue: 0 }
    for (const m of marks ?? []) c[m.color] = (c[m.color] ?? 0) + 1
    return c
  }, [marks])

  if (marks === null) {
    return (
      <div className="flex items-center gap-2 px-8 py-16 text-sm text-ink-mute">
        <Loader2 size={14} className="animate-spin" />
        正在读标记…
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 筛选条 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-2.5">
        <Highlighter size={13} className="text-accent" />
        <span className="text-xs font-medium text-ink">重点标记</span>
        <span className="text-2xs text-ink-mute">共 {counts.all} 条</span>

        <div className="ml-3 flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c.k}
              onClick={() => setFilter(c.k)}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] transition-colors ${
                filter === c.k
                  ? 'border-accent/50 bg-accent-soft text-accent'
                  : 'border-line text-ink-mute hover:text-ink'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
              {c.label}
              <span className="text-ink-mute">{counts[c.k] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2">
            <Search size={10} className="text-ink-mute" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜标记"
              className="w-24 bg-transparent text-[10px] text-ink placeholder:text-ink-mute focus:outline-none"
            />
          </div>
          <button
            onClick={() => void pushToMemory()}
            disabled={busy || counts.all === 0}
            className="flex h-7 items-center gap-1 rounded-md border border-info/40 bg-info/10 px-2.5 text-[10px] text-info hover:brightness-110 disabled:opacity-40"
          >
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Database size={10} />}
            更多 · 纳入记忆库
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <Highlighter size={22} className="text-ink-mute/50" />
          <p className="text-sm text-ink-dim">还没有标记</p>
          <p className="max-w-xs text-2xs leading-relaxed text-ink-mute">
            在教材或上课界面里选中一段话，点「重点标记」，它就会出现在这里。
          </p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr_180px] divide-x divide-line">
          {/* 左：条目 */}
          <div className="min-h-0 overflow-y-auto">
            {shown.map((m) => (
              <button
                key={m.id}
                onClick={() => setPick(m.id)}
                className={`flex w-full items-start gap-2 border-b border-line/60 px-3 py-2.5 text-left transition-colors ${
                  active?.id === m.id ? 'bg-surface-2' : 'hover:bg-surface-2/60'
                }`}
              >
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotOf(m.color)}`} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-2xs leading-relaxed text-ink-dim">{m.text}</span>
                  <span className="mt-0.5 block text-[10px] text-ink-mute">
                    {m.createdAt.slice(5, 10)}
                    {m.inMemory ? ' · 已入库' : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* 中：原文 */}
          <div className="min-h-0 overflow-y-auto px-6 py-5">
            {active && (
              <>
                <div className="mb-2 flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${dotOf(active.color)}`} />
                  <span className="text-2xs text-ink-mute">
                    {active.sourceKind === 'chapter'
                      ? '教材'
                      : active.sourceKind === 'material'
                        ? '资料'
                        : active.sourceKind === 'qa'
                          ? '问答'
                          : '笔记'}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-[15px] leading-[1.9] text-ink">
                  <mark className={`rounded px-1 ${markCls(active.color)}`}>{active.text}</mark>
                </p>
                {active.note && (
                  <div className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2">
                    <div className="text-[10px] text-ink-mute">备注</div>
                    <p className="mt-0.5 text-2xs leading-relaxed text-ink-dim">{active.note}</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 右：出处 */}
          <div className="min-h-0 overflow-y-auto px-3 py-4">
            <div className="text-[10px] text-ink-mute">出自</div>
            <div className="mt-1 flex items-center gap-1 text-2xs text-ink-dim">
              <ChevronRight size={10} />
              {active?.sourceKind === 'chapter'
                ? '教材正文'
                : active?.sourceKind === 'material'
                  ? '导入的资料'
                  : active?.sourceKind === 'qa'
                    ? '问答记录'
                    : '手写笔记'}
            </div>
            {active?.sourceId && (
              <div className="mt-1 truncate text-[10px] text-ink-mute">{active.sourceId.slice(0, 14)}</div>
            )}
            <div className="mt-4 text-[10px] text-ink-mute">时间</div>
            <div className="mt-1 text-2xs text-ink-dim">{active?.createdAt.slice(0, 16).replace('T', ' ')}</div>
            <div className="mt-4 text-[10px] text-ink-mute">记忆库</div>
            <div className={`mt-1 text-2xs ${active?.inMemory ? 'text-info' : 'text-ink-mute'}`}>
              {active?.inMemory ? '已纳入' : '还没纳入'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
