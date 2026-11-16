import { MarksPanel } from '../components/MarksPanel'
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ChevronLeft,
  Brain,
  Maximize2,
  CheckCircle2,
  Circle,
  CircleDot,
  RotateCcw,
  Clock,
  Target,
  Highlighter,
  Flag,
  FolderOpen,
  PlayCircle,
  LineChart,
  Play,
  Wand2,
  BookOpen,
} from 'lucide-react'
import type { Course } from '../lib/types'
import { api, onboardingApi, KIND_META, relTime, daysUntil } from '../lib/api'
import { Ring } from '../components/Ring'
import { MaterialsPanel } from '../components/MaterialsPanel'
import { ProgressPanel } from '../components/ProgressPanel'
import { QuizPanel } from '../components/QuizPanel'
import { OnboardingFlow } from '../components/OnboardingFlow'
import { TextbookPage } from './TextbookPage'
import { TeachSession } from './TeachSession'

type Lesson = {
  id: string
  courseId: string
  orderIndex: number
  title: string
  summary: string
  state: 'todo' | 'doing' | 'review' | 'done'
  mastery: number
}

type Tab = 'book' | 'lessons' | 'materials' | 'progress' | 'quiz' | 'marks'

const TABS: { k: Tab; label: string; icon: typeof FolderOpen; hint: string }[] = [
  { k: 'book', label: '教材', icon: BookOpen, hint: '' },
  { k: 'lessons', label: '课时', icon: PlayCircle, hint: '' },
  { k: 'materials', label: '资料', icon: FolderOpen, hint: '' },
  { k: 'progress', label: '进度', icon: LineChart, hint: '' },
  { k: 'quiz', label: '练习', icon: Target, hint: '' },
  { k: 'marks', label: '标记', icon: Highlighter, hint: '' },
]

const STATE_META: Record<Lesson['state'], { icon: typeof Circle; label: string; cls: string }> = {
  todo: { icon: Circle, label: '未开始', cls: 'text-ink-mute' },
  doing: { icon: CircleDot, label: '进行中', cls: 'text-accent' },
  review: { icon: RotateCcw, label: '待复习', cls: 'text-warn' },
  done: { icon: CheckCircle2, label: '已掌握', cls: 'text-ok' },
}

