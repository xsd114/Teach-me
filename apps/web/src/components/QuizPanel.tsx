import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
  Target,
  AlertTriangle,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { api, type Question, type QuizStats } from '../lib/api'

const TYPE_LABEL: Record<Question['type'], string> = {
  mcq: '单选',
  blank: '填空',
  short: '简答',
  calc: '计算',
}

export function QuizPanel({ courseId }: { courseId: string }) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [stats, setStats] = useState<QuizStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dueOnly, setDueOnly] = useState(false)
  const [count, setCount] = useState(5)

  const load = useCallback(async () => {
    try {
      const r = await api.questions(courseId, dueOnly)
      setQuestions(r.questions)
      setStats(r.stats)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [courseId, dueOnly])

  useEffect(() => {
    void load()
  }, [load])

  const generate = async () => {
    setBusy(true)
    setErr(null)
    try {
      await api.generateQuestions(courseId, count)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '出题失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 统计 + 生成 */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        {stats && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-dim">
            <span className="flex items-center gap-1 tabular-nums">
              <Target size={11} /> {stats.total} 道题
            </span>
            <span className="flex items-center gap-1 tabular-nums text-accent">
              <RotateCcw size={11} /> 待复习 {stats.due}
            </span>
            <span className="flex items-center gap-1 tabular-nums text-warn">
              <AlertTriangle size={11} /> 错题 {stats.wrong}
            </span>
            <span className="tabular-nums">正确率 {Math.round(stats.accuracy * 100)}%</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setDueOnly((v) => !v)}
            className={`h-8 rounded-md border px-2.5 text-2xs transition-colors ${
              dueOnly
                ? 'border-accent/50 bg-accent-soft text-accent'
                : 'border-line bg-surface-2 text-ink-dim hover:text-ink'
            }`}
          >
            只看待复习
          </button>
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="h-8 rounded-md border border-line bg-surface-2 px-2 text-2xs text-ink-dim focus:outline-none"
          >
            {[3, 5, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n} 道
              </option>
            ))}
          </select>
          <button
            onClick={generate}
            disabled={busy}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {busy ? '出题中…' : '出题'}
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {err}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-2/50" />
          ))}
        </div>
      ) : questions.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line text-sm text-ink-mute">
          <Target size={22} strokeWidth={1.4} />
          {dueOnly ? '暂时没有要复习的题' : '还没有题目，点「出题」让 ALP 按资料出几道'}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {questions.map((q) => (
            <QuestionCard key={q.id} q={q} onAnswered={load} />
          ))}
        </ul>
      )}
    </div>
  )
}

function QuestionCard({ q, onAnswered }: { q: Question; onAnswered: () => void }) {
  const [picked, setPicked] = useState('')
  const [result, setResult] = useState<null | { correct: boolean; explain: string; answer: string }>(null)
  const [busy, setBusy] = useState(false)
  const [t0] = useState(Date.now())

  const submit = async (val?: string) => {
    const answer = (val ?? picked).trim()
    if (!answer) return
    setBusy(true)
    try {
      const r = await api.answerQuestion(q.id, answer, Date.now() - t0)
      setResult({ correct: r.correct, explain: q.explain, answer: q.answer })
      onAnswered()
    } finally {
      setBusy(false)
    }
  }

  const dueSoon = q.dueAt ? new Date(q.dueAt).getTime() <= Date.now() : false

  return (
    <motion.li layout className="rounded-lg border border-line bg-surface px-4 py-3.5">
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded-sm bg-surface-3 px-1.5 py-0.5 text-2xs text-ink-mute">
          {TYPE_LABEL[q.type]}
        </span>
        <p className="flex-1 text-sm leading-relaxed text-ink">{q.stem}</p>
        {dueSoon && <span className="shrink-0 text-2xs text-accent">该复习了</span>}
      </div>

      {q.type === 'mcq' ? (
        <div className="space-y-1.5">
          {q.options.map((opt, i) => {
            const letter = String.fromCharCode(65 + i)
            const chosen = picked === letter
            const isRight = result && letter === result.answer
            const isWrong = result && chosen && !result.correct
            return (
              <button
                key={i}
                onClick={() => !result && setPicked(letter)}
                disabled={Boolean(result)}
                className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                  isRight
                    ? 'border-ok/50 bg-ok/10 text-ok'
                    : isWrong
                      ? 'border-danger/50 bg-danger/10 text-danger'
                      : chosen
                        ? 'border-accent/60 bg-accent-soft text-ink'
                        : 'border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink'
                }`}
              >
                <span className="shrink-0 font-mono">{letter}</span>
                <span className="leading-relaxed">{opt.replace(/^[A-D][.、)]\s*/, '')}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            disabled={Boolean(result)}
            placeholder={q.type === 'blank' ? '填这个空' : '写你的答案'}
            className="h-9 flex-1 rounded-md border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-mute focus:border-line-strong focus:outline-none disabled:opacity-60"
          />
          {!result && (
            <button
              onClick={() => void submit()}
              disabled={busy || !picked.trim()}
              className="h-9 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
            >
              提交
            </button>
          )}
        </div>
      )}

      {q.type === 'mcq' && !result && (
        <button
          onClick={() => void submit()}
          disabled={busy || !picked}
          className="mt-2 h-8 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
        >
          提交
        </button>
      )}

      {result && (
        <div className="mt-2.5 rounded-md border border-line bg-surface-2 px-3 py-2">
          <div className={`mb-1 flex items-center gap-1.5 text-xs ${result.correct ? 'text-ok' : 'text-danger'}`}>
            {result.correct ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {result.correct ? '答对了' : `答错了，正确是：${result.answer}`}
          </div>
          {result.explain && (
            <p className="text-2xs leading-relaxed text-ink-mute">{result.explain}</p>
          )}
          {!result.correct && (
            <p className="mt-1 text-2xs text-warn">已进错题本，10 分钟后再来一次</p>
          )}
        </div>
      )}

      {result && (
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={async () => {
              setPicked('')
              setResult(null)
            }}
            className="text-2xs text-ink-mute hover:text-ink"
          >
            再做一次
          </button>
          <button
            onClick={async () => {
              await api.deleteQuestion(q.id)
              onAnswered()
            }}
            className="ml-auto flex items-center gap-1 text-2xs text-ink-mute hover:text-danger"
          >
            <Trash2 size={10} /> 删掉
          </button>
        </div>
      )}
    </motion.li>
  )
}
