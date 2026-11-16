import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft,
  ArrowRight,
  Sparkles,
  Lightbulb,
  Baby,
  HelpCircle,
  Send,
  Square,
  Loader2,
  CheckCircle2,
  Info,
  Volume2,
  VolumeX,
  Mic,
} from 'lucide-react'
import { api, type TeachIntent, type TeachStep } from '../lib/api'
import { MiniMarkdown } from '../components/MiniMarkdown'
import { SelectionMenu, useSelectionMenu } from '../components/Selection'
import { QuoteChip } from '../components/Composer'
import { anchorInline, type TextAnchor } from '../lib/anchor'
import {
  asrSupported,
  loadVoiceSettings,
  speakSmart,
  stopAll,
  startAsr,
  type AsrHandle,
} from '../lib/voice'

type EndResult = { summary: string; nextHint: string; pace: string; reason: string }

const PACE_LABEL: Record<string, string> = { faster: '加快', hold: '保持', slower: '放慢' }

export function TeachSession({ courseId, onExit }: { courseId: string; onExit: () => void }) {
  const [booted, setBooted] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [lessonTitle, setLessonTitle] = useState('')
  const [content, setContent] = useState('')
  const [step, setStep] = useState<TeachStep | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [totalSteps, setTotalSteps] = useState(0)
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(true)
  const [budget, setBudget] = useState(350)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ask, setAsk] = useState('')
  /** 引用到输入框的那段（连位置锚），像 QQ 那样浮在输入框上方 */
  const [quote, setQuote] = useState<TextAnchor | null>(null)
  const [, setAnnTick] = useState(0)
  const { sel, clear } = useSelectionMenu(true)
  useEffect(() => {
    const h = () => setAnnTick((n) => n + 1)
    window.addEventListener('alp:annotations-changed', h)
    return () => window.removeEventListener('alp:annotations-changed', h)
  }, [])
  const [result, setResult] = useState<EndResult | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const asrRef = useRef<AsrHandle | null>(null)
  const voice = useRef(loadVoiceSettings())

  const boot = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await api.startTeach(courseId)
      setSessionId(r.session.id)
      setLessonTitle(r.lesson?.title ?? '')
      setPin(r.pin)
      setContent(r.firstContent)
      setStep(r.currentStep)
      setStepIndex(r.session.stepIndex)
      setTotalSteps(r.session.totalSteps)
      setBudget(r.budget)
      setBooted(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '开课失败')
    } finally {
      setBusy(false)
    }
  }, [courseId])

  useEffect(() => {
    void boot()
  }, [boot])

  const go = async (intent: TeachIntent, question = '') => {
    if (!sessionId || busy) return
    setBusy(true)
    setErr(null)
    try {
      const r = await api.advanceTeach(sessionId, intent, question)
      setContent(r.content)
      setStep(r.currentStep)
      setStepIndex(r.stepIndex)
      setTotalSteps(r.totalSteps)
      setBudget(r.budget)
      setShowPin(false)
      if (voice.current.ttsEnabled && true) {
        setSpeaking(true)
        void speakSmart(r.content, { voiceName: voice.current.voiceName, rate: voice.current.rate })
        setTimeout(() => setSpeaking(false), Math.min(30_000, r.content.length * 180))
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '这一步没走通')
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    if (!sessionId || busy) return
    setBusy(true)
    try {
      const r = await api.endTeach(sessionId)
      setResult({
        summary: r.log.summary,
        nextHint: r.log.nextHint,
        pace: r.log.pace,
        reason: r.log.reason,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '结束失败')
    } finally {
      setBusy(false)
    }
  }

  /* 提问：引用过就把位置锚一起塞进问题里（界面上看不到这一段） */
  const sendAsk = () => {
    const q = ask.trim()
    if (!q) return
    setAsk('')
    const used = quote
    setQuote(null)
    void go('explain', q + anchorInline(used))
  }

  /* ── 结算 ── */
  if (result) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-lg"
        >
          <div className="mb-6 flex items-center gap-2 text-ok">
            <CheckCircle2 size={18} />
            <span className="text-sm font-medium">这次课记下了</span>
          </div>

          <div className="space-y-3 rounded-lg border border-line bg-surface p-5">
            <Row label="这一节学到的" value={result.summary || '—'} />
            <Row label="下次从哪开始" value={result.nextHint || '—'} />
            <Row
              label="节奏判断"
              value={`${PACE_LABEL[result.pace] ?? result.pace} · ${result.reason}`}
            />
          </div>

          <p className="mt-4 flex items-start gap-2 text-2xs leading-relaxed text-ink-mute">
            <Info size={12} className="mt-0.5 shrink-0" />
            这段已经写进这门课的「优先阅读条目」，下次一开课我会先读它。
          </p>

          <button
            onClick={onExit}
            className="mt-6 h-10 w-full rounded-md bg-accent text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            回到课程
          </button>
        </motion.div>
      </div>
    )
  }

  /* ── 启动失败 ── */
  if (!booted) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 shrink-0 items-center border-b border-line px-5">
          <button
            onClick={onExit}
            className="flex items-center gap-1 text-xs text-ink-mute hover:text-ink"
          >
            <ChevronLeft size={14} />
            返回课程
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center px-6">
          {busy ? (
            <div className="flex flex-col items-center gap-3 text-sm text-ink-dim">
              <Loader2 size={20} className="animate-spin text-accent" />
              正在备这节课…
            </div>
          ) : (
            <div className="max-w-md text-center">
              <p className="text-sm text-danger">{err ?? '开课失败'}</p>
              <button
                onClick={() => void boot()}
                className="mt-4 h-9 rounded-md border border-line bg-surface px-4 text-sm text-ink-dim hover:bg-surface-2 hover:text-ink"
              >
                重试
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
        <button
          onClick={onExit}
          className="flex items-center gap-1 text-xs text-ink-mute transition-colors hover:text-ink"
        >
          <ChevronLeft size={14} />
          返回
        </button>
        <span className="text-line-strong">|</span>
        <span className="text-sm font-medium text-ink">{lessonTitle}</span>

        <div className="ml-2 flex items-center gap-1">
          {Array.from({ length: Math.min(totalSteps, 10) }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i < stepIndex ? 'w-1.5 bg-accent/45' : i === stepIndex ? 'w-5 bg-accent' : 'w-1.5 bg-line-strong'
              }`}
            />
          ))}
          <span className="ml-2 text-2xs tabular-nums text-ink-mute">
            {stepIndex + 1} / {totalSteps}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {true && voice.current.ttsEnabled && (
            <button
              onClick={() => {
                if (speaking) {
                  stopAll()
                  setSpeaking(false)
                } else {
                  void speakSmart(content, {
                    voiceName: voice.current.voiceName,
                    rate: voice.current.rate,
                  })
                    setSpeaking(true)
                    setTimeout(() => setSpeaking(false), Math.min(30_000, content.length * 180))
                }
              }}
              title={speaking ? '停止朗读' : '朗读这一段'}
              className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
                speaking
                  ? 'border-accent/50 bg-accent-soft text-accent'
                  : 'border-line bg-surface text-ink-dim hover:text-ink'
              }`}
            >
              {speaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
          )}

          <button
            onClick={finish}
            disabled={busy}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-xs text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          >
            <Square size={11} />
            结束这次课
          </button>
        </div>      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1180px] px-8 py-6">
          {/* 速览卡 */}
          <AnimatePresence>
            {showPin && pin && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="mb-5 flex items-start gap-2.5 rounded-lg border border-accent/25 bg-accent-soft/50 px-4 py-3"
              >
                <Sparkles size={13} className="mt-0.5 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 text-2xs font-medium text-accent">开课速览</div>
                  <p className="text-xs leading-relaxed text-ink-dim">{pin}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 当前步骤标签 */}
          {step && (
            <div className="mb-2 flex items-center gap-2 text-2xs text-ink-mute">
              <span className="rounded-sm bg-surface-3 px-1.5 py-0.5">{stepKindLabel(step.kind)}</span>
              <span>{step.title}</span>
            </div>
          )}

          {/* 讲解 */}
          <AnimatePresence mode="wait">
            <motion.div
              key={content.slice(0, 40)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              {busy ? (
                <div className="flex items-center gap-2 py-8 text-sm text-ink-mute">
                  <Loader2 size={15} className="animate-spin" />
                  老师在写…
                </div>
              ) : (
                // 打上来源标记：从讲解里选一句话引用时，锚能记下"这一课·这一步"
                <div
                  data-source-id={`teach-${sessionId ?? 'live'}`}
                  data-source-kind="teach"
                  data-chapter-title={step?.title ?? lessonTitle}
                >
                  <MiniMarkdown text={content} />
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {err && (
            <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {err}
            </div>
          )}

          <p className="mt-6 text-2xs text-ink-mute">
            本课讲解预算 {budget} 字 · 超出的内容会折叠，用「展开讲」再看
          </p>
        </div>
      </div>

      {/* 操作区 */}
      <div className="shrink-0 border-t border-line bg-surface/50 px-6 py-3">
        <div className="mx-auto w-full max-w-[1180px]">
          <QuoteChip anchor={quote} onClear={() => setQuote(null)} />
          <div className="mb-2.5 flex items-center gap-1.5 rounded-md border border-line bg-surface px-3">
            {asrSupported() && voice.current.asrEnabled && (
              <button
                onClick={() => {
                  if (listening) {
                    asrRef.current?.stop()
                    setListening(false)
                    return
                  }
                  setListening(true)
                  asrRef.current = startAsr({
                    onFinal: (t) => {
                      setAsk(t)
                      setListening(false)
                      inputRef.current?.focus()
                    },
                    onInterim: (t) => setAsk(t),
                    onError: (m) => {
                      setErr(m)
                      setListening(false)
                    },
                    onEnd: () => setListening(false),
                  })
                }}
                title={listening ? '正在听… 点击停止' : '语音提问'}
                className={`rounded p-1 transition-colors ${
                  listening ? 'text-accent' : 'text-ink-mute hover:text-accent'
                }`}
              >
                <Mic size={14} className={listening ? 'animate-pulse' : ''} />
              </button>
            )}
            <input
              ref={inputRef}
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendAsk()}
              placeholder={quote ? `引用：「${quote.quote.slice(0, 24)}…」` : listening ? '正在听你说…' : '提问'}
              className="h-9 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-mute focus:outline-none"
            />
            <button
              onClick={sendAsk}
              disabled={!ask.trim() || busy}
              className="rounded p-1.5 text-ink-mute transition-colors hover:text-accent disabled:opacity-30"
            >
              <Send size={14} />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void go('next')}
              disabled={busy}
              className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              下一步
              <ArrowRight size={14} />
            </button>
            <ActionBtn icon={Sparkles} onClick={() => void go('explain')} disabled={busy}>
              展开讲
            </ActionBtn>
            <ActionBtn icon={Lightbulb} onClick={() => void go('example')} disabled={busy}>
              换个例子
            </ActionBtn>
            <ActionBtn icon={Baby} onClick={() => void go('simpler')} disabled={busy}>
              再简单点
            </ActionBtn>
            <ActionBtn icon={HelpCircle} onClick={() => void go('confused')} disabled={busy}>
              没懂
            </ActionBtn>
          </div>
        </div>

      {/* 划词菜单：重点标记 / 多讲讲 / 引用到输入框 */}
      <SelectionMenu
        sel={sel}
        courseId={courseId}
        mode="teach"
        onAsk={() => {}}
        onQuote={(s) => {
          // 引用整段（带位置锚）；输入框空着就把原文填进去当草稿
          setQuote(s.anchor)
          setAsk((v) => v || s.text.slice(0, 200))
          clear()
          window.getSelection()?.removeAllRanges()
        }}
        onHighlighted={() => {
          clear()
          window.getSelection()?.removeAllRanges()
        }}
        onGrow={() => {
          clear()
          window.getSelection()?.removeAllRanges()
        }}
      />
      </div>
    </div>
  )
}

function ActionBtn({
  children,
  icon: Icon,
  onClick,
  disabled,
}: {
  children: ReactNode
  icon: typeof Sparkles
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-xs text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink disabled:opacity-40"
    >
      <Icon size={12} />
      {children}
    </button>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-0.5 text-2xs text-ink-mute">{label}</div>
      <div className="text-sm leading-relaxed text-ink-dim">{value}</div>
    </div>
  )
}

function stepKindLabel(kind: string): string {
  return (
    { point: '要点', example: '例子', practice: '动手', check: '检验' }[kind] ?? '讲解'
  )
}