export function CourseDetail({ course, onBack }: { course: Course; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('book')
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [teaching, setTeaching] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const [genBusy, setGenBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [onboard, setOnboard] = useState<{ loaded: boolean; done: boolean; hasBook: boolean }>({
    loaded: false,
    done: true,
    hasBook: false,
  })

  const refreshOnboard = useCallback(async () => {
    try {
      const r = await onboardingApi.status(course.id)
      setOnboard({ loaded: true, done: r.onboarded, hasBook: Boolean(r.textbook) })
      if (r.textbook) setTab('book')
    } catch {
      setOnboard({ loaded: true, done: true, hasBook: false })
    }
  }, [course.id])

  useEffect(() => {
    void refreshOnboard()
  }, [refreshOnboard])

  const loadLessons = useCallback(async () => {
    try {
      const r = await api.getCourseLessons(course.id)
      setLessons(r.lessons)
    } catch {
      setLessons([])
    } finally {
      setLoading(false)
    }
  }, [course.id])

  useEffect(() => {
    void loadLessons()
  }, [loadLessons])

  if (!onboard.loaded) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-mute">正在了解你的情况…</div>
  }

  if (!onboard.done) {
    return (
      <OnboardingFlow
        courseId={course.id}
        courseTitle={course.title}
        onDone={() => {
          void refreshOnboard()
          void loadLessons()
        }}
      />
    )
  }

  if (teaching) {
    return <TeachSession courseId={course.id} onExit={() => { setTeaching(false); void loadLessons() }} />
  }

  const genOutline = async () => {
    setGenBusy(true)
    setNote(null)
    try {
      const r = await api.generateOutline(course.id)
      await loadLessons()
      setNote(r.added > 0 ? `已生成 ${r.added} 个课时` : '没有新增课时（可能已存在同名课时）')
    } catch (e) {
      setNote(e instanceof Error ? e.message : '生成失败')
    } finally {
      setGenBusy(false)
    }
  }

  const toggleState = async (l: Lesson) => {
    const next: Lesson['state'] = l.state === 'done' ? 'todo' : l.state === 'todo' ? 'doing' : l.state === 'doing' ? 'done' : 'done'
    setLessons((prev) => prev.map((x) => (x.id === l.id ? { ...x, state: next } : x)))
    try {
      await api.updateLesson(l.id, { state: next })
    } catch {
      setLessons((prev) => prev.map((x) => (x.id === l.id ? x : x)))
    }
  }

  const left = daysUntil(course.deadline)
  const pct =
    course.stats.lessonTotal > 0 ? course.stats.lessonDone / course.stats.lessonTotal : 0

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Hero */}
      <div className="shrink-0 border-b border-line px-6 pt-4 pb-5">
        <button
          onClick={onBack}
          className="mb-3 flex items-center gap-1 text-xs text-ink-mute transition-colors hover:text-ink"
        >
          <ChevronLeft size={14} />
          返回书架
        </button>

        <div className="flex items-start gap-5">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-sm bg-surface-3 px-1.5 py-0.5 text-2xs text-ink-dim">
                {KIND_META[course.kind].label}
              </span>
              <span className="text-2xs text-ink-mute">
                {course.stats.lessonTotal} 节 · {relTime(course.stats.lastStudiedAt)}
              </span>
              {left !== null && (
                <span className={`text-2xs ${left <= 7 ? 'text-warn' : 'text-ink-mute'}`}>
                  · {left >= 0 ? `距截止 ${left} 天` : `已逾期 ${-left} 天`}
                </span>
              )}
            </div>

            <h1 className="text-xl font-semibold tracking-tight text-ink">{course.title}</h1>
            {course.goal && (
              <p className="prose-narrow mt-1.5 text-sm leading-relaxed text-ink-dim">{course.goal}</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <button
              onClick={() =>
                window.dispatchEvent(new CustomEvent('alp:open-study', { detail: { courseId: course.id } }))
              }
              className="flex h-10 items-center gap-2 rounded-md border border-info/50 bg-info/10 px-4 text-sm font-medium text-info transition-colors hover:bg-info/20"
            >
              <Brain size={14} />
              自习问答
            </button>
            <button
              onClick={() => setTeaching(true)}
              className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              <Play size={14} strokeWidth={2.4} />
              开始上课
            </button>

            <div className="flex flex-col gap-2">
            <div className="flex items-center gap-4 rounded-lg border border-line bg-surface px-4 py-3">
              <Ring value={pct} size={52} stroke={4} />
              <div className="text-2xs leading-relaxed text-ink-mute">
                <div className="flex items-center gap-1.5">
                  <Clock size={11} /> 每天 {course.perDayMinutes} 分钟
                </div>
                <div className="flex items-center gap-1.5">
                  <Target size={11} /> 每天 {course.perDayItems || '—'} 题
                </div>
                <div className="flex items-center gap-1.5">
                  <Flag size={11} /> 记忆库{' '}
                  {course.memoryMode === 'auto' ? '自动' : course.memoryMode === 'on' ? '开启' : '关闭'}
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setTab('book')
                setFullscreen(true)
              }}
              className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-line bg-surface text-2xs text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Maximize2 size={11} />
              全屏阅读
            </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex items-center gap-1">
          {TABS.map(({ k, label, icon: Icon, hint }) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                tab === k ? 'bg-surface-3 text-ink' : 'text-ink-mute hover:text-ink-dim'
              }`}
            >
              <Icon size={13} />
              {label}
              {hint && <span className="text-2xs opacity-50">{hint}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 px-6 py-4">
        {tab === 'lessons' && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-2xs text-ink-mute">{lessons.length} 个课时</span>
              <button
                onClick={genOutline}
                disabled={genBusy}
                className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-2xs text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink disabled:opacity-40"
              >
                <Wand2 size={11} className={genBusy ? 'animate-pulse' : ''} />
                {genBusy ? '生成中…' : '生成大纲'}
              </button>
              {note && <span className="text-2xs text-ink-mute">{note}</span>}
            </div>
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-[68px] animate-pulse rounded-lg bg-surface-2/50" />
                ))}
              </div>
            ) : lessons.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-ink-mute">
                <PlayCircle size={24} strokeWidth={1.4} />
                还没有课时。导入教材后 ALP 会自动拆出课时（M2）
              </div>
            ) : (
              <motion.ul
                initial="hidden"
                animate="show"
                variants={{ show: { transition: { staggerChildren: 0.03 } } }}
                className="space-y-1.5"
              >
                {lessons.map((l) => {
                  const meta = STATE_META[l.state]
                  const Icon = meta.icon
                  return (
                    <motion.li
                      key={l.id}
                      variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
                      className="card card-hover flex items-start gap-3 px-4 py-3"
                    >
                      <button
                        onClick={() => toggleState(l)}
                        title="点击切换状态"
                        className={`mt-0.5 shrink-0 transition-colors ${meta.cls} hover:brightness-125`}
                      >
                        <Icon size={17} strokeWidth={1.9} />
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xs text-ink-mute tabular-nums">
                            {String(l.orderIndex + 1).padStart(2, '0')}
                          </span>
                          <h3 className="truncate text-sm font-medium text-ink">{l.title}</h3>
                          <span className={`shrink-0 text-2xs ${meta.cls}`}>{meta.label}</span>
                        </div>
                        {l.summary && (
                          <p className="mt-1 line-clamp-2 text-2xs leading-relaxed whitespace-pre-line text-ink-mute">
                            {l.summary}
                          </p>
                        )}
                      </div>

                      {l.mastery > 0 && (
                        <span className="mt-0.5 shrink-0 text-2xs text-ink-mute tabular-nums">
                          {Math.round(l.mastery * 100)}%
                        </span>
                      )}
                    </motion.li>
                  )
                })}
              </motion.ul>
            )}
          </>
        )}

        {tab === 'book' && (
          <TextbookPage
            courseId={course.id}
            fullscreen={fullscreen}
            onFullscreenChange={setFullscreen}
            onStartTeaching={() => setTeaching(true)}
          />
        )}

        {tab === 'materials' && <MaterialsPanel courseId={course.id} />}

        {tab === 'progress' && <ProgressPanel courseId={course.id} />}
        {tab === 'quiz' && <QuizPanel courseId={course.id} />}
        {tab === 'marks' && <MarksPanel courseId={course.id} />}
      </div>

    </div>
  )
}