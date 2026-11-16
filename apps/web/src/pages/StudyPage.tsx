import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookMarked, Send, Loader2, Hash, ImagePlus, Camera, BookX, Database, Check, Sparkles,
  ChevronDown, BookOpen, Plus, Volume2, VolumeX, Mic, Radio, ExternalLink, Maximize2,
} from 'lucide-react'
import {
  api, selfStudyApi, mistakeApi, mossApi,
  type ChatImage, type Citation, type QaMessage, type SelfStudyResult,
} from '../lib/api'
import type { Course } from '../lib/types'
import { MiniMarkdown } from '../components/MiniMarkdown'
import { Figure, type FigureSpec } from '../components/Figures'
import { QuoteChip, ImageTray, imagesFromPaste, imagesFromFiles, readImage, describeImages } from '../components/Composer'
import { anchorLabel, type TextAnchor } from '../lib/anchor'
import { loadVoiceSettings, speakSmart, stopAll } from '../lib/voice'
import { Modal } from '../components/Modal'

/**
 * 自习问答（书架 / 自习 / 设置 里那个「自习」）
 *
 * 这一页是原来「问答」和「自习模式」合起来的：
 *   · 先选科目（或者「全部科目」）再开始自习
 *   · 单科目：带编号定位（A2-3 / Q1）、回答能给图、能存错题本和记忆库
 *   · 全部科目：跨库检索，像普通问答那样给来源
 *   · 引用一句话来问：位置锚一起发出去，模型不用再问「哪一段」
 *   · 图可以先贴上来停在输入框上方，不进对话也不发出去
 *   · 语音默认关，右下角一个按钮，点了才告诉你怎么配
 */

type Turn = {
  id: string
  role: 'user' | 'assistant'
  /** 用户消息是问句原文；assistant 是正文 */
  text: string
  kind?: SelfStudyResult['kind']
  options?: { label: string; preview: string }[]
  figures?: unknown[]
  /** 回答命中的段落编号 */
  label?: string
  citations?: Citation[]
  /** 这条用户消息引用了哪段话 */
  quote?: TextAnchor | null
  images?: ChatImage[]
  /** 用户原话，存错题本时要 */
  q?: string
  savedToMistakes?: boolean
  savedToMemory?: boolean
  saving?: 'mistake' | 'memory' | null
  at: string
}

type AiState = 'idle' | 'thinking' | 'reading' | 'answering'

const STATE_LABEL: Record<AiState, string> = {
  idle: '待命',
  thinking: '在想…',
  reading: '翻教材…',
  answering: '在写答案…',
}

/** 从划词抽屉"全屏"过来时带的东西 */
export type StudyTransfer = {
  threadId: string
  courseId: string | null
  quote: TextAnchor | null
  /** 选中处前后各约 1000 字，只发给模型，不显示 */
  context: string
}

/**
 * 切到书架/设置再回来，聊到一半的内容不该没。
 * 只放在内存里：关掉程序就清空（真正的对话记录本来就在 qa_thread 里）。
 */
type StudyCache = {
  scope: string | null | undefined
  turns: Turn[]
  threadId: string | null
  qaContext: string
}
let STUDY_CACHE: StudyCache | null = null

