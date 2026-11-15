import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookMarked, Send, Loader2, X, Hash, ImagePlus, Camera, BookX, Database,
  Check, Sparkles, Mic,
} from 'lucide-react'
import { selfStudyApi, mistakeApi, type SelfStudyResult } from '../lib/api'
import { MiniMarkdown } from './MiniMarkdown'
import { Figure, type FigureSpec } from './Figures'
import { loadVoiceSettings, speakSmart, stopAll } from '../lib/voice'

type Turn = {
  id: string
  role: 'user' | 'system'
  text: string
  kind?: SelfStudyResult['kind']
  options?: { label: string; preview: string }[]
  figures?: unknown[]
  paragraphLabel?: string
  question?: string
  /** 这张回答的后续状态 */
  savedToMistakes?: boolean
  savedToMemory?: boolean
  saving?: 'mistake' | 'memory' | null
  image?: string
}

type AiState = 'idle' | 'thinking' | 'reading' | 'answering'

const STATE_LABEL: Record<AiState, string> = {
  idle: '待命',
  thinking: '在想…',
  reading: '翻教材…',
  answering: '在写答案…',
}

/**
 * 自习模式的对话界面。
 *
 * 一次问答结束后，回答的右下角会出现两个按钮：
 *   加入错题本 —— 问题连答案一起进错题本，卡片闪一下（像拍照）
 *   存入记忆库 —— 边缘跑一圈彩虹呼吸灯，直到真的存进去为止
 */
export function SelfStudyChat({
  courseId,
  open,
  onClose,
  chapterTitle,
}: {
  courseId: string
  open: boolean
  onClose: () => void
  chapterTitle?: string
}) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [aiState, setAiState] = useState<AiState>('idle')
  const [err, setErr] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const voice = useRef(loadVoiceSettings())
  const [pendingImage, setPendingImage] = useState<string | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, busy])

  useEffect(() => {
    if (!open) {
      stopAll()
      setAiState('idle')
    }
  }, [open])

  const ask = useCallback(
    async (question: string, label?: string, image?: string | null) => {
      const q = question.trim()
      if (!q || busy) return
      setBusy(true)
      setErr(null)
      setAiState('thinking')
      setTurns((t) => [
        ...t,
        {
          id: `u${Date.now()}`,
          role: 'user',
          text: label ? `${label}：${q}` : q,
          question: q,
          image: image ?? undefined,
        },
      ])
      setPendingImage(null)

      // 状态栏跟着走：先从"翻教材"到"在写答案"
      const t1 = setTimeout(() => setAiState('reading'), 900)
      const t2 = setTimeout(() => setAiState('answering'), 3200)

      try {
        const r = await selfStudyApi.ask(courseId, q, label)
        const turn: Turn = {
          id: `s${Date.now()}`,
          role: 'system',
          text: r.message,
          kind: r.kind,
          options: r.options,
          figures: r.figures,
          paragraphLabel: r.paragraph?.label,
          question: q,
        }
        setTurns((t) => [...t, turn])
        setAiState('idle')

        if (r.kind === 'answer' && voice.current.ttsEnabled && true) {
          void speakSmart(r.message, { voiceName: voice.current.voiceName, rate: voice.current.rate })
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : '出错了')
        setAiState('idle')
      } finally {
        clearTimeout(t1)
        clearTimeout(t2)
        setBusy(false)
      }
    },
    [busy, courseId],
  )

  /* ── 加入错题本：闪一下，像拍照 ── */
  const addToMistakes = async (t: Turn) => {
    const prev = t.question ?? ''
    setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, saving: 'mistake' } : x)))
    try {
      await mistakeApi.add({
        courseId,
        label: t.paragraphLabel ?? '',
        question: prev,
        answer: t.text,
        source: 'selfstudy',
      })
      setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, saving: null, savedToMistakes: true } : x)))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '存错题失败')
      setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, saving: null } : x)))
    }
  }

  /* ── 存入记忆库：彩虹呼吸灯一直到存完 ── */
  const addToMemory = async (t: Turn) => {
    setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, saving: 'memory' } : x)))
    try {
      await mistakeApi.remember({
        courseId,
        label: t.paragraphLabel ?? '',
        question: t.question ?? '',
        answer: t.text,
      })
      setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, saving: null, savedToMemory: true } : x)))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '存记忆库失败')
      setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, saving: null } : x)))
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

  if (!open) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="fixed inset-x-0 bottom-0 z-40 mx-auto flex h-[78vh] w-full max-w-[1000px] flex-col overflow-hidden rounded-t-2xl border border-line-strong bg-surface shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.8)]"
    >
      {/* ── 头 + AI 状态栏 ── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <BookMarked size={14} className="text-accent" />
        <span className="text-xs font-medium text-ink">自习答疑</span>
        {chapterTitle && <span className="truncate text-2xs text-ink-mute">· {chapterTitle}</span>}

        <div className="ml-3 flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1">
          <motion.span
            animate={
              aiState === 'idle'
                ? { opacity: 0.5 }
                : { opacity: [0.4, 1, 0.4], scale: [1, 1.25, 1] }
            }
            transition={{ duration: 1.4, repeat: aiState === 'idle' ? 0 : Infinity }}
            className={`h-1.5 w-1.5 rounded-full ${
              aiState === 'idle' ? 'bg-ink-mute' : 'bg-accent'
            }`}
          />
          <span className="text-[10px] text-ink-dim">{STATE_LABEL[aiState]}</span>
        </div>

        <button onClick={onClose} className="ml-auto rounded p-1.5 text-ink-mute hover:bg-surface-2 hover:text-ink">
          <X size={14} />
        </button>
      </div>

      {/* ── 对话区 ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {turns.length === 0 && (
          <div className="mx-auto mt-10 max-w-[420px] text-center">
            <p className="text-sm leading-relaxed text-ink-dim">读到哪儿卡住了，就问。</p>
            <p className="mt-2 text-2xs leading-relaxed text-ink-mute">
              带上编号我能直接定位：段落是 <code className="text-accent">A1-3</code>，题目是{' '}
              <code className="text-accent">Q1</code>。
              <br />
              不写编号我会先问你哪一段。
            </p>
          </div>
        )}

        <div className="space-y-4">
          {turns.map((t) =>
            t.role === 'user' ? (
              <div key={t.id} className="flex justify-end">
                <div className="max-w-[78%] rounded-xl rounded-br-sm bg-surface-3 px-3.5 py-2 text-[13px] leading-relaxed text-ink">
                  {t.image && (
                    <img src={t.image} alt="附图" className="mb-2 max-h-40 rounded-md border border-line" />
                  )}
                  {t.text}
                </div>
              </div>
            ) : (
              <AnswerCard
                key={t.id}
                turn={t}
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

        {err && <p className="mt-3 text-2xs text-danger">{err}</p>}
      </div>

      {/* ── 输入区 ── */}
      <div className="shrink-0 border-t border-line px-4 py-3">
        {pendingImage && (
          <div className="mb-2 flex items-center gap-2">
            <img src={pendingImage} alt="待发" className="h-12 rounded border border-line" />
            <button onClick={() => setPendingImage(null)} className="text-2xs text-ink-mute hover:text-danger">
              移除
            </button>
            <span className="text-[10px] text-ink-mute">
              （当前模型读不了图，图会留在对话里，你可以自己看着描述）
            </span>
          </div>
        )}

        <div className="flex items-end gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 focus-within:border-line-strong">
          <button
            onClick={() => fileRef.current?.click()}
            title="上传图片"
            className="mb-0.5 rounded p-1 text-ink-mute hover:bg-surface-3 hover:text-ink"
          >
            <ImagePlus size={14} />
          </button>
          <button
            onClick={() => void grabScreen()}
            title="截图"
            className="mb-0.5 rounded p-1 text-ink-mute hover:bg-surface-3 hover:text-ink"
          >
            <Camera size={14} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) pickImage(f)
              e.target.value = ''
            }}
          />

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void ask(input, undefined, pendingImage)
                setInput('')
              }
            }}
            rows={1}
            placeholder="A1-3 这里为什么要冒烟？"
            className="max-h-28 min-h-[26px] flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-ink placeholder:text-ink-mute focus:outline-none"
          />
          <button
            onClick={() => {
              void ask(input, undefined, pendingImage)
              setInput('')
            }}
            disabled={!input.trim() || busy}
            className="mb-0.5 rounded-lg bg-accent p-1.5 text-accent-fg disabled:opacity-30"
          >
            <Send size={13} />
          </button>
        </div>
        <p className="mt-1.5 flex items-center gap-2 text-[10px] text-ink-mute">
          <span>Enter 发送 · Shift+Enter 换行</span>
          {true && (
            <span className="flex items-center gap-0.5">
              <Mic size={8} />
              答案会自动念
            </span>
          )}
        </p>
      </div>
    </motion.div>
  )
}

