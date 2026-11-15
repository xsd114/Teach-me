import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import { Flame, Clock, CalendarDays, TrendingUp, Wand2, Loader2 } from 'lucide-react'
import { api, type ProgressPayload } from '../lib/api'
import { cssVar } from '../theme'

export function ProgressPanel({ courseId }: { courseId: string }) {
  const [data, setData] = useState<ProgressPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)
  const [seeding, setSeeding] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api.progress(courseId, days)
      setData(r)
    } finally {
      setLoading(false)
    }
  }, [courseId, days])

  useEffect(() => {
    void load()
  }, [load])

  if (loading || !data) {
    return (
      <div className="flex h-56 items-center justify-center gap-2 text-sm text-ink-mute">
        <Loader2 size={15} className="animate-spin" />
        正在统计…
      </div>
    )
  }

  const hasData = data.totals.sessions > 0

  return (
    <div className="space-y-4">
      {/* 指标卡 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric icon={Clock} label="累计时长" value={`${data.totals.minutes}`} unit="分钟" />
        <Metric icon={CalendarDays} label="学习天数" value={`${data.totals.days}`} unit="天" />
        <Metric icon={TrendingUp} label="上课次数" value={`${data.totals.sessions}`} unit="次" />
        <Metric
          icon={Flame}
          label="连续天数"
          value={`${data.totals.streak}`}
          unit="天"
          accent={data.totals.streak >= 3}
        />
      </div>

      {!hasData ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line text-center">
          <p className="text-sm text-ink-mute">还没有学习记录</p>
          <p className="text-2xs text-ink-mute">上完一次课，这里就会有曲线和热力图</p>
          <button
            onClick={async () => {
              setSeeding(true)
              try {
                await api.seedProgress(courseId, 14)
                await load()
              } finally {
                setSeeding(false)
              }
            }}
            disabled={seeding}
            className="mt-1 flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-2xs text-ink-dim hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          >
            <Wand2 size={11} />
            {seeding ? '生成中…' : '生成一段示例数据（预览图表）'}
          </button>
        </div>
      ) : (
        <>
          {/* 热力图 */}
          <Card title="学习热力图" hint="最近 12 周，颜色越亮当天越久">
            <Heatmap cells={data.heatmap} />
          </Card>

          {/* 掌握度曲线 */}
          <Card title="掌握度变化" hint="每次下课时的自评掌握度">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.mastery.map((m, i) => ({ ...m, i: i + 1 }))}>
                  <CartesianGrid stroke={cssVar.line} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="i"
                    tick={{ fill: cssVar.inkMute, fontSize: 11 }}
                    stroke={cssVar.line}
                  />
                  <YAxis
                    domain={[0, 1]}
                    tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    tick={{ fill: cssVar.inkMute, fontSize: 11 }}
                    stroke={cssVar.line}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-surface-3)',
                      border: `1px solid ${cssVar.lineStrong}`,
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelFormatter={(v) => `第 ${v} 次课`}
                    formatter={(v) => [`${Math.round(Number(v) * 100)}%`, '掌握度']}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={cssVar.accent}
                    strokeWidth={2}
                    dot={{ r: 3, fill: cssVar.accent }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* 每日时长 */}
          <Card
            title="每天学了多久"
            hint={
              <div className="flex items-center gap-1">
                {[14, 30, 60].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`rounded px-1.5 py-0.5 text-2xs transition-colors ${
                      days === d ? 'bg-accent text-accent-fg' : 'text-ink-mute hover:text-ink-dim'
                    }`}
                  >
                    {d} 天
                  </button>
                ))}
              </div>
            }
          >
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.daily}>
                  <CartesianGrid stroke={cssVar.line} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => d.slice(5)}
                    tick={{ fill: cssVar.inkMute, fontSize: 10 }}
                    stroke={cssVar.line}
                    interval={Math.max(0, Math.floor(days / 10))}
                  />
                  <YAxis
                    tick={{ fill: cssVar.inkMute, fontSize: 11 }}
                    stroke={cssVar.line}
                    width={32}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-surface-3)',
                      border: `1px solid ${cssVar.lineStrong}`,
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v) => [`${Number(v)} 分钟`, '时长']}
                  />
                  <Bar dataKey="minutes" fill={cssVar.accent} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* 课时掌握度 */}
          {data.lessons.length > 0 && (
            <Card title="各课时掌握度" hint="">
              <ul className="space-y-1.5">
                {data.lessons.map((l) => (
                  <li key={l.id} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 truncate text-xs text-ink-dim">{l.title}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full bg-accent transition-all"
                        style={{ width: `${Math.round(l.mastery * 100)}%` }}
                      />
                    </div>
                    <span className="w-9 shrink-0 text-right text-2xs tabular-nums text-ink-mute">
                      {Math.round(l.mastery * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  unit,
  accent,
}: {
  icon: typeof Clock
  label: string
  value: string
  unit: string
  accent?: boolean
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3.5 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-2xs text-ink-mute">
        <Icon size={11} className={accent ? 'text-accent' : ''} />
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-xl font-semibold tabular-nums ${accent ? 'text-accent' : 'text-ink'}`}>
          {value}
        </span>
        <span className="text-2xs text-ink-mute">{unit}</span>
      </div>
    </div>
  )
}

function Card({
  title,
  hint,
  children,
}: {
  title: string
  hint: ReactNode
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium text-ink">{title}</h3>
        <span className="text-2xs text-ink-mute">{hint}</span>
      </div>
      {children}
    </div>
  )
}

/** 84 天热力图，按周排成 12 列 */
function Heatmap({ cells }: { cells: { date: string; minutes: number; level: number }[] }) {
  const LEVEL_BG = [
    'var(--color-surface-3)',
    'rgba(231,183,95,0.22)',
    'rgba(231,183,95,0.42)',
    'rgba(231,183,95,0.66)',
    'var(--color-accent)',
  ]
  // 补齐到整周
  const padded = [...cells]
  const firstDow = new Date(padded[0]?.date ?? Date.now()).getDay()
  for (let i = 0; i < firstDow; i++) padded.unshift({ date: '', minutes: -1, level: 0 })

  const weeks: typeof padded[] = []
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7))

  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {weeks.map((w, wi) => (
        <div key={wi} className="flex flex-col gap-1">
          {w.map((c, ci) => (
            <div
              key={ci}
              title={c.minutes >= 0 ? `${c.date}：${c.minutes} 分钟` : ''}
              className="h-3 w-3 rounded-[2px] transition-colors"
              style={{ background: c.minutes < 0 ? 'transparent' : LEVEL_BG[c.level] }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