export function StudyPage({
  courses,
  initialCourseId,
  transfer,
  onOpenSettings,
}: {
  courses: Course[]
  /** 从课程页点「自习」进来时直接定好科目 */
  initialCourseId?: string | null
  /** 划词抽屉点「全屏」过来：带着线程和引用 */
  transfer?: StudyTransfer | null
  onOpenSettings: () => void
}) {
  // 有 transfer 就按 transfer 走；否则回到上次离开时的样子
  const cached =
    !transfer && STUDY_CACHE && STUDY_CACHE.scope === (initialCourseId === undefined ? undefined : initialCourseId)
      ? STUDY_CACHE
      : null

  // undefined = 还没选科目，停在"开始自习"那一页
  const [scope, setScope] = useState<string | null | undefined>(
    transfer ? transfer.courseId : initialCourseId === undefined ? undefined : initialCourseId,
  )
  const [turns, setTurns] = useState<Turn[]>(cached?.turns ?? [])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [aiState, setAiState] = useState<AiState>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [images, setImages] = useState<ChatImage[]>([])
  const [quote, setQuote] = useState<TextAnchor | null>(transfer?.quote ?? null)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [ttsOn, setTtsOn] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [scopeOpen, setScopeOpen] = useState(false)

  // 划词过来的对话接着用同一个 qa 线程，历史不丢
  const [threadId, setThreadId] = useState<string | null>(transfer?.threadId ?? cached?.threadId ?? null)
  const [qaContext, setQaContext] = useState<string>(transfer?.context ?? cached?.qaContext ?? '')
  /** 是否是从右侧抽屉「全屏」接过来的（决定顶栏那个小标签要不要亮） */
  const [linked, setLinked] = useState(Boolean(transfer?.threadId))

  const [stats, setStats] = useState<{ materials: number; chunks: number; hasKey: boolean } | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const voice = useRef(loadVoiceSettings())

  // 记住这一页的样子，切走再回来接得上
  useEffect(() => {
    if (scope === undefined) return
    STUDY_CACHE = { scope, turns, threadId, qaContext }
  }, [scope, turns, threadId, qaContext])

  const scopeLabel = scope === undefined ? '未选择' : scope === null ? '全部科目' : courses.find((c) => c.id === scope)?.title ?? '该科目'
  const inQaMode = scope === null || Boolean(threadId)

  /* ── 状态条 ── */
  const loadStats = useCallback(async () => {
    try {
      const s = await api.qaStatus(scope === undefined ? null : scope)
      setStats({ materials: s.materials, chunks: s.chunks, hasKey: s.hasKey })
    } catch {
      setStats(null)
    }
  }, [scope])

  useEffect(() => {
    if (scope === undefined) return
    void loadStats()
  }, [loadStats, scope])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, busy])

  /* ── 划词"全屏"过来：把原来那条线程的对话拉回来 ── */
  useEffect(() => {
    if (!transfer?.threadId) return
    let alive = true
    void api
      .qaThread(transfer.threadId)
      .then((r) => {
        if (!alive) return
        setTurns(
          r.messages.map((m) => toTurn(m)),
        )
      })
      .catch(() => {
        if (alive) setErr('这段对话没能拉回来，可以从头再问一次')
      })
    return () => {
      alive = false
    }
  }, [transfer?.threadId])

  /* ── 整页都能粘贴图片 ── */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (document.activeElement === textareaRef.current) return // 输入框自己会处理
      const files = imagesFromPaste(e)
      if (!files.length) return
      e.preventDefault()
      void addImages(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addImages = async (files: File[]) => {
    const imgs = await Promise.all(files.map((f) => readImage(f)))
    setImages((prev) => [...prev, ...imgs])
  }

  /* ══════════════════ 提问 ══════════════════ */

  const ask = useCallback(
    async (raw: string, label?: string) => {
      const q = raw.trim()
      const hasAttach = Boolean(quote?.quote) || images.length > 0
      if ((!q && !hasAttach) || busy) return
      if (scope === undefined) return

      const question = q || '这段话能帮我讲讲吗？'
      const withImageNote = question + describeImages(images)
      const usedQuote = quote
      const usedImages = images

      setBusy(true)
      setErr(null)
      setAiState('thinking')
      setInput('')
      setImages([])
      setQuote(null)

      setTurns((t) => [
        ...t,
        {
          id: `u${Date.now()}`,
          role: 'user',
          text: question,
          q: question,
          quote: usedQuote,
          images: usedImages.length ? usedImages : undefined,
          at: new Date().toISOString(),
        },
      ])

      const t1 = setTimeout(() => setAiState('reading'), 900)
      const t2 = setTimeout(() => setAiState('answering'), 3200)

      try {
        if (inQaMode) {
          const r = await api.qaAsk(withImageNote, scope, threadId, {
            context: qaContext || undefined,
            quote: usedQuote?.quote,
            anchor: usedQuote,
          })
          setThreadId(r.threadId)
          setTurns((t) => [
            ...t,
            {
              id: r.messageId,
              role: 'assistant',
              text: r.answer,
              citations: r.citations,
              q: question,
              at: new Date().toISOString(),
            },
          ])
        } else {
          const r = await selfStudyApi.ask(scope, withImageNote, label, {
            anchor: usedQuote,
            quote: usedQuote?.quote,
          })
          const turnId = `s${Date.now()}`
          setTurns((t) => [
            ...t,
            {
              id: turnId,
              role: 'assistant',
              text: r.message,
              kind: r.kind,
              options: r.options,
              figures: r.figures,
              label: r.paragraph?.label,
              q: question,
              at: new Date().toISOString(),
            },
          ])
          if (ttsOn && r.kind === 'answer') {
            setSpeakingId(turnId)
            void speakSmart(r.message, { voiceName: voice.current.voiceName, rate: voice.current.rate })
          }
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : '出错了')
      } finally {
        clearTimeout(t1)
        clearTimeout(t2)
        setAiState('idle')
        setBusy(false)
      }
    },
    [busy, images, inQaMode, qaContext, quote, scope, threadId, ttsOn],
  )

  /* ── 错题本 / 记忆库 ── */
  const addToMistakes = async (t: Turn) => {
    if (!scope) return
    setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, saving: 'mistake' } : x)))
    try {
      await mistakeApi.add({
        courseId: scope,
        label: t.label ?? '',
        question: t.q ?? '',
        answer: t.text,
        source: 'selfstudy',
      })
      setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, saving: null, savedToMistakes: true } : x)))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '存错题失败')
      setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, saving: null } : x)))
    }
  }

  const addToMemory = async (t: Turn) => {
    if (!scope) return
    setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, saving: 'memory' } : x)))
    try {
      await mistakeApi.remember({
        courseId: scope,
        label: t.label ?? '',
        question: t.q ?? '',
        answer: t.text,
      })
      setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, saving: null, savedToMemory: true } : x)))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '存记忆库失败')
      setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, saving: null } : x)))
    }
  }

  const newChat = () => {
    setTurns([])
    setThreadId(null)
    setQaContext('')
    setQuote(null)
    setImages([])
    setErr(null)
    setLinked(false)
    stopAll()
  }

  const pickScope = (id: string | null) => {
    setScope(id)
    setScopeOpen(false)
    newChat()
  }

  /* ══════════════════ 还没选科目 ══════════════════ */

  if (scope === undefined) {
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-[860px] px-8 py-12">
          <div className="mb-1 flex items-center gap-2 text-2xs text-ink-mute">
            <BookMarked size={12} />
            自习问答
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">想自己看书，还是想问我？</h1>
          <p className="prose-narrow mt-1.5 text-sm leading-relaxed text-ink-dim">
            选一门科目我就带上它的教材和记忆库陪读；选「全部科目」就跨所有课回答。
            <br />
            对话里可以随时引用一段原话，我会连位置一起记住。
          </p>

          <button
            onClick={() => pickScope(null)}
            className="mt-6 flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3.5 text-left transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-accent">
              <Sparkles size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">全部科目</span>
              <span className="mt-0.5 block text-2xs text-ink-mute">
                跨所有课程的记忆库检索，答案会标来源；没有教材编号可定位
              </span>
            </span>
            <ChevronDown size={14} className="-rotate-90 text-ink-mute" />
          </button>

          <div className="mt-5 mb-2 text-2xs text-ink-mute">或者选一门课</div>
          {courses.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface-2/50 px-4 py-6 text-center text-xs text-ink-mute">
              还没有课程。先去「书架」建一门，或者导入教材。
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {courses.map((c) => (
                <button
                  key={c.id}
                  onClick={() => pickScope(c.id)}
                  className="flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-3 text-left transition-colors hover:border-line-strong hover:bg-surface-2"
                >
                  <BookOpen size={14} className="mt-0.5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{c.title}</span>
                    <span className="mt-0.5 block truncate text-2xs text-ink-mute">
                      {c.kind === 'academic' ? '学业' : '技能'} · {c.stats.lessonTotal} 节
                      {c.goal ? ` · ${c.goal}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  /* ══════════════════ 对话 ══════════════════ */

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
        <span className="text-sm font-medium text-ink">自习问答</span>

        <div className="relative">
          <button
            onClick={() => setScopeOpen((v) => !v)}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <BookOpen size={12} />
            <span className="max-w-44 truncate">{scopeLabel}</span>
            <ChevronDown size={12} />
          </button>
          {scopeOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setScopeOpen(false)} />
              <div className="absolute top-full left-0 z-20 mt-1 w-64 overflow-hidden rounded-md border border-line bg-surface-3 py-1 shadow-xl">
                <ScopeItem
                  active={scope === null}
                  title="全部科目"
                  sub="跨所有记忆库检索"
                  onClick={() => pickScope(null)}
                />
                {courses.map((c) => (
                  <ScopeItem
                    key={c.id}
                    active={scope === c.id}
                    title={c.title}
                    sub="只在这门课里找"
                    onClick={() => pickScope(c.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-2xs text-ink-mute">
          <Database size={11} />
          {stats ? `${stats.materials} 份资料 · ${stats.chunks} 个分片` : '统计中…'}
        </div>

        <div className="ml-4 flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1">
          <motion.span
            animate={aiState === 'idle' ? { opacity: 0.5 } : { opacity: [0.4, 1, 0.4], scale: [1, 1.25, 1] }}
            transition={{ duration: 1.4, repeat: aiState === 'idle' ? 0 : Infinity }}
            className={`h-1.5 w-1.5 rounded-full ${aiState === 'idle' ? 'bg-ink-mute' : 'bg-accent'}`}
          />
          <span className="text-[10px] text-ink-dim">{STATE_LABEL[aiState]}</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {linked && (
            <span className="flex items-center gap-1 rounded-sm bg-info/10 px-1.5 py-0.5 text-[10px] text-info">
              <Maximize2 size={9} />
              已接上一段对话
            </span>
          )}
          <button
            onClick={newChat}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Plus size={12} />
            新对话
          </button>
        </div>
      </div>

      {/* 对话区 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[74ch] px-6 py-6">
          {turns.length === 0 && !busy ? (
            <div className="flex flex-col items-center py-14 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-line bg-surface">
                <BookMarked size={22} strokeWidth={1.4} className="text-ink-mute" />
              </div>
              <h2 className="mb-1.5 text-base font-medium text-ink">开始自习</h2>
              <p className="prose-narrow text-xs leading-relaxed text-ink-dim">
                读到哪儿卡住了就问。带上编号我能直接定位：段落是{' '}
                <code className="text-accent">A1-3</code>，题目是 <code className="text-accent">Q1</code>。
                <br />
                也可以从教材里选一句话来问，位置我会自己记下来。
              </p>
              {stats && !stats.hasKey && (
                <p className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-2xs text-warn">
                  还没配置模型 API Key，去「设置」里填一个
                </p>
              )}
              {stats && stats.chunks === 0 && (
                <p className="mt-3 text-2xs text-ink-mute">
                  这个科目还没有已索引的资料，答案会基于模型自身知识（会说明这一点）
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {turns.map((t) =>
                t.role === 'user' ? (
                  <div key={t.id} className="flex justify-end">
                    <div className="max-w-[86%] rounded-xl rounded-br-sm bg-surface-3 px-3.5 py-2.5 text-sm leading-relaxed text-ink">
                      {t.quote?.quote && (
                        <div className="mb-2 rounded-md border-l-2 border-accent/60 bg-base/40 px-2 py-1.5">
                          <div className="text-[10px] text-ink-mute">{anchorLabel(t.quote) || '引用'}</div>
                          <div className="mt-0.5 line-clamp-3 text-2xs leading-relaxed text-ink-dim">
                            「{t.quote.quote}」
                          </div>
                        </div>
                      )}
                      {t.images?.length ? (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {t.images.map((im) => (
                            <img
                              key={im.id}
                              src={im.dataUrl}
                              alt={im.name}
                              className="h-20 w-20 rounded-md border border-line object-cover"
                            />
                          ))}
                        </div>
                      ) : null}
                      {t.text}
                    </div>
                  </div>
                ) : (
                  <AnswerCard
                    key={t.id}
                    turn={t}
                    canSave={Boolean(scope)}
                    speaking={speakingId === t.id}
                    onSpeak={() => {
                      if (speakingId === t.id) {
                        stopAll()
                        setSpeakingId(null)
                      } else {
                        setSpeakingId(t.id)
                        void speakSmart(t.text, { voiceName: voice.current.voiceName, rate: voice.current.rate })
                      }
                    }}
                    onPick={(label) => void ask(input || '这里不懂', label)}
                    onMistake={() => void addToMistakes(t)}
                    onMemory={() => void addToMemory(t)}
                  />
                ),
              )}
              {busy && (
                <div className="flex items-center gap-2 text-2xs text-ink-mute">
                  <Loader2 size={12} className="animate-spin" />
                  {STATE_LABEL[aiState]}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {err && (
            <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-2xs text-danger">
              {err}
            </div>
          )}
        </div>
      </div>

      {/* 输入区 */}
      <div className="shrink-0 px-6 pb-4">
        <div className="mx-auto w-full max-w-[74ch]">
          <div className="rounded-xl border border-line bg-surface px-3 py-2.5 focus-within:border-line-strong">
            <QuoteChip anchor={quote} onClear={() => setQuote(null)} />
            <ImageTray images={images} onRemove={(id) => setImages((p) => p.filter((x) => x.id !== id))} />

            <div className="flex items-end gap-1.5">
              <button
                onClick={() => fileRef.current?.click()}
                title="选图片（也可以直接 Ctrl+V 粘贴）"
                className="mb-1 rounded p-1 text-ink-mute transition-colors hover:bg-surface-3 hover:text-ink"
              >
                <ImagePlus size={14} />
              </button>
              <button
                onClick={() => void grabScreen()}
                title="截一张屏贴进来"
                className="mb-1 rounded p-1 text-ink-mute transition-colors hover:bg-surface-3 hover:text-ink"
              >
                <Camera size={14} />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void addImages(imagesFromFiles(e.target.files))
                  e.target.value = ''
                }}
              />

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={(e) => {
                  const files = imagesFromPaste(e)
                  if (files.length) {
                    e.preventDefault()
                    void addImages(files)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void ask(input)
                  }
                }}
                rows={1}
                placeholder={
                  scope === null
                    ? '问点什么…（Enter 发送，Shift+Enter 换行，可直接粘贴图片）'
                    : 'A1-3 这里为什么要冒烟？（可直接粘贴图片）'
                }
                className="max-h-40 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-sm leading-relaxed text-ink placeholder:text-ink-mute focus:outline-none"
              />

              <button
                onClick={() => void ask(input)}
                disabled={(!input.trim() && !quote && !images.length) || busy}
                className="mb-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-30"
              >
                <Send size={13} />
              </button>
            </div>
          </div>

          <div className="mt-1.5 flex items-center gap-3 px-0.5 text-[10px] text-ink-mute">
            <span>Enter 发送 · Shift+Enter 换行</span>
            <span className="flex items-center gap-0.5">
              <Sparkles size={8} />
              {inQaMode ? '跨库检索 · 答案会标来源' : '按段落编号定位'}
            </span>
            <button
              onClick={() => setVoiceOpen(true)}
              className="ml-auto flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[10px] text-ink-mute transition-colors hover:border-line-strong hover:text-ink"
              title="语音默认关着，点这里看怎么开"
            >
              <Mic size={9} />
              {ttsOn ? '语音已开' : '语音'}
            </button>
          </div>
        </div>
      </div>

      <VoiceHelpModal
        open={voiceOpen}
        ttsOn={ttsOn}
        onToggle={(v) => {
          setTtsOn(v)
          if (!v) {
            stopAll()
            setSpeakingId(null)
          }
        }}
        onClose={() => setVoiceOpen(false)}
        onOpenSettings={() => {
          setVoiceOpen(false)
          onOpenSettings()
        }}
      />
    </div>
  )

  /* ── 截屏（原来自习模式里那个，搬过来） ── */
  async function grabScreen() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const track = stream.getVideoTracks()[0]
      const video = document.createElement('video')
      video.srcObject = stream
      await video.play()
      await new Promise((r) => setTimeout(r, 300))
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)
      track.stop()
      const dataUrl = canvas.toDataURL('image/png')
      setImages((prev) => [
        ...prev,
        { id: `cap${Date.now()}`, name: '截图.png', dataUrl, w: canvas.width, h: canvas.height },
      ])
    } catch {
      setErr('截图取消了')
      setTimeout(() => setErr(null), 2500)
    }
  }
}

/* ══════════════════════ 小件 ══════════════════════ */

function toTurn(m: QaMessage): Turn {
  return {
    id: m.id,
    role: m.role === 'user' ? 'user' : 'assistant',
    text: m.content,
    citations: m.citations,
    quote: (m.attach?.anchor as TextAnchor | null | undefined) ?? null,
    q: m.role === 'user' ? m.content : undefined,
    at: m.createdAt,
  }
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

function AnswerCard({
  turn,
  canSave,
  speaking,
  onSpeak,
  onPick,
  onMistake,
  onMemory,
}: {
  turn: Turn
  canSave: boolean
  speaking: boolean
  onSpeak: () => void
  onPick: (label: string) => void
  onMistake: () => void
  onMemory: () => void
}) {
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (turn.savedToMistakes) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 620)
      return () => clearTimeout(t)
    }
  }, [turn.savedToMistakes])

  const isAnswer = turn.kind !== 'need_paragraph' && turn.kind !== 'need_clarify'
  const breathing = turn.saving === 'memory'

  return (
    <motion.div
      animate={
        flash
          ? {
              backgroundColor: [
                'rgba(231,183,95,0)',
                'rgba(231,183,95,0.22)',
                'rgba(255,255,255,0.10)',
                'rgba(231,183,95,0)',
              ],
              scale: [1, 1.006, 1],
            }
          : { backgroundColor: 'rgba(0,0,0,0)' }
      }
      transition={{ duration: 0.6, times: [0, 0.18, 0.42, 1] }}
      className={`relative rounded-xl border bg-surface-2 px-4 py-3 ${breathing ? 'border-transparent' : 'border-line'}`}
    >
      <AnimatePresence>
        {breathing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.45, 1, 0.45] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity }}
            className="pointer-events-none absolute -inset-px rounded-xl"
            style={{
              background:
                'conic-gradient(from 0deg, #ff6b6b, #ffd93d, #6bcf7f, #4ecdc4, #5b8def, #c77dff, #ff6b6b)',
              padding: 1.5,
              WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
            }}
          />
        )}
      </AnimatePresence>

      {turn.label && (
        <div className="mb-1.5 flex items-center gap-1 text-2xs text-accent">
          <Hash size={9} />
          {turn.label}
        </div>
      )}

      {isAnswer ? (
        <>
          <div className="text-[13.5px]">
            <MiniMarkdown text={turn.text} />
          </div>

          {Array.isArray(turn.figures) && turn.figures.length > 0 && (
            <div className="mt-2">
              {(turn.figures as FigureSpec[]).map((f, i) => (
                <Figure key={i} spec={f} />
              ))}
            </div>
          )}

          {turn.citations && turn.citations.length > 0 && <CitationList items={turn.citations} />}

          <div className="mt-2.5 flex items-center justify-end gap-1.5">
            <button
              onClick={onSpeak}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors ${
                speaking
                  ? 'border-accent/50 bg-accent-soft text-accent'
                  : 'border-line text-ink-mute hover:border-line-strong hover:text-ink'
              }`}
            >
              {speaking ? <VolumeX size={9} /> : <Volume2 size={9} />}
              {speaking ? '停止' : '念一遍'}
            </button>

            {canSave && (
              <>
                <button
                  onClick={onMistake}
                  disabled={turn.savedToMistakes || Boolean(turn.saving)}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors ${
                    turn.savedToMistakes
                      ? 'border-ok/40 bg-ok/10 text-ok'
                      : 'border-line text-ink-mute hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {turn.savedToMistakes ? <Check size={9} /> : <BookX size={9} />}
                  {turn.savedToMistakes ? '已进错题本' : '加入错题本'}
                </button>
                <button
                  onClick={onMemory}
                  disabled={turn.savedToMemory || Boolean(turn.saving)}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors ${
                    turn.savedToMemory
                      ? 'border-info/40 bg-info/10 text-info'
                      : 'border-line text-ink-mute hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {turn.savedToMemory ? <Check size={9} /> : <Database size={9} />}
                  {turn.savedToMemory ? '已存记忆库' : '存入记忆库'}
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-ink-dim">{turn.text}</p>
          {turn.options && turn.options.length > 0 && (
            <div className="mt-2 max-h-52 space-y-0.5 overflow-y-auto">
              {turn.options.slice(0, 24).map((o) => (
                <button
                  key={o.label}
                  onClick={() => onPick(o.label)}
                  className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-surface-3"
                >
                  <code className="shrink-0 font-mono text-2xs text-accent">{o.label}</code>
                  <span className="truncate text-2xs text-ink-mute">{o.preview}</span>
                </button>
              ))}
            </div>
          )}
          {turn.kind === 'need_clarify' && (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-ink-mute">
              <Sparkles size={8} />
              说清楚"哪一步"我就能答准
            </div>
          )}
        </>
      )}
    </motion.div>
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
        来源 {items.length} 处
        {items.length > 3 && <ChevronDown size={10} className={open ? 'rotate-180' : ''} />}
      </button>
      <div className="space-y-1">
        {shown.map((c) => (
          <div
            key={c.n}
            className="rounded-md border border-line bg-surface/60 px-2.5 py-1.5 text-2xs leading-relaxed text-ink-mute"
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

/* ══════════════════════ 语音怎么开 ══════════════════════ */

function VoiceHelpModal({
  open,
  ttsOn,
  onToggle,
  onClose,
  onOpenSettings,
}: {
  open: boolean
  ttsOn: boolean
  onToggle: (v: boolean) => void
  onClose: () => void
  onOpenSettings: () => void
}) {
  const [moss, setMoss] = useState<{ configured: boolean; model: string; voiceId: string } | null>(null)

  useEffect(() => {
    if (!open) return
    void mossApi
      .status()
      .then((s) => setMoss({ configured: s.configured, model: s.model, voiceId: s.voiceId }))
      .catch(() => setMoss(null))
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="语音怎么开"
      subtitle="默认是关着的 —— 不想听就不配，对话照样用"
      width={520}
      footer={
        <>
          <button
            onClick={onOpenSettings}
            className="ml-auto flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm text-ink-dim hover:bg-surface-2 hover:text-ink"
          >
            <ExternalLink size={12} />
            去设置里填
          </button>
          <button
            onClick={onClose}
            className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            知道了
          </button>
        </>
      }
    >
      <ol className="space-y-3 text-xs leading-relaxed text-ink-dim">
        <li>
          <span className="text-ink">1 · 拿一把 MOSS 的钥匙</span>
          <br />
          打开{' '}
          <a
            href="https://platform.moss.cn"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline hover:text-accent-hover"
          >
            platform.moss.cn
          </a>{' '}
          注册，创建应用，复制 API Key。
        </li>
        <li>
          <span className="text-ink">2 · 填进「设置 → 语音」</span>
          <br />
          粘贴 Key，选一个音色，保存。Key 只存在本机，不走任何第三方。
        </li>
        <li>
          <span className="text-ink">3 · 回来勾上「答案自动念」</span>
          <br />
          或者不勾也行 —— 每条回答右下角都有「念一遍」，想听哪条点哪条。
        </li>
      </ol>

      <div className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-2xs text-ink-mute">
          <Radio size={10} />
          当前状态：{moss === null ? '查不到' : moss.configured ? `已配置（${moss.model || 'MOSS'}）` : '还没配置'}
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={ttsOn}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
          答案自动念出来
        </label>
        <p className="mt-1 text-[10px] leading-relaxed text-ink-mute">
          没有 Key 也能用：语音识别走浏览器自带（免费），只是不会出声。MOSS 失败时静音，不会退回机器音。
        </p>
      </div>
    </Modal>
  )
}
