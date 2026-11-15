import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BookMarked, Send, Loader2, Volume2, VolumeX, X, Hash, CornerDownLeft } from 'lucide-react'
import { selfStudyApi, type SelfStudyResult } from '../lib/api'
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
}

/**
 * 自习模式：右下角浮出来的小面板。
 *
 * 和「问 AI」抽屉的区别：这里的问答必须先定位到某一段（§1.3），
 * 问得含糊它会反过来问你"哪里不明白"，不会瞎猜。
 */
export function SelfStudyPanel({ courseId, open, onClose }: { courseId: string; open: boolean; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const voice = useRef(loadVoiceSettings())

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, busy])

  const ask = useCallback(
    async (question: string, label?: string) => {
      const q = question.trim()
      if (!q || busy) return
      setBusy(true)
      setErr(null)
      setTurns((t) => [
        ...t,
        { id: `u${Date.now()}`, role: 'user', text: label ? `${label}：${q}` : q },
      ])
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
        }
        setTurns((t) => [...t, turn])
        // 答案直接念出来（便于聆听）
        if (r.kind === 'answer' && voice.current.ttsEnabled && true) {
          void speakSmart(r.message, { voiceName: voice.current.voiceName, rate: voice.current.rate })
          setSpeakingId(turn.id)
          setTimeout(() => setSpeakingId(null), Math.min(40_000, r.message.length * 200))
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : '出错了')
      } finally {
        setBusy(false)
      }
    },
    [busy, courseId],
  )

  if (!open) return null

  return (
    <motion.aside
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      className="fixed right-6 bottom-6 z-40 flex h-[520px] w-[400px] flex-col overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl"
    >
      {/* 头 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <BookMarked size={13} className="text-accent" />
        <span className="text-xs font-medium text-ink">自习答疑</span>
        <span className="text-2xs text-ink-mute">按段落编号问</span>
        <button onClick={onClose} className="ml-auto rounded p-1 text-ink-mute hover:bg-surface-2 hover:text-ink">
          <X size={13} />
        </button>
      </div>

      {/* 对话 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="mt-6 px-4 text-center">
            <p className="text-xs leading-relaxed text-ink-dim">
              读到哪儿卡住了，就问我。
            </p>
            <p className="mt-2 text-2xs leading-relaxed text-ink-mute">
              带上段落编号（比如 §1.3）我能直接定位；
              不写编号我会先问你哪一段。
            </p>
          </div>
        )}

        <div className="space-y-3">
          {turns.map((t) =>
            t.role === 'user' ? (
              <div key={t.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg rounded-br-sm bg-surface-3 px-2.5 py-1.5 text-xs leading-relaxed text-ink">
                  {t.text}
                </div>
              </div>
            ) : (
              <div key={t.id} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                {t.paragraphLabel && (
                  <div className="mb-1 flex items-center gap-1 text-2xs text-accent">
                    <Hash size={9} />
                    {t.paragraphLabel}
                  </div>
                )}

                {t.kind === 'answer' ? (
                  <>
                    <div className="text-xs">
                      <MiniMarkdown text={t.text} />
                    </div>
                    {Array.isArray(t.figures) && t.figures.length > 0 && (
                      <div className="mt-2">
                        {(t.figures as FigureSpec[]).map((f, i) => (
                          <Figure key={i} spec={f} />
                        ))}
                      </div>
                    )}
                    {true && (
                      <button
                        onClick={() => {
                          if (speakingId === t.id) {
                            stopAll()
                            setSpeakingId(null)
                          } else {
                            void speakSmart(t.text, { voiceName: voice.current.voiceName, rate: voice.current.rate })
                            setSpeakingId(t.id)
                          }
                        }}
                        className="mt-1.5 flex items-center gap-1 text-2xs text-ink-mute hover:text-accent"
                      >
                        {speakingId === t.id ? <VolumeX size={10} /> : <Volume2 size={10} />}
                        {speakingId === t.id ? '停止' : '再听一遍'}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-xs leading-relaxed text-ink-dim">{t.text}</p>
                    {t.options && t.options.length > 0 && (
                      <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                        {t.options.slice(0, 20).map((o) => (
                          <button
                            key={o.label}
                            onClick={() => void ask(input || '这里不懂', o.label)}
                            className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-surface-3"
                          >
                            <code className="shrink-0 font-mono text-2xs text-accent">{o.label}</code>
                            <span className="truncate text-2xs text-ink-mute">{o.preview}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ),
          )}
          {busy && (
            <div className="flex items-center gap-1.5 text-2xs text-ink-mute">
              <Loader2 size={11} className="animate-spin" />
              正在翻这一段…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {err && <p className="mt-2 text-2xs text-danger">{err}</p>}
      </div>

      {/* 输入 */}
      <div className="shrink-0 border-t border-line px-3 py-2.5">
        <div className="flex items-end gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1.5 focus-within:border-line-strong">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void ask(input)
                setInput('')
              }
            }}
            placeholder="§1.3 这里为什么要冒烟？"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink placeholder:text-ink-mute focus:outline-none"
          />
          <button
            onClick={() => {
              void ask(input)
              setInput('')
            }}
            disabled={!input.trim() || busy}
            className="rounded bg-accent p-1 text-accent-fg disabled:opacity-30"
          >
            <Send size={11} />
          </button>
        </div>
        <p className="mt-1 flex items-center gap-1 text-[10px] text-ink-mute">
          <CornerDownLeft size={8} /> Enter 发送 · 写编号能直接定位
        </p>
      </div>
    </motion.aside>
  )
}

/** 教材里每段的编号气泡 */
export function ParaBadge({ label }: { label: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard?.writeText(label)
      }}
      title="点一下复制编号"
      className="absolute -top-1 right-0 rounded px-1 font-mono text-[10px] text-ink-mute/45 transition-colors select-none hover:text-accent"
    >
      {label}
    </button>
  )
}

void AnimatePresence