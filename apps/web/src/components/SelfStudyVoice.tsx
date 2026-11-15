import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mic, MicOff, X, Loader2, Volume2, AlertTriangle, Keyboard,
  ImagePlus, Camera, Send, Check,
} from 'lucide-react'
import { selfStudyApi, mistakeApi } from '../lib/api'
import { loadVoiceSettings, speakSmart, stopAll, asrSupported } from '../lib/voice'
import { AnswerCard, type AnswerTurn } from './AnswerCard'

type Phase = 'boot' | 'listening' | 'thinking' | 'speaking' | 'off'

const PHASE_TEXT: Record<Phase, string> = {
  boot: '正在打开麦克风…',
  listening: '正在聆听',
  thinking: '在想…',
  speaking: '在讲…',
  off: '麦克风已关',
}

type Line = AnswerTurn

export function SelfStudyVoice({
  courseId,
  open,
  onClose,
}: {
  courseId: string
  open: boolean
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('boot')
  const [heard, setHeard] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [manual, setManual] = useState(false)
  const [typed, setTyped] = useState('')
  const [level, setLevel] = useState(0)
  const [pendingImage, setPendingImage] = useState<string | null>(null)

  const recRef = useRef<{ stop: () => void; abort: () => void } | null>(null)
  const phaseRef = useRef<Phase>('boot')
  const bufferRef = useRef('')
  const timerRef = useRef<number | null>(null)
  const wantListenRef = useRef(true)
  const imgRef = useRef<HTMLInputElement>(null)
  const voice = useRef(loadVoiceSettings())
  const bottomRef = useRef<HTMLDivElement>(null)

  const setP = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  /* 提交一句话 */
  const submit = useCallback(
    async (text: string) => {
      const q = text.trim()
      if (!q) return
      bufferRef.current = ''
      setHeard('')
      setP('thinking')

      const id = `l${Date.now()}`
      setLines((ls) => [...ls, { id, q }])

      wantListenRef.current = false
      recRef.current?.stop()
      recRef.current = null

      try {
        const r = await selfStudyApi.ask(courseId, q)
        setLines((ls) =>
          ls.map((l) => (l.id === id ? { ...l, a: r.message, label: r.paragraph?.label, figures: r.figures } : l)),
        )
        setP('speaking')
        await speakSmart(r.message, {
          voiceName: voice.current.voiceName,
          rate: voice.current.rate,
        })
        setP('listening')
        wantListenRef.current = true
        startListening()
      } catch (e) {
        setErr(e instanceof Error ? e.message : '出错了')
        setP('listening')
        wantListenRef.current = true
        startListening()
      }
    },
    [courseId],
  )

  const startListening = useCallback(() => {
    if (!asrSupported()) {
      setP('off')
      setErr('这个浏览器不支持语音识别，用下面手动输入')
      setManual(true)
      return
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) {
      setP('off')
      setManual(true)
      return
    }

    try {
      const rec = new Ctor()
      rec.lang = 'zh-CN'
      rec.continuous = true
      rec.interimResults = true

      rec.onresult = (e: SpeechEventLike) => {
        if (phaseRef.current === 'speaking' || phaseRef.current === 'thinking') return

        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]
          const text = res[0]?.transcript ?? ''
          if (res.isFinal) bufferRef.current += text
          else interim += text
        }

        const shown = (bufferRef.current + interim).trim()
        setHeard(shown)
        if (shown) setP('listening')
        setLevel(Math.min(1, shown.length / 24))

        if (timerRef.current) window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => {
          const full = bufferRef.current.trim()
          if (full.length >= 2) void submit(full)
          else {
            bufferRef.current = ''
            setHeard('')
            setLevel(0)
          }
        }, 1400)
      }

      rec.onerror = (e: { error?: string }) => {
        if (e.error === 'not-allowed') {
          setErr('麦克风被拒绝了，去地址栏允许一下')
          setP('off')
          wantListenRef.current = false
        }
      }

      rec.onend = () => {
        if (wantListenRef.current && phaseRef.current !== 'off') {
          setTimeout(() => {
            if (wantListenRef.current) startListening()
          }, 350)
        }
      }

      rec.start()
      recRef.current = rec as unknown as { stop: () => void; abort: () => void }
      setP('listening')
      setErr(null)
    } catch {
      /* 已经在跑 */
    }
  }, [submit])

  useEffect(() => {
    if (!open) {
      wantListenRef.current = false
      recRef.current?.stop()
      recRef.current = null
      if (timerRef.current) window.clearTimeout(timerRef.current)
      stopAll()
      return
    }
    wantListenRef.current = true
    setP('boot')
    const t = setTimeout(() => startListening(), 260)
    return () => {
      window.clearTimeout(t)
      wantListenRef.current = false
      recRef.current?.stop()
      recRef.current = null
      if (timerRef.current) window.clearTimeout(timerRef.current)
      stopAll()
    }
  }, [open, startListening])

  const addToMistakes = async (t: Line) => {
    setLines((ls) => ls.map((x) => (x.id === t.id ? { ...x, saving: 'mistake' } : x)))
    try {
      await mistakeApi.add({ courseId, label: t.label ?? '', question: t.q, answer: t.a ?? '', source: 'voice' })
      setLines((ls) => ls.map((x) => (x.id === t.id ? { ...x, saving: null, savedToMistakes: true } : x)))
    } catch {
      setLines((ls) => ls.map((x) => (x.id === t.id ? { ...x, saving: null } : x)))
    }
  }

  const addToMemory = async (t: Line) => {
    setLines((ls) => ls.map((x) => (x.id === t.id ? { ...x, saving: 'memory' } : x)))
    try {
      await mistakeApi.remember({ courseId, label: t.label ?? '', question: t.q, answer: t.a ?? '' })
      setLines((ls) => ls.map((x) => (x.id === t.id ? { ...x, saving: null, savedToMemory: true } : x)))
    } catch {
      setLines((ls) => ls.map((x) => (x.id === t.id ? { ...x, saving: null } : x)))
    }
  }

  const pickImage = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setPendingImage(String(reader.result))
    reader.readAsDataURL(file)
  }

  const grabScreen = async () => {
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
      setPendingImage(canvas.toDataURL('image/png'))
    } catch {
      setErr('截图取消了')
      setTimeout(() => setErr(null), 2500)
    }
  }

  const toggleMic = () => {
    if (phaseRef.current === 'off') {
      wantListenRef.current = true
      startListening()
    } else {
      wantListenRef.current = false
      recRef.current?.stop()
      recRef.current = null
      setP('off')
      stopAll()
    }
  }

  if (!open) return null

  const active = phase === 'listening' || phase === 'thinking' || phase === 'speaking'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-base/98 backdrop-blur-sm">
      <div className="flex shrink-0 items-center gap-2 px-5 py-3.5">
        <Mic size={14} className="text-accent" />
        <span className="text-xs font-medium text-ink">语音模式</span>
        <span className="text-2xs text-ink-mute">说话就行，不用点按钮</span>
        <button onClick={onClose} className="ml-auto rounded p-1.5 text-ink-mute hover:bg-surface-2 hover:text-ink">
          <X size={15} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center px-6">
        <div className="relative mt-1 flex h-32 w-32 shrink-0 items-center justify-center">
          <AnimatePresence>
            {phase === 'listening' &&
              [0, 0.6, 1.2].map((d) => (
                <motion.span
                  key={d}
                  initial={{ scale: 0.85, opacity: 0.5 }}
                  animate={{ scale: 1.5 + level * 0.35, opacity: 0 }}
                  transition={{ duration: 2, repeat: Infinity, delay: d }}
                  className="absolute inset-0 rounded-full border border-accent/50"
                />
              ))}
          </AnimatePresence>

          <motion.button
            onClick={toggleMic}
            animate={
              phase === 'thinking'
                ? { rotate: 360 }
                : phase === 'speaking'
                  ? { scale: [1, 1.04, 1] }
                  : phase === 'listening'
                    ? { scale: 1 + level * 0.08 }
                    : {}
            }
            transition={
              phase === 'thinking'
                ? { duration: 2.2, repeat: Infinity, ease: 'linear' }
                : phase === 'speaking'
                  ? { duration: 0.9, repeat: Infinity }
                  : { duration: 0.2 }
            }
            className={`relative flex h-24 w-24 items-center justify-center rounded-full border-2 transition-colors ${
              phase === 'off'
                ? 'border-line-strong bg-surface-2 text-ink-mute'
                : phase === 'thinking'
                  ? 'border-info/60 bg-info/10 text-info'
                  : phase === 'speaking'
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-accent/70 bg-accent-soft text-accent'
            }`}
          >
            {phase === 'boot' || phase === 'thinking' ? (
              <Loader2 size={26} className="animate-spin" />
            ) : phase === 'off' ? (
              <MicOff size={26} />
            ) : phase === 'speaking' ? (
              <Volume2 size={26} />
            ) : (
              <Mic size={26} />
            )}
          </motion.button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${active ? 'animate-pulse bg-accent' : 'bg-ink-mute'}`} />
          <span className="text-sm text-ink-dim">{PHASE_TEXT[phase]}</span>
        </div>

        <div className="mt-3 h-12 max-w-[760px] text-center">
          {heard ? (
            <p className="text-[16px] leading-relaxed text-ink">{heard}</p>
          ) : phase === 'listening' ? (
            <p className="text-xs text-ink-mute">说出你的问题，带编号更好定位（A1-3 / Q1）</p>
          ) : null}
        </div>

        {err && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-2xs text-warn">
            <AlertTriangle size={11} />
            {err}
          </div>
        )}

        <div className="mt-3 w-full max-w-[860px] flex-1 space-y-3 overflow-y-auto pb-2">
          {lines.map((l) => (
            <AnswerCard
              key={l.id}
              turn={l}
              onMistake={() => void addToMistakes(l)}
              onMemory={() => void addToMemory(l)}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-line px-5 py-2.5">
        <div className="mx-auto flex max-w-[860px] items-center gap-2">
          <button
            onClick={() => imgRef.current?.click()}
            className="flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[10px] text-ink-dim hover:text-ink"
          >
            <ImagePlus size={11} />
            图片
          </button>
          <button
            onClick={() => void grabScreen()}
            className="flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[10px] text-ink-dim hover:text-ink"
          >
            <Camera size={11} />
            截图
          </button>
          <input
            ref={imgRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) pickImage(f)
              e.target.value = ''
            }}
          />

          <button
            onClick={() => setManual((v) => !v)}
            className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] ${
              manual ? 'border-accent/50 bg-accent-soft text-accent' : 'border-line bg-surface text-ink-dim'
            }`}
          >
            <Keyboard size={11} />
            打字
          </button>

          {pendingImage && (
            <span className="flex items-center gap-1 rounded border border-line bg-surface-2 px-1.5 py-0.5">
              <img src={pendingImage} alt="" className="h-4 w-4 rounded object-cover" />
              <Check size={9} className="text-ok" />
            </span>
          )}

          <div className="ml-auto text-[10px] text-ink-mute">
            {phase === 'off' ? '点圆环重新开麦' : '不想说话就点打字'}
          </div>
        </div>

        {manual && (
          <div className="mx-auto mt-2 flex max-w-[860px] items-end gap-2 rounded-lg border border-line bg-surface px-3 py-1.5">
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
              onClick={() => {
                void submit(typed)
                setTyped('')
              }}
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

type SpeechAltLike = { transcript: string }
type SpeechResultLike = { isFinal: boolean; 0: SpeechAltLike; length: number }
type SpeechEventLike = {
  resultIndex: number
  results: { length: number } & Record<number, SpeechResultLike>
}
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: SpeechEventLike) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
}