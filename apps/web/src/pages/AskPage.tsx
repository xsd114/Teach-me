import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Send,
  Paperclip,
  Database,
  Plus,
  Loader2,
  FileText,
  ChevronDown,
  BookOpen,
} from 'lucide-react'
import { api, type Citation, type QaMessage } from '../lib/api'
import { MiniMarkdown } from '../components/MiniMarkdown'

type Course = { id: string; title: string }

export function AskPage({ initialCourseId = null }: { initialCourseId?: string | null }) {
  const [scope, setScope] = useState<string | null>(initialCourseId)
  const [courses, setCourses] = useState<Course[]>([])
  const [chunks, setChunks] = useState(0)
  const [materials, setMaterials] = useState(0)
  const [hasKey, setHasKey] = useState(true)

  const [messages, setMessages] = useState<QaMessage[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [uploadNote, setUploadNote] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadStatus = useCallback(async () => {
    const s = await api.qaStatus(scope)
    setCourses(s.courses)
    setChunks(s.chunks)
    setMaterials(s.materials)
    setHasKey(s.hasKey)
  }, [scope])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  const ask = async () => {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    setErr(null)
    setBusy(true)

    const now = new Date().toISOString()
    setMessages((m) => [
      ...m,
      { id: `local-u-${Date.now()}`, role: 'user', content: q, citations: [], createdAt: now },
    ])

    try {
      const r = await api.qaAsk(q, scope, threadId)
      setThreadId(r.threadId)
      setMessages((m) => [
        ...m,
        {
          id: r.messageId,
          role: 'assistant',
          content: r.answer,
          citations: r.citations,
          createdAt: new Date().toISOString(),
        },
      ])
    } catch (e) {
      setErr(e instanceof Error ? e.message : '回答失败')
    } finally {
      setBusy(false)
    }
  }

  const newThread = () => {
    setThreadId(null)
    setMessages([])
    setErr(null)
  }

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    try {
      await api.uploadMaterials(Array.from(files), scope)
      setUploadNote(`已加入资料库：${Array.from(files).map((f) => f.name).join('、')}（正在解析）`)
      setTimeout(() => setUploadNote(null), 4000)
      await loadStatus()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '上传失败')
    }
  }

  const scopeLabel = scope ? courses.find((c) => c.id === scope)?.title ?? '该课程' : '全部课程'

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
        <span className="text-sm font-medium text-ink">问答</span>

        {/* 范围选择 */}
        <div className="relative">
          <button
            onClick={() => setScopeOpen((v) => !v)}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <BookOpen size={12} />
            <span className="max-w-40 truncate">{scopeLabel}</span>
            <ChevronDown size={12} />
          </button>
          {scopeOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setScopeOpen(false)} />
              <div className="absolute top-full left-0 z-20 mt-1 w-64 overflow-hidden rounded-md border border-line bg-surface-3 py-1 shadow-xl">
                <ScopeItem
                  active={scope === null}
                  onClick={() => {
                    setScope(null)
                    setScopeOpen(false)
                    newThread()
                  }}
                  title="全部课程"
                  sub="跨所有记忆库检索"
                />
                {courses.map((c) => (
                  <ScopeItem
                    key={c.id}
                    active={scope === c.id}
                    onClick={() => {
                      setScope(c.id)
                      setScopeOpen(false)
                      newThread()
                    }}
                    title={c.title}
                    sub="只在本科资料里找"
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-2xs text-ink-mute">
          <Database size={11} />
          {materials} 份资料 · {chunks} 个分片
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={newThread}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Plus size={12} />
            新对话
          </button>
        </div>
      </div>

      {/* 消息流 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[70ch] px-6 py-6">
          {messages.length === 0 && !busy ? (
            <div className="flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-line bg-surface">
                <BookOpen size={22} strokeWidth={1.4} className="text-ink-mute" />
              </div>
              <h2 className="mb-1.5 text-base font-medium text-ink">问点什么</h2>
              <p className="prose-narrow text-xs leading-relaxed text-ink-dim">
                我会先在{scope ? `《${scopeLabel}》` : '全部课程'}的记忆库里检索，
                再用检索到的内容回答，并标出来源。找不到就说找不到。
              </p>
              {!hasKey && (
                <p className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-2xs text-warn">
                  还没配置模型 API Key，去「设置」里填一个
                </p>
              )}
              {chunks === 0 && (
                <p className="mt-3 text-2xs text-ink-mute">
                  这个范围里还没有已索引的资料，答案会基于模型自身知识（会说明这一点）
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg rounded-br-sm bg-surface-3 px-3.5 py-2.5 text-sm leading-relaxed text-ink">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id}>
                    <MiniMarkdown text={m.content} />
                    {m.citations.length > 0 && <CitationList items={m.citations} />}
                  </div>
                ),
              )}

              {busy && (
                <div className="flex items-center gap-2 text-xs text-ink-mute">
                  <Loader2 size={13} className="animate-spin" />
                  正在翻资料…
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {err && (
            <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {err}
            </div>
          )}
        </div>
      </div>

      {/* 输入 */}
      <div className="shrink-0 border-t border-line bg-surface/50 px-6 py-3">
        <div className="mx-auto w-full max-w-[70ch]">
          {uploadNote && (
            <div className="mb-2 rounded-md border border-ok/30 bg-ok/10 px-3 py-1.5 text-2xs text-ok">
              {uploadNote}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-lg border border-line bg-surface px-3 py-2 focus-within:border-line-strong">
            <button
              onClick={() => fileRef.current?.click()}
              title="上传文件到记忆库"
              className="pb-1.5 text-ink-mute transition-colors hover:text-accent"
            >
              <Paperclip size={15} />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void ask()
                }
              }}
              rows={1}
              placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
              className="max-h-32 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-sm leading-relaxed text-ink placeholder:text-ink-mute focus:outline-none"
            />
            <button
              onClick={() => void ask()}
              disabled={!input.trim() || busy}
              className="mb-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-30"
            >
              <Send size={13} />
            </button>
          </div>
          <p className="mt-1.5 text-2xs text-ink-mute">
            {scope ? `只在《${scopeLabel}》里检索` : '跨全部课程检索'} · 回答受字数预算约束，超长会折叠
          </p>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void onFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
      </div>
    </div>
  )
}