/* ============================================================
   回答卡片：两个按钮 + 两种动画
   ============================================================ */

function AnswerCard({
  turn,
  onPick,
  onMistake,
  onMemory,
}: {
  turn: Turn
  onPick: (label: string) => void
  onMistake: () => void
  onMemory: () => void
}) {
  const [flash, setFlash] = useState(false)

  // 存进错题本 → 闪一下，像快门
  useEffect(() => {
    if (turn.savedToMistakes) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 620)
      return () => clearTimeout(t)
    }
  }, [turn.savedToMistakes])

  const isAnswer = turn.kind === 'answer'
  const breathing = turn.saving === 'memory'

  return (
    <motion.div
      animate={
        flash
          ? { backgroundColor: ['rgba(231,183,95,0)', 'rgba(231,183,95,0.22)', 'rgba(255,255,255,0.10)', 'rgba(231,183,95,0)'], scale: [1, 1.006, 1] }
          : { backgroundColor: 'rgba(0,0,0,0)' }
      }
      transition={{ duration: 0.6, times: [0, 0.18, 0.42, 1] }}
      className={`relative rounded-xl border bg-surface-2 px-4 py-3 ${
        breathing ? 'border-transparent' : 'border-line'
      }`}
    >
      {/* 彩虹呼吸灯：存记忆库期间一直跑 */}
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

      {turn.paragraphLabel && (
        <div className="mb-1.5 flex items-center gap-1 text-2xs text-accent">
          <Hash size={9} />
          {turn.paragraphLabel}
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

          {/* 右下角两个按钮 */}
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
        <>
          <p className="text-[13px] leading-relaxed text-ink-dim">{turn.text}</p>
          {turn.options && turn.options.length > 0 && (
            <div className="mt-2 max-h-44 space-y-0.5 overflow-y-auto">
              {turn.options.slice(0, 20).map((o) => (
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
