import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Loader2, Sparkles, Check, BookOpen, UserRound } from 'lucide-react'
import { onboardingApi, textbookApi, type OnboardingQuestion, type Profile, type Textbook } from '../lib/api'

type Phase = 'asking' | 'confirm' | 'building' | 'done'

export function OnboardingFlow({
  courseId,
  courseTitle,
  onDone,
}: {
  courseId: string
  courseTitle: string
  onDone: (profile: Profile) => void
}) {
  const [phase, setPhase] = useState<Phase>('asking')
  const [interviewId, setInterviewId] = useState<string | null>(null)
  const [q, setQ] = useState<OnboardingQuestion | null>(null)
  const [step, setStep] = useState(1)
  const [total, setTotal] = useState(5)
  const [text, setText] = useState('')
  const [picked, setPicked] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [book, setBook] = useState<Textbook | null>(null)

  const boot = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await onboardingApi.start(courseId)
      setInterviewId(r.interviewId)
      setQ(r.question)
      setStep(r.step)
      setTotal(r.total)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '开始访谈失败')
    } finally {
      setBusy(false)
    }
  }, [courseId])

  useEffect(() => {
    void boot()
  }, [boot])

  const submit = async (value: string) => {
    if (!interviewId || !q) return
    setBusy(true)
    setErr(null)
    try {
      const r = await onboardingApi.answer(interviewId, q.id, value)
      setText('')
      setPicked('')
      if (r.done && r.profile) {
        setProfile(r.profile)
        setPhase('confirm')
      } else if (r.next) {
        setQ(r.next)
        setStep(r.step)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }

  /* 建教材 + 轮询 */
  const build = async () => {
    setPhase('building')
    setErr(null)
    try {
      await textbookApi.build(courseId)
      let tries = 0
      const timer = setInterval(async () => {
        tries++
        try {
          const r = await textbookApi.get(courseId)
          if (r.textbook) {
            setBook(r.textbook)
            if (r.textbook.status === 'ready') {
              clearInterval(timer)
              setPhase('done')
            } else if (r.textbook.status === 'failed') {
              clearInterval(timer)
              setErr(r.textbook.error ?? '生成失败')
              setPhase('confirm')
            }
          }
        } catch {
          /* 继续轮询 */
        }
        if (tries > 120) {
          clearInterval(timer)
          setErr('生成超时了，稍后可以在「教材」页点重试')
          setPhase('confirm')
        }
      }, 2500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '开始生成失败')
      setPhase('confirm')
    }
  }

  return (
    <div className="flex h-full flex-col bg-base">
      {/* 顶栏 */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
        <BookOpen size={15} className="text-accent" />
        <span className="text-sm font-medium text-ink">{courseTitle}</span>
        <span className="text-2xs text-ink-mute">第一次见面 · 聊聊你的情况</span>
        {phase === 'asking' && (
          <div className="ml-auto flex items-center gap-1.5">
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                className={`h-1 rounded-full transition-all ${
                  i < step - 1 ? 'w-4 bg-accent/50' : i === step - 1 ? 'w-6 bg-accent' : 'w-1.5 bg-line-strong'
                }`}
              />
            ))}
            <span className="ml-2 text-2xs tabular-nums text-ink-mute">
              {step}/{total}
            </span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[62ch] px-6 py-10">
          {err && (
            <div className="mb-5 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {err}
            </div>
          )}

          <AnimatePresence mode="wait">
            {/* ── 问答 ── */}
            {phase === 'asking' && q && (
              <motion.div
                key={q.id}
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -14 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <p className="mb-1.5 text-lg leading-relaxed font-medium text-ink">{q.text}</p>
                {q.hint && <p className="mb-6 text-xs text-ink-mute">{q.hint}</p>}

                {q.kind === 'choice' ? (
                  <div className="mt-6 space-y-2">
                    {q.options?.map((o) => {
                      const on = picked === o.value
                      return (
                        <button
                          key={o.value}
                          onClick={() => {
                            setPicked(o.value)
                            void submit(o.value)
                          }}
                          disabled={busy}
                          className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-all disabled:opacity-60 ${
                            on
                              ? 'border-accent/70 bg-accent-soft'
                              : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2'
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                              on ? 'border-accent bg-accent' : 'border-line-strong'
                            }`}
                          >
                            {on && <Check size={11} strokeWidth={3.2} className="text-accent-fg" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm text-ink">{o.label}</span>
                            {o.desc && (
                              <span className="mt-0.5 block text-2xs text-ink-mute">{o.desc}</span>
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="mt-6">
                    <textarea
                      autoFocus
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(text)
                      }}
                      rows={4}
                      placeholder="用你自己的话写就行，写得糙一点没关系"
                      className="w-full resize-none rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm leading-relaxed text-ink placeholder:text-ink-mute focus:border-line-strong focus:outline-none"
                    />
                    <button
                      onClick={() => void submit(text)}
                      disabled={busy || !text.trim()}
                      className="mt-3 flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
                    >
                      {busy ? <Loader2 size={13} className="animate-spin" /> : null}
                      继续
                      <ArrowRight size={14} />
                    </button>
                  </div>
                )}

                {busy && q.kind === 'choice' && (
                  <p className="mt-3 flex items-center gap-1.5 text-2xs text-ink-mute">
                    <Loader2 size={11} className="animate-spin" />
                    正在想下一个问题…
                  </p>
                )}
              </motion.div>
            )}

            {/* ── 画像确认 ── */}
            {phase === 'confirm' && profile && (
              <motion.div key="confirm" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="mb-5 flex items-center gap-2">
                  <UserRound size={16} className="text-accent" />
                  <h2 className="text-lg font-medium text-ink">我这样理解你，对吗？</h2>
                </div>

                <div className="rounded-lg border border-accent/30 bg-accent-soft/40 px-4 py-3.5">
                  <p className="text-sm leading-relaxed text-ink">{profile.summary}</p>
                </div>

                <ul className="mt-4 space-y-1.5 text-xs text-ink-dim">
                  <li>· 现在水平：{FAM[profile.familiarity] ?? '—'}</li>
                  <li>· 想做到：{profile.focus || '（没写）'}</li>
                  <li>· 教学方式：{STYLE[profile.style]}</li>
                  <li>· 卡住时：{SUPPORT[profile.support]}</li>
                  {profile.notes.length > 0 && <li>· 其他：{profile.notes.join('；')}</li>}
                </ul>

                <p className="mt-5 text-xs leading-relaxed text-ink-mute">
                  接下来我会基于这些，加上你导入的资料，给你写一本**专属教材**——不是通用讲义，
                  是照着你现在的水平和现实条件编的。大概要 40 秒。
                </p>

                <div className="mt-6 flex items-center gap-3">
                  <button
                    onClick={build}
                    className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
                  >
                    <Sparkles size={14} />
                    给我写这本书
                  </button>
                  <button
                    onClick={() => {
                      setPhase('asking')
                      setStep(1)
                      void boot()
                    }}
                    className="h-10 rounded-md border border-line bg-surface px-4 text-sm text-ink-dim hover:bg-surface-2 hover:text-ink"
                  >
                    重新答一遍
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── 生成中 ── */}
            {phase === 'building' && (
              <motion.div key="building" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-10">
                <div className="mb-5 flex items-center gap-2.5">
                  <Loader2 size={16} className="animate-spin text-accent" />
                  <span className="text-sm text-ink">正在写你的教材…</span>
                </div>

                <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <motion.div
                    className="h-full bg-accent transition-all duration-700"
                    animate={{ width: `${book?.progress ?? 8}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-2xs text-ink-mute">
                  <span>{book?.stage || '准备中'}</span>
                  <span className="tabular-nums">{book?.progress ?? 0}%</span>
                </div>

                <p className="mt-6 text-xs leading-relaxed text-ink-mute">
                  它会先看一遍你导入的资料，再按你的水平排章节，
                  然后一章一章写。写完就可以开始上课了。
                </p>
              </motion.div>
            )}

            {/* ── 完成 ── */}
            {phase === 'done' && book && (
              <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="mb-1 text-2xs tracking-wide text-accent">书已经写好了</div>
                <h2 className="mb-1 text-2xl font-semibold tracking-tight text-ink">{book.title}</h2>
                <p className="mb-5 text-sm text-ink-dim">{book.subtitle}</p>

                <div className="rounded-lg border border-line bg-surface px-4 py-3.5">
                  <p className="text-sm leading-relaxed text-ink-dim">{book.preface}</p>
                </div>

                <div className="mt-4 space-y-1">
                  {book.chapters.map((c, i) => (
                    <div key={c.id} className="flex items-baseline gap-2 text-xs text-ink-dim">
                      <span className="w-4 shrink-0 text-right text-2xs tabular-nums text-ink-mute">
                        {i + 1}
                      </span>
                      <span className="text-ink">{c.title}</span>
                      <span className="ml-auto shrink-0 text-2xs text-ink-mute">{c.wordCount} 字</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => onDone(profile!)}
                  className="mt-7 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
                >
                  翻开这本书，开始第一章
                  <ArrowRight size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

const FAM = [
  '完全没接触过',
  '听过、看过，但没自己动过手',
  '能跟着做，但离开教程就卡住',
  '基本会了，想抠细节',
  '已经很熟，想系统化',
]
const STYLE: Record<string, string> = {
  principle: '先讲原理，再动手',
  example: '先看例子，再总结',
  'hands-on': '直接上手，边做边讲',
}
const SUPPORT: Record<string, string> = {
  handholding: '手把手喂到嘴边',
  guided: '给方向，卡住再拉',
  independent: '需要时再出现',
}
