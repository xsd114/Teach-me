import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Highlighter, MessageSquarePlus, X, GripVertical, Save, Loader2, Trash2, Wand2, ChevronDown, Quote } from 'lucide-react'
import { annotationApi, api, type Annotation, type QaMessage } from '../lib/api'
import { MiniMarkdown } from './MiniMarkdown'

/* ============================================================
   划词菜单：选中一段文字后浮出来
   ============================================================ */

/** 从选区取"选中 + 前后各 radius 字"的上下文，显示时只显示选中部分 */
function extractContext(range: Range, selected: string, radius = 1000): { before: string; after: string } {
  const el =
    (range.commonAncestorContainer.nodeType === 1
      ? (range.commonAncestorContainer as Element)
      : (range.commonAncestorContainer.parentElement as Element | null)) ?? null
  const root = el?.closest('[data-source-id]') as HTMLElement | null
  const full = root?.textContent ?? ''
  const idx = full.indexOf(selected)
  if (idx < 0) return { before: '', after: '' }
  return {
    before: full.slice(Math.max(0, idx - radius), idx),
    after: full.slice(idx + selected.length, idx + selected.length + radius),
  }
}

export type SelectionPayload = {
  text: string
  contextBefore: string
  contextAfter: string
  anchorIndex: number
  startOffset: number
  endOffset: number
  x: number
  y: number
  sourceId: string | null
}

export function useSelectionMenu(enabled = true) {
  const [sel, setSel] = useState<SelectionPayload | null>(null)

  useEffect(() => {
    if (!enabled) return

    const onUp = () => {
      // 等浏览器把 selection 落定
      setTimeout(() => {
        const s = window.getSelection()
        const text = s?.toString().trim() ?? ''
        if (!s || !text || text.length < 2 || text.length > 800) {
          setSel(null)
          return
        }
        const range = s.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) {
          setSel(null)
          return
        }
        const { before, after } = extractContext(range, text)
        // 找出选中文字在第几段（正文按空行分段渲染，索引要对上）
        const root = (range.commonAncestorContainer.nodeType === 1
          ? (range.commonAncestorContainer as Element)
          : (range.commonAncestorContainer.parentElement as Element | null))?.closest('[data-source-id]')
        let anchorIndex = -1
        if (root) {
          const blocks = [...root.querySelectorAll('[data-para]')]
          const hit = blocks.findIndex((b) => (b.textContent ?? '').includes(text.slice(0, 30)))
          anchorIndex = hit >= 0 ? hit : -1
        }
        setSel({
          text,
          contextBefore: before,
          contextAfter: after,
          anchorIndex,
          startOffset: -1,
          endOffset: -1,
          x: rect.left + rect.width / 2,
          y: rect.top,
          sourceId: (range.startContainer.parentElement?.closest('[data-source-id]') as HTMLElement | null)?.dataset
            .sourceId ?? null,
        })
      }, 10)
    }

    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('[data-selection-menu]')) return
      setSel(null)
    }

    document.addEventListener('mouseup', onUp)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('scroll', () => setSel(null), true)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('mousedown', onDown)
    }
  }, [enabled])

  return { sel, clear: () => setSel(null) }
}

