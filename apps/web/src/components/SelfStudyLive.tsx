import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mic, MicOff, X, Loader2, Volume2, Radio, AlertTriangle, Hand, Play,
  ImagePlus, FileUp, Check, BookX, Database, Send, Keyboard,
} from 'lucide-react'
import { MoshLiveSession, type LiveState } from '../lib/mossLive'
import { selfStudyApi, mistakeApi } from '../lib/api'
import { speakSmart, stopAll, loadVoiceSettings } from '../lib/voice'
import { MiniMarkdown } from './MiniMarkdown'
import { Figure, type FigureSpec } from './Figures'

const STATE_TEXT: Record<LiveState, string> = {
  connecting: '正在想…',
  listening: '在听你说',
  speaking: '在说（打断它直接问）',
  idle: '待命',
  closed: '已断开',
}

type Turn = {
  id: string
  q: string
  a?: string
  label?: string
  figures?: unknown[]
  savedToMistakes?: boolean
  savedToMemory?: boolean
  saving?: 'mistake' | 'memory' | null
}

type Diag = {
  ctxState: string
  trackState: string
  trackMuted: boolean
  trackEnabled: boolean
  label: string
  rms: number
}

export function SelfStudyLive({
  courseId,
  open,
  onClose,
  instructions,
}: {
  courseId: string
  open: boolean
  onClose: () => void
  instructions?: string
}) {
  const [started, setStarted] = useState(false)
  const [state, setState] = useState<LiveState>('connecting')
  const [level, setLevel] = useState(0)
  const [maxLevel, setMaxLevel] = useState(0)
  const [diag, setDiag] = useState<Diag | null>(null)
  const [heard, setHeard] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [interrupted, setInterrupted] = useState(false)
  const [attachments, setAttachments] = useState<{ name: string; url: string; kind: 'image' | 'file' }[]>([])
  const [manual, setManual] = useState(false)
  const [typed, setTyped] = useState('')

  const sessionRef = useRef<MoshLiveSession | null>(null)
  const imgRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const voice = useRef(loadVoiceSettings())
  const submittedRef = useRef('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, busy])

  useEffect(() => {
    if (!open || !started) return
    const t = window.setInterval(() => setDiag(sessionRef.current?.getDiag() ?? null), 700)
    return () => window.clearInterval(t)
  }, [open, started])

  const submit = useCallback(
    async (text: string) => {
      const q = text.trim()
      if (!q || q === submittedRef.current) return
      submittedRef.current = q
      setHeard('')
      setBusy(true)
      setState('connecting')
      setErr(null)

      const id = `t${Date.now()}`
      setTurns((ts) => [...ts, { id, q }])

      try {
        const r = await selfStudyApi.ask(courseId, q)
        setTurns((ts) =>
          ts.map((t) => (t.id === id ? { ...t, a: r.message, label: r.paragraph?.label, figures: r.figures } : t)),
        )
        setState('speaking')
        await speakSmart(r.message, {
          voiceName: voice.current.voiceName,
          rate: voice.current.rate,
        })
      } catch (e) {
        setErr(e instanceof Error ? e.message : '出错了')
      } finally {
        setBusy(false)
        setState('listening')
        submittedRef.current = ''
      }
    },
    [courseId],
  )

  const begin = () => {
    setStarted(true)
    setErr(null)

    let ctx: AudioContext
    try {
      ctx = new AudioContext({ sampleRate: 16000 })
    } catch {
      ctx = new AudioContext()
    }
    void ctx.resume().catch(() => {})

    const s = new MoshLiveSession(
      {
        onState: (st) => setState(st),
        onLevel: (v) => {
          setLevel(v)
          setMaxLevel((m) => Math.max(m, v))
        },
        onUserText: (t) => {
          setHeard(t)
          if (t.trim()) {
            stopAll()
            setInterrupted(true)
            setTimeout(() => setInterrupted(false), 1200)
          }
        },
        onAiText: (t) => {
          const text = t.trim()
          if (!text) return
          setTurns((ts) => {
            if (ts.length === 0) return [{ id: `a${Date.now()}`, q: "（它在主动说）", a: text }]
            const last = ts[ts.length - 1]
            return [...ts.slice(0, -1), { ...last, a: text }]
          })
        },
        onError: (m) => setErr(m),
        onConnected: () => setErr(null),
        onUtteranceEnd: (text) => {
          const q = text.trim()
          if (!q || q === submittedRef.current) return
          submittedRef.current = q
          setHeard(q)
          setTurns((ts) => [...ts, { id: `t${Date.now()}`, q }])
        },
      },
      // 不静音：让 MOSS 自己说，声音更自然、能随时被打断
      { silentOutput: false },
    )
    sessionRef.current = s
    void s.start(instructions, ctx)
  }

  const addToMistakes = async (t: Turn) => {
    setTurns((ts) => ts.map((x) => (x.id === t.id ? { ...x, saving: 'mistake' } : x)))
    try {
      await mistakeApi.add({ courseId, label: t.label ?? '', question: t.q, answer: t.a ?? '', source: 'live' })
      setTurns((ts) => ts.map((x) => (x.id === t.id ? { ...x, saving: null, savedToMistakes: true } : x)))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '存错题失败')
      setTurns((ts) => ts.map((x) => (x.id === t.id ? { ...x, saving: null } : x)))
    }
  }

  const addToMemory = async (t: Turn) => {
    setTurns((ts) => ts.map((x) => (x.id === t.id ? { ...x, saving: 'memory' } : x)))
    try {
      await mistakeApi.remember({ courseId, label: t.label ?? '', question: t.q, answer: t.a ?? '' })
      setTurns((ts) => ts.map((x) => (x.id === t.id ? { ...x, saving: null, savedToMemory: true } : x)))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '存记忆库失败')
      setTurns((ts) => ts.map((x) => (x.id === t.id ? { ...x, saving: null } : x)))
    }
  }

  const addFiles = (files: FileList | null, kind: 'image' | 'file') => {
    if (!files) return
    Array.from(files).slice(0, 4).forEach((f) => {
      const url = URL.createObjectURL(f)
      setAttachments((a) => [...a, { name: f.name, url, kind }])
    })
  }

  const stopSession = () => {
    sessionRef.current?.stop()
    sessionRef.current = null
    stopAll()
    setStarted(false)
    setLevel(0)
    setState('closed')
  }

  if (!open) return null

  const listening = state === 'listening'
  const speaking = state === 'speaking'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-base/98 backdrop-blur-sm">
      <div className="flex shrink-0 items-center gap-2 px-5 py-3">
        <Radio size={14} className="text-accent" />
        <span className="text-xs font-medium text-ink">全双工语音</span>
        <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[9px] text-accent">MOSS-Live</span>

        <div className="ml-3 flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1">
          <motion.span
            animate={state === 'closed' ? { opacity: 0.4 } : { opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className={`h-1.5 w-1.5 rounded-full ${listening ? 'bg-info' : speaking ? 'bg-accent' : 'bg-ink-mute'}`}
          />
          <span className="text-[10px] text-ink-dim">{STATE_TEXT[state]}</span>
        </div>

        <button onClick={onClose} className="ml-auto rounded p-1.5 text-ink-mute hover:bg-surface-2 hover:text-ink">
          <X size={15} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center px-5">
        {!started ? (
          <div className="flex flex-1 flex-col items-center justify-center">
            <button
              onClick={begin}
              className="flex h-32 w-32 items-center justify-center rounded-full border-2 border-accent/60 bg-accent-soft transition-all hover:scale-[1.03] hover:bg-accent/20"
            >
              <Play size={40} className="ml-1 text-accent" strokeWidth={1.6} />
            </button>
            <p className="mt-5 text-sm text-ink-dim">点一下开始</p>
            <p className="mt-1.5 max-w-[400px] text-center text-2xs leading-relaxed text-ink-mute">
              你说话 → 我用教材和题库回答 → 念给你听
              <br />
              我念的时候你随时可以插话
            </p>
          </div>
        ) : (
          <>
            <div className="relative mt-1 flex h-24 w-24 shrink-0 items-center justify-center">
              <AnimatePresence>
                {speaking &&
                  [0, 0.5, 1].map((d) => (
                    <motion.span
                      key={d}
                      initial={{ scale: 0.8, opacity: 0.5 }}
                      animate={{ scale: 1.6, opacity: 0 }}
                      transition={{ duration: 1.8, repeat: Infinity, delay: d }}
                      className="absolute inset-0 rounded-full border border-accent/40"
                    />
                  ))}
              </AnimatePresence>
              <motion.div
                animate={listening ? { scale: 1 + level * 0.2 } : {}}
                transition={{ duration: 0.12 }}
                className={`flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 ${
                  speaking
                    ? 'border-accent bg-accent/15 text-accent'
                    : state === 'closed'
                      ? 'border-line-strong bg-surface-2 text-ink-mute'
                      : 'border-info/70 bg-info/[0.08] text-info'
                }`}
              >
                {busy ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : speaking ? (
                  <Volume2 size={20} />
                ) : state === 'closed' ? (
                  <MicOff size={20} />
                ) : (
                  <Mic size={20} />
                )}
              </motion.div>
            </div>

            <div className="mt-1.5 min-h-[22px] text-center text-[15px] text-ink">
              {heard || <span className="text-2xs text-ink-mute">…</span>}
            </div>

            <div className="mt-0.5 flex items-center gap-3 text-[10px]">
              <span className={maxLevel > 0.02 ? 'text-ok' : 'text-ink-mute'}>
                麦 {maxLevel > 0.02 ? '有音' : '无音'}
              </span>
              <span className={state !== 'closed' ? 'text-ok' : 'text-danger'}>
                {state !== 'closed' ? '通道已连' : '断开'}
              </span>
              <span className="text-ink-mute">上下文 {diag?.ctxState ?? '?'}</span>
              <span className="text-ink-mute">底噪 {(diag?.rms ?? 0).toFixed(2)}</span>
            </div>

            <AnimatePresence>
              {interrupted && speaking && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-1 flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-[10px] text-warn"
                >
                  <Hand size={9} />
                  你插话了，已停
                </motion.div>
              )}
            </AnimatePresence>

            {err && (
              <div className="mt-1.5 flex flex-col items-start gap-0.5 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-2xs text-danger">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle size={10} />
                  {err}
                </span>
                <span className="text-[10px] text-ink-mute">
                  目标地址：{sessionRef.current?.url || '（还没开始连）'}
                </span>
                <button
                  onClick={() => {
                    sessionRef.current?.stop()
                    sessionRef.current = null
                    setStarted(false)
                    setErr(null)
                  }}
                  className="mt-0.5 rounded-sm bg-surface-3 px-2 py-0.5 text-[10px] text-ink-dim hover:text-ink"
                >
                  断开重来
                </button>
              </div>
            )}

            <div className="mt-2 w-full max-w-[820px] flex-1 space-y-3 overflow-y-auto pb-2">
              {turns.map((t) => (
                <AnswerCard
                  key={t.id}
                  turn={t}
                  onMistake={() => void addToMistakes(t)}
                  onMemory={() => void addToMemory(t)}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-5 py-2.5">
        <div className="mx-auto flex max-w-[820px] items-center gap-2">
          <button
            onClick={() => imgRef.current?.click()}
            disabled={!started}
            className="flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[10px] text-ink-dim hover:text-ink disabled:opacity-40"
          >
            <ImagePlus size={11} />
            图片
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!started}
            className="flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[10px] text-ink-dim hover:text-ink disabled:opacity-40"
          >
            <FileUp size={11} />
            文件
          </button>
          <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files, 'image'); e.target.value = '' }} />
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files, 'file'); e.target.value = '' }} />

          <button
            onClick={() => setManual((v) => !v)}
            className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] ${
              manual ? 'border-accent/50 bg-accent-soft text-accent' : 'border-line bg-surface text-ink-dim'
            }`}
          >
            <Keyboard size={11} />
            打字
          </button>

          {attachments.length > 0 && (
            <div className="flex items-center gap-1.5">
              {attachments.slice(0, 3).map((a, i) => (
                <span key={i} className="flex items-center gap-1 rounded border border-line bg-surface-2 px-1.5 py-0.5">
                  {a.kind === 'image' ? (
                    <img src={a.url} alt="" className="h-4 w-4 rounded object-cover" />
                  ) : (
                    <FileUp size={9} className="text-ink-mute" />
                  )}
                  <span className="max-w-[80px] truncate text-[9px] text-ink-dim">{a.name}</span>
                </span>
              ))}
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {started && (
              <button onClick={stopSession} className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[10px] text-ink-dim hover:text-danger">
                <MicOff size={10} />
                关麦
              </button>
            )}
            <span className="text-[10px] text-ink-mute">{started ? '直接说话' : '点圆开始'}</span>
          </div>
        </div>

        {manual && (
          <div className="mx-auto mt-2 flex max-w-[820px] items-end gap-2 rounded-lg border border-line bg-surface px-3 py-1.5">
            <textarea
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void submit(typed)
                  setTyped('')
                }
              }}
              rows={1}
              placeholder="A1-3 这里为什么要冒烟？"
              className="max-h-20 min-h-[24px] flex-1 resize-none bg-transparent text-xs text-ink placeholder:text-ink-mute focus:outline-none"
            />
            <button
              onClick={() => { void submit(typed); setTyped('') }}
              disabled={!typed.trim()}
              className="rounded bg-accent p-1 text-accent-fg disabled:opacity-30"
            >
              <Send size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function AnswerCard({
  turn,
  onMistake,
  onMemory,
}: {
  turn: Turn
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

  const breathing = turn.saving === 'memory'

  return (
    <motion.div
      animate={
        flash
          ? {
              backgroundColor: ['rgba(231,183,95,0)', 'rgba(231,183,95,0.22)', 'rgba(255,255,255,0.10)', 'rgba(231,183,95,0)'],
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
              background: 'conic-gradient(from 0deg, #ff6b6b, #ffd93d, #6bcf7f, #4ecdc4, #5b8def, #c77dff, #ff6b6b)',
              padding: 1.5,
              WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
            }}
          />
        )}
      </AnimatePresence>

      <div className="mb-1 text-2xs text-ink-mute">
        {turn.label && <span className="mr-1.5 text-accent">{turn.label}</span>}
        {turn.q}
      </div>

      {turn.a ? (
        <>
          <div className="text-[13.5px]">
            <MiniMarkdown text={turn.a} />
          </div>
          {Array.isArray(turn.figures) && turn.figures.length > 0 && (
            <div className="mt-2">
              {(turn.figures as FigureSpec[]).map((f, i) => (
                <Figure key={i} spec={f} />
              ))}
            </div>
          )}
          <div className="mt-2.5 flex items-center justify-end gap-1.5">
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
          </div>
        </>
      ) : (
        <div className="flex items-center gap-1.5 text-2xs text-ink-mute">
          <Loader2 size={10} className="animate-spin" />
          查教材…
        </div>
      )}
    </motion.div>
  )
}