function ScopeItem({
  active,
  onClick,
  title,
  sub,
}: {
  active: boolean
  onClick: () => void
  title: string
  sub: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-surface-2 ${
        active ? 'bg-accent-soft' : ''
      }`}
    >
      <span className={`truncate text-xs ${active ? 'text-accent' : 'text-ink'}`}>{title}</span>
      <span className="text-2xs text-ink-mute">{sub}</span>
    </button>
  )
}

function CitationList({ items }: { items: Citation[] }) {
  const [open, setOpen] = useState(false)
  const shown = open ? items : items.slice(0, 3)

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-1.5 flex items-center gap-1 text-2xs text-ink-mute transition-colors hover:text-ink-dim"
      >
        <FileText size={10} />
        来源 {items.length} 处
        {items.length > 3 && <ChevronDown size={10} className={open ? 'rotate-180' : ''} />}
      </button>
      <div className="space-y-1">
        {shown.map((c) => (
          <div
            key={c.n}
            className="rounded-md border border-line bg-surface-2/60 px-2.5 py-1.5 text-2xs leading-relaxed text-ink-mute"
          >
            <span className="mr-1.5 text-accent">[{c.n}]</span>
            <span className="text-ink-dim">{c.materialName}</span>
            {c.headingPath && <span className="opacity-60"> · {c.headingPath}</span>}
            <p className="mt-0.5 line-clamp-2 opacity-80">{c.snippet}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