export function SelectionMenu({
  sel,
  courseId,
  onAsk,
  onHighlighted,
  onGrow,
  /** teach = 上课界面，第三项变成「引用到输入框」 */
  mode = 'chat',
  onQuote,
}: {
  sel: SelectionPayload | null
  courseId: string
  onAsk: (sel: SelectionPayload) => void
  onHighlighted: (a: Annotation) => void
  onGrow: (sel: SelectionPayload) => void
  mode?: 'chat' | 'teach'
  onQuote?: (text: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [growing, setGrowing] = useState(false)

  const mark = async () => {
    if (!sel || busy) return
    setBusy(true)
    try {
      const r = await annotationApi.create({
        courseId,
        sourceKind: 'chapter',
        sourceId: sel.sourceId,
        text: sel.text,
        color: 'yellow',
        inMemory: true,
      })
      onHighlighted(r.annotation)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {sel && (
        <motion.div
          data-selection-menu
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.98 }}
          transition={{ duration: 0.14 }}
          style={{ left: sel.x, top: sel.y - 8, transform: 'translate(-50%, -100%)' }}
          className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-line-strong bg-surface-3 p-1 shadow-2xl"
        >
          <button
            onClick={mark}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Highlighter size={12} />}
            重点标记
          </button>
          <div className="h-4 w-px bg-line-strong" />
          {mode === 'teach' ? (
            <button
              onClick={() => onQuote?.(sel.text)}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Quote size={12} />
              引用
            </button>
          ) : (
            <button
              onClick={() => onAsk(sel)}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <MessageSquarePlus size={12} />
              问 AI
            </button>
          )}
          <div className="h-4 w-px bg-line-strong" />
          <button
            onClick={() => {
              if (growing) return
              setGrowing(true)
              onGrow(sel)
              setTimeout(() => setGrowing(false), 1200)
            }}
            disabled={growing}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-accent transition-colors hover:bg-accent-soft disabled:opacity-50"
            title="就这段在教材里就地续写一段（会写进书里）"
          >
            {growing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            多讲讲
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ============================================================
   右侧抽屉：引用那段话，边问边聊，可拖宽度
   ============================================================ */

export function AskDrawer({
  open,
  quote,
  context,
  courseId,
  onClose,
}: {
  open: boolean
  quote: string
  /** 选中处前后各约 1000 字，一起发给 AI；界面上不显示 */
  context: string
  courseId: string
  onClose: () => void
}) {
  const [width, setWidth] = useState(400)
  const [messages, setMessages] = useState<QaMessage[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // 换了引用就重置
  useEffect(() => {
    if (!open) return
    setMessages([])
    setThreadId(null)
    setSaved(false)
    setErr(null)
  }, [open, quote])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startW: width }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startX - ev.clientX
      setWidth(Math.max(320, Math.min(760, dragRef.current.startW + delta)))
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const ask = async () => {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    setErr(null)
    setBusy(true)
    setMessages((m) => [
      ...m,
      { id: `u${Date.now()}`, role: 'user', content: q, citations: [], createdAt: new Date().toISOString() },
    ])
    try {
      const r = await api.qaAsk(q, courseId, threadId, { context, quote })
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

  const saveToMemory = async () => {
    if (!threadId) return
    try {
      await annotationApi.markPending(threadId, courseId, quote)
      setSaved(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          style={{ width }}
          className="fixed top-0 right-0 z-40 flex h-screen flex-col border-l border-line bg-surface shadow-[-12px_0_40px_-20px_rgba(0,0,0,0.7)]"
        >
          {/* 拖拽把手 */}
          <div
            onMouseDown={startDrag}
            className="absolute top-1/2 -left-1 flex h-16 w-2 -translate-y-1/2 cursor-col-resize items-center justify-center rounded-full bg-line-strong/60 hover:bg-accent/60"
            title="拖动改宽度"
          >
            <GripVertical size={10} className="text-ink-mute" />
          </div>

          {/* 头 */}
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
            <MessageSquarePlus size={13} className="text-accent" />
            <span className="text-xs font-medium text-ink">就这段问 AI</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={saveToMemory}
                disabled={!threadId || saved}
                title={saved ? '已存进记忆库待处理' : '把这轮对话存进记忆库，供之后教学用'}
                className={`flex h-7 items-center gap-1 rounded-md px-2 text-2xs transition-colors ${
                  saved
                    ? 'bg-ok/15 text-ok'
                    : threadId
                      ? 'bg-accent-soft text-accent hover:bg-accent/25'
                      : 'text-ink-mute opacity-40'
                }`}
              >
                <Save size={10} />
                {saved ? '已存入' : '存起来'}
              </button>
              <button onClick={onClose} className="rounded p-1.5 text-ink-mute hover:bg-surface-2 hover:text-ink">
                <X size={13} />
              </button>
            </div>
          </div>

          {/* 引用 */}
          <div className="shrink-0 border-b border-line bg-accent-soft/30 px-3 py-2">
            <div className="line-clamp-3 text-2xs leading-relaxed text-ink-dim">「{quote}」</div>
          </div>

          {/* 对话 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {messages.length === 0 && !busy && (
              <p className="mt-6 text-center text-2xs leading-relaxed text-ink-mute">
                这是个临时对话，不会进教材。
                <br />
                觉得有用就点右上「存起来」。
              </p>
            )}
            <div className="space-y-3">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[88%] rounded-lg rounded-br-sm bg-surface-3 px-2.5 py-1.5 text-xs leading-relaxed text-ink">
                      {m.content.replace(/^针对这段话：[\s\S]*?我的问题：/, '')}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="text-xs">
                    <MiniMarkdown text={m.content} />
                    {m.citations.length > 0 && (
                      <p className="mt-1 text-2xs text-ink-mute">来源 {m.citations.length} 处</p>
                    )}
                  </div>
                ),
              )}
              {busy && (
                <div className="flex items-center gap-1.5 text-2xs text-ink-mute">
                  <Loader2 size={11} className="animate-spin" />
                  正在查…
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            {err && <p className="mt-3 text-2xs text-danger">{err}</p>}
          </div>

          {/* 输入 */}
          <div className="shrink-0 border-t border-line px-3 py-2.5">
            <div className="flex items-end gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1.5 focus-within:border-line-strong">
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
                placeholder="这段话里哪儿不懂？"
                className="max-h-24 min-h-[22px] flex-1 resize-none bg-transparent text-xs leading-relaxed text-ink placeholder:text-ink-mute focus:outline-none"
              />
              <button
                onClick={() => void ask()}
                disabled={!input.trim() || busy}
                className="mb-0.5 rounded bg-accent px-2 py-1 text-2xs font-medium text-accent-fg disabled:opacity-30"
              >
                问
              </button>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

/* ============================================================
   高亮层：把已保存的标记画回正文
   ============================================================ */

/**
 * 在容器里按文本内容包 <mark>。
 * 用 TreeWalker 逐文本节点找，跨节点的匹配跳过（比 Range.surroundContents 稳，
 * 后者遇到跨节点直接抛异常）。
 */
export function HighlightLayer({
  containerRef,
  annotations,
  deps,
  onRecolor,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  annotations: Annotation[]
  deps: unknown
  /** 点了已经标过的文字，想把颜色换一个 */
  onRecolor?: (annId: string, at: { x: number; y: number }) => void
}) {
  useEffect(() => {
    const root = containerRef.current
    if (!root) return

    root.querySelectorAll('mark[data-ann]').forEach((m) => {
      const parent = m.parentNode
      if (!parent) return
      while (m.firstChild) parent.insertBefore(m.firstChild, m)
      parent.removeChild(m)
      parent.normalize()
    })

    if (annotations.length === 0) return

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.nodeValue && n.nodeValue.trim().length > 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    })

    const nodes: Text[] = []
    let cur = walker.nextNode()
    while (cur) {
      nodes.push(cur as Text)
      cur = walker.nextNode()
    }

    for (const ann of annotations) {
      const needle = ann.text.trim()
      if (needle.length < 2) continue
      for (const node of nodes) {
        const idx = node.nodeValue?.indexOf(needle) ?? -1
        if (idx < 0) continue
        try {
          const range = document.createRange()
          range.setStart(node, idx)
          range.setEnd(node, idx + needle.length)
          const mark = document.createElement('mark')
          mark.dataset.ann = ann.id
          // 按标记颜色上色，之前一律金色，白和蓝的标记看起来跟黄的一样。
          // 白色在深色底上最容易"看不见"，所以它额外加一道下划线。
          const tint =
            ann.color === 'white'
              ? 'rgba(248,250,252,0.30)'
              : ann.color === 'blue'
                ? 'rgba(56,189,248,0.32)'
                : 'rgba(252,211,77,0.40)'
          mark.style.background = tint
          mark.style.color = 'inherit'
          if (ann.color === 'white') {
            mark.style.boxShadow = 'inset 0 -2px 0 rgba(248,250,252,0.9)'
            mark.style.borderRadius = '2px 2px 0 0'
          } else if (ann.color === 'blue') {
            mark.style.boxShadow = 'inset 0 -2px 0 rgba(56,189,248,0.85)'
          } else {
            mark.style.boxShadow = 'inset 0 -2px 0 rgba(254,240,138,0.95)'
          }
          mark.style.borderRadius = '2px'
          mark.style.padding = '0 1px'
          mark.style.cursor = 'pointer'
          mark.title = '点一下换颜色'
          mark.addEventListener('click', (ev) => {
            ev.stopPropagation()
            const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
            onRecolor?.(ann.id, { x: r.left + r.width / 2, y: r.bottom + 8 })
          })
          range.surroundContents(mark)
          break // 每个标记只标第一处，避免页面开花
        } catch {
          /* 跨节点就跳过 */
        }
      }
    }
  }, [annotations, containerRef, deps, onRecolor])

  return null
}



/** 点已经标过的文字 → 在他下方弹三个色点，点一下就换色 */
export function RecolorPopover({
  at,
  current,
  onPick,
  onClose,
}: {
  at: { x: number; y: number } | null
  current?: string
  onPick: (color: 'yellow' | 'white' | 'blue') => void
  onClose: () => void
}) {
  if (!at) return null
  const items: { k: 'yellow' | 'white' | 'blue'; label: string; bg: string }[] = [
    { k: 'yellow', label: '黄', bg: '#fcd34d' },
    { k: 'white', label: '白', bg: '#f8fafc' },
    { k: 'blue', label: '蓝', bg: '#38bdf8' },
  ]
  return (
    <>
      <div className="fixed inset-0 z-[80]" onClick={onClose} />
      <div
        className="fixed z-[81] flex items-center gap-1 rounded-lg border border-line-strong bg-surface-3 p-1.5 shadow-2xl"
        style={{ left: Math.min(at.x - 60, window.innerWidth - 150), top: at.y }}
      >
        {items.map((it) => (
          <button
            key={it.k}
            onClick={() => onPick(it.k)}
            className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-[11px] font-semibold transition-transform hover:scale-110 ${
              current === it.k ? 'ring-2 ring-ink/40' : ''
            }`}
            style={{
              background: it.bg,
              borderColor: 'rgba(255,255,255,.25)',
              color: '#101114',
            }}
            title={it.label}
          >
            {it.label}
          </button>
        ))}
        <button
          onClick={onClose}
          className="ml-1 flex h-7 w-7 items-center justify-center rounded text-ink-mute hover:text-ink"
        >
          <X size={11} />
        </button>
      </div>
    </>
  )
}

export function AnnotationBadge({ count, onClear }: { count: number; onClear?: () => void }): ReactNode {
  if (count === 0) return null
  return (
    <span className="flex items-center gap-1 rounded-sm bg-accent-soft px-1.5 py-0.5 text-2xs text-accent">
      <Highlighter size={9} />
      已标 {count}
      {onClear && (
        <button onClick={onClear} className="ml-0.5 hover:text-danger">
          <Trash2 size={9} />
        </button>
      )}
    </span>
  )
}

/* ============================================================
   "多讲讲"写进来的补充块：左侧竖线表示主从，可折叠
   ============================================================ */

export function InsertBlock({
  title,
  content,
  onRemove,
  defaultOpen = true,
}: {
  title: string
  content: string
  onRemove?: () => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="my-3 ml-1 border-l-2 border-accent/45 pl-4">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-2xs font-medium text-accent/90 transition-colors hover:text-accent"
        >
          <ChevronDown size={11} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
          {title}
        </button>
        <span className="rounded-sm bg-accent-soft px-1 py-0.5 text-[9px] text-accent/80">补充</span>
        {onRemove && (
          <button onClick={onRemove} className="ml-auto text-2xs text-ink-mute hover:text-danger">
            <Trash2 size={10} />
          </button>
        )}
      </div>
      {open && (
        <div className="mt-1 text-[13.5px] opacity-95">
          <MiniMarkdown text={content} />
        </div>
      )}
    </div>
  )
}