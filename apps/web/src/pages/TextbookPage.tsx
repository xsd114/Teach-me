import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BookOpen,
  Download,
  Loader2,
  RefreshCw,
  Sparkles,
  ChevronLeft,
  CheckCircle2,
  UserRound,
  Wand2,
  Minimize2,
  Brain,
} from 'lucide-react'
import { textbookApi, type Textbook } from '../lib/api'
import { MiniMarkdown } from '../components/MiniMarkdown'
import { Figure, type FigureSpec } from '../components/Figures'
import {
  AskDrawer,
  HighlightLayer,
  RecolorPopover,
  SelectionMenu,
  useSelectionMenu,
  InsertBlock,
} from '../components/Selection'
import { annotationApi, growApi, type Annotation, type ChapterInsert } from '../lib/api'
import { ParaBadge } from '../components/ParaBadge'
import { BookMarked } from 'lucide-react'
import type { TextAnchor } from '../lib/anchor'

export function TextbookPage({
  courseId,
  fullscreen: fsProp,
  onFullscreenChange,
  onStartTeaching,
}: {
  courseId: string
  fullscreen?: boolean
  onFullscreenChange?: (v: boolean) => void
  onStartTeaching: () => void
}) {
  const [book, setBook] = useState<Textbook | null>(null)
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [anns, setAnns] = useState<Annotation[]>([])
  const [recolorAt, setRecolorAt] = useState<{ annId: string; x: number; y: number } | null>(null)
  const [askSel, setAskSel] = useState<{ text: string; context: string; anchor: TextAnchor | null } | null>(null)
  const [inserts, setInserts] = useState<Record<string, ChapterInsert[]>>({})
  const [, setGrowingId] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { sel, clear } = useSelectionMenu(true)
  const fullscreen = fsProp ?? false
  const setFullscreen = (v: boolean) => onFullscreenChange?.(v)
  const [scrollPct, setScrollPct] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(() => {
    const v = Number(localStorage.getItem('alp.textbookWidth'))
    return Number.isFinite(v) && v >= 520 && v <= 1600 ? v : 900
  })
  const applyWidth = (v: number) => {
    setWidth(v)
    localStorage.setItem('alp.textbookWidth', String(v))
  }

  const loadInserts = useCallback(async (chapterId: string) => {
    try {
      const r = await growApi.inserts(chapterId)
      setInserts((prev) => ({ ...prev, [chapterId]: r.inserts }))
    } catch {
      /* ignore */
    }
  }, [])

  const loadAnns = useCallback(async () => {
    try {
      const r = await annotationApi.list(courseId)
      setAnns(r.annotations)
    } catch {
      /* ignore */
    }
  }, [courseId])

  // 圆盘是在 App 里全局挂的，标完不会自动刷新这里的 state
  useEffect(() => {
    const h = () => void loadAnns()
    window.addEventListener('alp:annotations-changed', h)
    return () => window.removeEventListener('alp:annotations-changed', h)
  }, [loadAnns])

  useEffect(() => {
    void loadAnns()
  }, [loadAnns])

  const activeChapterId = book?.chapters[active]?.id
  useEffect(() => {
    if (activeChapterId) void loadInserts(activeChapterId)
  }, [activeChapterId, loadInserts])
  const load = useCallback(async () => {
    try {
      const r = await textbookApi.get(courseId)
      setBook(r.textbook)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '读取失败')
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    void load()
  }, [load])

  // 生成中自动轮询
  useEffect(() => {
    if (book?.status !== 'building') return
    const t = setInterval(() => void load(), 2500)
    return () => clearInterval(t)
  }, [book?.status, load])

  // 生成中：一章一个请求往下推。中途关掉/刷新页面也没关系，
  // 回到这页会从这里接着写（后端按章节 pending 状态记账）。
  useEffect(() => {
    const b = book
    if (!b || b.status !== 'building') return
    let alive = true
    const drive = async () => {
      for (let i = 0; i < 80 && alive; i++) {
        try {
          const r = await textbookApi.next(b.id)
          if (r.done) break
        } catch {
          // 这一章没写成：歇一下继续推下一章，别把循环打死
          await new Promise((res) => setTimeout(res, 4000))
        }
        if (!alive) return
        await load()
      }
      if (alive) await load()
    }
    void drive()
    return () => {
      alive = false
    }
  }, [book?.id, book?.status, load])

  const rebuild = async () => {
    setBusy(true)
    setErr(null)
    try {
      await textbookApi.build(courseId)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '失败')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-56 items-center justify-center gap-2 text-sm text-ink-mute">
        <Loader2 size={15} className="animate-spin" />
        正在翻开…
      </div>
    )
  }

  if (!book) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line text-center">
        <BookOpen size={26} strokeWidth={1.4} className="text-ink-mute" />
        <div>
          <p className="text-sm text-ink-dim">这门课还没有专属教材</p>
          <p className="mt-1 text-2xs text-ink-mute">先完成学情访谈，再让 ALP 为你写一本</p>
        </div>
      </div>
    )
  }

  if (book.status === 'building') {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <Loader2 size={20} className="animate-spin text-accent" />
        <div className="w-full max-w-xs">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full bg-accent transition-all duration-700" style={{ width: `${book.progress}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-2xs text-ink-mute">
            <span>{book.stage}</span>
            <span className="tabular-nums">{book.progress}%</span>
          </div>
        </div>
        <p className="text-xs text-ink-mute">
          已写好 {book.chapters.filter((c) => c.status === 'done').length}/{book.chapters.length || 0} 章，一章一个请求，可以关掉页面回头接着写
        </p>
      </div>
    )
  }

  const ch = book.chapters[active]

  /* ── 全屏沉浸模式 ── */
  if (fullscreen && ch) {
    const paras = ch.contentMd.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
    const list = inserts[ch.id] ?? []
    return (
      <div className="fixed inset-0 z-50 flex bg-base">
        {/* 左侧进度标尺 */}
        <div className="relative w-3 shrink-0 border-r border-line/60">
          <div
            className="absolute top-0 left-0 w-full bg-accent/70 transition-all duration-150"
            style={{ height: `${scrollPct}%` }}
          />
          {book.chapters.map((cc, i) => {
            const pos = (i / book.chapters.length) * 100
            const isActive = i === active
            return (
              <button
                key={cc.id}
                onClick={() => {
                  setActive(i)
                  setTimeout(() => scrollRef.current?.scrollTo({ top: 0 }), 30)
                }}
                title={`第 ${i + 1} 章 ${cc.title}`}
                className={`absolute -right-1 h-px transition-all ${
                  isActive ? 'w-3 bg-accent' : 'w-2 bg-line-strong hover:bg-ink-mute'
                }`}
                style={{ top: `${pos}%` }}
              />
            )
          })}
          <div className="absolute bottom-0 left-0 w-full text-center text-[8px] text-ink-mute">
            {Math.round(scrollPct)}%
          </div>
        </div>

        {/* 正文 */}
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget
            const max = el.scrollHeight - el.clientHeight
            setScrollPct(max > 0 ? Math.min(100, (el.scrollTop / max) * 100) : 100)
          }}
          className="min-w-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto w-full px-12 py-14" style={{ maxWidth: width }}>
            <div className="mb-1 text-2xs text-ink-mute">
              {book.title} · 第 {ch.orderIndex + 1} 章
            </div>
            <h1 className="mb-5 text-2xl font-semibold tracking-tight text-ink">{ch.title}</h1>

            {Array.isArray(ch.figures) && ch.figures.length > 0 && (
              <div className="mb-5">
                {(ch.figures as FigureSpec[]).map((f, i) => (
                  <Figure key={i} spec={f} />
                ))}
              </div>
            )}

            <div
              data-source-id={ch.id}
              data-source-kind="chapter"
              data-chapter-no={ch.orderIndex + 1}
              data-chapter-title={ch.title}
              className="leading-[1.9]"
            >
              {paras.map((para, pi) => (
                <div key={pi} data-para={pi} className="relative pr-12">
                  <ParaBadge label={'A' + (ch.orderIndex + 1) + '-' + (pi + 1)} />
                  <MiniMarkdown text={para} />
                  {list
                    .filter((ins) => ins.anchorIndex === pi)
                    .map((ins) => (
                      <InsertBlock key={ins.id} title={ins.title} content={ins.contentMd} />
                    ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 顶部浮动控件 */}
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('alp:open-study', { detail: { courseId } }))
            }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface/90 px-2.5 text-2xs text-ink-dim backdrop-blur hover:text-ink"
          >
            <Brain size={11} />
            自习问答
          </button>
          <button
            onClick={() => setFullscreen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface/90 text-ink-mute backdrop-blur hover:text-ink"
            title="退出全屏"
          >
            <Minimize2 size={12} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full gap-5">
      {/* 目录 */}
      <aside className="w-56 shrink-0">
        <div className="sticky top-0">
          <div className="mb-3">
            <h3 className="text-sm leading-snug font-semibold text-ink">{book.title}</h3>
            <p className="mt-0.5 text-2xs leading-relaxed text-ink-mute">{book.subtitle}</p>
          </div>

          {book.profile && (
            <div className="mb-3 flex items-start gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-2">
              <UserRound size={10} className="mt-0.5 shrink-0 text-ink-mute" />
              <p className="text-2xs leading-relaxed text-ink-mute">{book.profile.summary}</p>
            </div>
          )}

          <div className="mb-2 flex items-center gap-1">
            <button
              onClick={onStartTeaching}
              className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-accent text-2xs font-medium text-accent-fg hover:bg-accent-hover"
            >
              <Sparkles size={10} />
              按这本书上课
            </button>
            <a
              href={textbookApi.exportUrl(book.id)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-ink-mute hover:text-ink"
              title="导出为 Markdown"
            >
              <Download size={11} />
            </a>

            <button
              onClick={rebuild}
              disabled={busy}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-ink-mute hover:text-ink disabled:opacity-40"
              title="整本重写"
            >
              <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
            </button>
          </div>


          <nav className="space-y-0.5">
            {book.chapters.map((c, i) => (
              <button
                key={c.id}
                onClick={() => setActive(i)}
                className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                  i === active
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-dim hover:bg-surface-2 hover:text-ink'
                }`}
              >
                <span className="w-3 shrink-0 text-2xs tabular-nums opacity-60">{i + 1}</span>
                <span className="line-clamp-2 leading-snug">{c.title}</span>
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* 正文 */}
      <div className="min-w-0 flex-1 overflow-y-auto px-2">
        {err && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {err}
          </div>
        )}

        {active === 0 && book.preface && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 rounded-lg border border-accent/25 bg-accent-soft/30 px-4 py-3"
          >
            <div className="mb-1 text-2xs font-medium text-accent">前言</div>
            <p className="text-sm leading-relaxed text-ink-dim">{book.preface}</p>
          </motion.div>
        )}

        {ch && (
          <motion.article
            key={ch.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="mb-1 flex items-center gap-2 text-2xs text-ink-mute">
              <ChevronLeft size={10} className="opacity-0" />
              <span className="tabular-nums">第 {ch.orderIndex + 1} 章</span>
            <span className="mx-1 text-line-strong">|</span>
            <span className="flex items-center gap-1.5">
              <span className="text-[10px] text-ink-mute">宽</span>
              <input
                type="range"
                min={560}
                max={1520}
                step={20}
                value={width}
                onChange={(e) => applyWidth(Number(e.target.value))}
                title="拖动改教材宽度"
                className="h-1 w-24 accent-[var(--color-accent)]"
              />
              <span className="w-9 text-[10px] tabular-nums text-ink-mute">{width}</span>
            </span>
              {ch.wordCount > 0 && <span className="tabular-nums">· {ch.wordCount} 字</span>}
            </div>
            <h2 className="mb-1 text-xl font-semibold tracking-tight text-ink">{ch.title}</h2>
            {ch.goal && (
              <p className="mb-4 rounded-md bg-surface-2 px-3 py-2 text-2xs leading-relaxed text-ink-dim">
                <span className="text-ink-mute">这一章要做到：</span>
                {ch.goal}
              </p>
            )}

            {Array.isArray(ch.figures) && ch.figures.length > 0 && (
              <div className="mb-4 space-y-1">
                {(ch.figures as FigureSpec[]).map((f, i) => (
                  <Figure key={i} spec={f} />
                ))}
              </div>
            )}

            <div
              ref={bodyRef}
              data-source-id={ch.id}
              data-source-kind="chapter"
              data-chapter-no={ch.orderIndex + 1}
              data-chapter-title={ch.title}
              className="mx-auto w-full px-8 leading-[1.9]"
              style={{ maxWidth: width }}
            >
              {(() => {
                const paras = ch.contentMd.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
                const list = inserts[ch.id] ?? []
                return paras.map((para, pi) => (
                  <div key={pi} data-para={pi} className="relative pr-12">
                    <ParaBadge label={'A' + (ch.orderIndex + 1) + '-' + (pi + 1)} />
                    <MiniMarkdown text={para} />
                    {list
                      .filter((ins) => ins.anchorIndex === pi)
                      .map((ins) => (
                        <InsertBlock
                          key={ins.id}
                          title={ins.title}
                          content={ins.contentMd}
                          onRemove={async () => {
                            await growApi.remove(ins.id)
                            await loadInserts(ch.id)
                          }}
                        />
                      ))}
                  </div>
                ))
              })()}
              {/* 锚点没对上（-1）的补充放章末 */}
              {(inserts[ch.id] ?? [])
                .filter((ins) => ins.anchorIndex < 0)
                .map((ins) => (
                  <InsertBlock
                    key={ins.id}
                    title={ins.title}
                    content={ins.contentMd}
                    onRemove={async () => {
                      await growApi.remove(ins.id)
                      await loadInserts(ch.id)
                    }}
                  />
                ))}
            </div>
            <HighlightLayer
            containerRef={bodyRef}
            annotations={anns}
            deps={ch.id}
            onRecolor={(annId, at) => setRecolorAt({ annId, ...at })}
          />

            {ch.selfCheck && (
              <div className="mt-5 rounded-lg border border-ok/25 bg-ok/[0.06] px-4 py-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-medium text-ok">
                  <CheckCircle2 size={11} />
                  你现在应该能做到
                </div>
                <ul className="space-y-1">
                  {ch.selfCheck.split(/[;；]/).filter(Boolean).map((s, i) => (
                    <li key={i} className="text-2xs leading-relaxed text-ink-dim">
                      · {s.trim()}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {ch.wordCount === 0 && (
              <button
                onClick={async () => {
                  setBusy(true)
                  try {
                    await textbookApi.rewriteChapter(ch.id)
                    await load()
                  } finally {
                    setBusy(false)
                  }
                }}
                disabled={busy}
                className="mt-3 flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-2xs text-ink-dim hover:text-ink"
              >
                <Wand2 size={11} />
                重写这一章
              </button>
            )}

            {active < book.chapters.length - 1 && (
              <button
                onClick={() => setActive(active + 1)}
                className="mt-6 mb-4 flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-xs text-ink-dim hover:bg-surface-2 hover:text-ink"
              >
                下一章：{book.chapters[active + 1].title}
              </button>
            )}
          </motion.article>
        )}
      </div>

      {/* 自习入口：现在统一去「自习问答」页（原来是个浮层） */}
      <button
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent('alp:open-study', { detail: { courseId } }),
          )
        }}
        className="fixed right-6 bottom-6 z-30 flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-xs font-medium text-accent-fg shadow-xl transition-transform hover:scale-[1.03]"
      >
        <BookMarked size={14} />
        自习问答
      </button>

      <RecolorPopover
        at={recolorAt ? { x: recolorAt.x, y: recolorAt.y } : null}
        current={anns.find((a) => a.id === recolorAt?.annId)?.color}
        onPick={(color) => {
          if (!recolorAt) return
          const id = recolorAt.annId
          setRecolorAt(null)
          setAnns((list) => list.map((a) => (a.id === id ? { ...a, color } : a)))
          void annotationApi.recolor(id, color)
        }}
        onClose={() => setRecolorAt(null)}
      />

      <SelectionMenu
        sel={sel}
        courseId={courseId}
        onAsk={(s) => {
          setAskSel({
            text: s.text,
            context: `...${s.contextBefore}≪${s.text}≫${s.contextAfter}...`,
            anchor: s.anchor,
          })
          clear()
        }}
        onGrow={async (s) => {
          const chId = ch?.id
          if (!chId) return
          setGrowingId(chId)
          try {
            await growApi.expand(chId, {
              sourceText: s.text,
              anchorIndex: s.anchorIndex >= 0 ? s.anchorIndex : undefined,
              contextBefore: s.contextBefore,
              contextAfter: s.contextAfter,
            })
            await loadInserts(chId)
          } catch (e) {
            setErr(e instanceof Error ? e.message : '续写失败')
          } finally {
            setGrowingId(null)
          }
          clear()
          window.getSelection()?.removeAllRanges()
        }}
        onHighlighted={(a) => {
          setAnns((prev) => [a, ...prev])
          clear()
          window.getSelection()?.removeAllRanges()
        }}
      />

      <AskDrawer
        open={Boolean(askSel)}
        quote={askSel?.text ?? ''}
        anchor={askSel?.anchor ?? null}
        context={askSel?.context ?? ''}
        courseId={courseId}
        onFullscreen={({ threadId, quote, context }) => {
          setAskSel(null)
          window.dispatchEvent(
            new CustomEvent('alp:ask-fullscreen', {
              detail: { threadId, courseId, quote, context },
            }),
          )
        }}
        onClose={() => {
          setAskSel(null)
          void loadAnns()
        }}
      />
    </div>
  )
}