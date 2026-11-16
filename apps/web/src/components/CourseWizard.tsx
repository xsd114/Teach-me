import { useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Wrench,
  GraduationCap,
  Check,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Database,
  BookOpen,
  Globe2,
  Tags,
  FileText,
  FileUp,
} from 'lucide-react'
import { Modal } from './Modal'
import { api } from '../lib/api'
import type { CourseKind, CreateCourseInput, MemoryMode } from '../lib/types'
import { VERBOSITY_LABEL, VERBOSITY_MAX_CHARS, type Verbosity } from '../theme'

export type WizardMode = 'course' | 'book'

type Form = {
  title: string
  kind: CourseKind
  goal: string
  baseline: string
  perDayMinutes: number | null
  perDayItems: number | null
  deadline: string
  memoryMode: MemoryMode
  verbosity: Verbosity
  /** 网上搜索更多相关书籍作为补充 */
  /** 第 2 步传的资料分析结果 */
  uploaded: UploadedMaterial
  searchMore: boolean
  /** 加入关键词与参考文档（依赖 searchMore） */
  withKeywords: boolean
}

const INITIAL: Form = {
  title: '',
  kind: 'skill',
  goal: '',
  baseline: '',
  perDayMinutes: 30,
  perDayItems: null,
  deadline: '',
  memoryMode: 'auto',
  verbosity: 3,
  uploaded: null,
  searchMore: false,
  withKeywords: false,
}

export function CourseWizard({
  open,
  mode,
  onClose,
  onSubmit,
}: {
  open: boolean
  mode: WizardMode
  onClose: () => void
  onSubmit: (
    input: CreateCourseInput,
    extra: { searchMore: boolean; withKeywords: boolean; mode: WizardMode; materialId?: string | null },
  ) => Promise<void>
}) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<Form>({ ...INITIAL, kind: mode === 'book' ? 'academic' : 'skill' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const STEPS = mode === 'book' ? (['书', '目标', '节奏', '记忆库'] as const) : (['类型', '目标', '工作量', '记忆库'] as const)

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const close = () => {
    if (busy) return
    setStep(0)
    setForm({ ...INITIAL, kind: mode === 'book' ? 'academic' : 'skill' })
    setErr(null)
    onClose()
  }

  const canNext = step === 1 ? form.title.trim().length > 0 : true

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      await onSubmit(
        {
          title: form.title.trim(),
          kind: form.kind,
          goal: form.goal.trim(),
          baseline: form.baseline.trim(),
          perDayMinutes: form.perDayMinutes ?? undefined,
          perDayItems: form.perDayItems ?? undefined,
          deadline: form.deadline || null,
          memoryMode: form.memoryMode,
          verbosity: form.verbosity,
        },
        { searchMore: form.searchMore, withKeywords: form.withKeywords, mode, materialId: form.uploaded?.id ?? null },
      )
      setStep(0)
      setForm({ ...INITIAL, kind: mode === 'book' ? 'academic' : 'skill' })
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={mode === 'book' ? '添加一本书' : '添加一门课'}
      subtitle={`第 ${step + 1} / ${STEPS.length} 步 · ${STEPS[step]}`}
      width={640}
      footer={
        <>
          <div className="mr-auto flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={`h-1 rounded-full transition-all ${
                  i === step ? 'w-6 bg-accent' : i < step ? 'w-3 bg-accent/45' : 'w-3 bg-line-strong'
                }`}
              />
            ))}
          </div>
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              disabled={busy}
              className="flex h-9 items-center gap-1 rounded-md border border-line bg-surface px-3 text-sm text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
            >
              <ChevronLeft size={15} />
              上一步
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button
              onClick={() => canNext && setStep((s) => s + 1)}
              disabled={!canNext}
              className="flex h-9 items-center gap-1 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一步
              <ChevronRight size={15} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={busy || !form.title.trim()}
              className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check size={15} strokeWidth={2.6} />
              {busy ? '创建中…' : mode === 'book' ? '建好，去导入书' : '创建课程'}
            </button>
          )}
        </>
      }
    >
      {err && (
        <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {err}
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          {step === 0 && mode === 'book' && <StepBookNote />}
          {step === 0 && mode === 'course' && <StepKind value={form.kind} onChange={(k) => set('kind', k)} />}
          {step === 1 && <StepGoal form={form} set={set} mode={mode} />}
          {step === 2 && <StepWorkload form={form} set={set} mode={mode} />}
          {step === 3 && <StepMemory form={form} set={set} />}
        </motion.div>
      </AnimatePresence>
    </Modal>
  )
}

/* ───────────────────────── 第 1 步 ───────────────────────── */

function StepBookNote() {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5 rounded-lg border border-info/30 bg-info/[0.06] px-4 py-3">
        <BookOpen size={15} className="mt-0.5 shrink-0 text-info" />
        <div className="text-xs leading-relaxed text-ink-dim">
          这个入口是「我有书、我要按这本书学」。
          <br />
          建好之后，去「资料」页把 PDF / 教材导进来，我会**按它原来的章节**拆好放到左侧目录，
          每一章就像教材一样带着你读、给你配图、出题。
          <br />
          <span className="text-ink-mute">
            （如果你想要我"照你的水平写一本"，回上一步选「看书」。）
          </span>
        </div>
      </div>
    </div>
  )
}

function StepKind({ value, onChange }: { value: CourseKind; onChange: (k: CourseKind) => void }) {
  const items: { k: CourseKind; icon: typeof Wrench; title: string; desc: string; bullet: string[] }[] = [
    {
      k: 'skill',
      icon: Wrench,
      title: '个人技能',
      desc: '做菜、乐器、编程、软件…',
      bullet: ['按步骤练，产出看得见', '不设每日时长和截止日', '进度靠节次与实操判定'],
    },
    {
      k: 'academic',
      icon: GraduationCap,
      title: '学业课程',
      desc: '数学、英语、专业课、备考…',
      bullet: ['要出题、要判分、要复习', '可设每日题量与截止日', '有错题本与遗忘曲线'],
    },
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map(({ k, icon: Icon, title, desc, bullet }) => {
        const on = value === k
        return (
          <button
            key={k}
            onClick={() => onChange(k)}
            className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all ${
              on ? 'border-accent/70 bg-accent-soft' : 'border-line bg-surface-2 hover:border-line-strong hover:bg-surface-3'
            }`}
          >
            <div className={`flex items-center gap-2 ${on ? 'text-accent' : 'text-ink-dim'}`}>
              <Icon size={17} strokeWidth={1.9} />
              <span className="text-sm font-medium text-ink">{title}</span>
            </div>
            <p className="text-xs text-ink-dim">{desc}</p>
            <ul className="mt-1 space-y-1">
              {bullet.map((b) => (
                <li key={b} className="flex items-start gap-1.5 text-2xs text-ink-mute">
                  <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-ink-mute" />
                  {b}
                </li>
              ))}
            </ul>
          </button>
        )
      })}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-xs font-medium text-ink">{label}</span>
        {hint && <span className="text-2xs text-ink-mute">{hint}</span>}
      </div>
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-mute focus:border-line-strong focus:bg-surface-3 focus:outline-none'

function StepGoal({
  form,
  set,
  mode,
}: {
  form: Form
  set: <K extends keyof Form>(k: K, v: Form[K]) => void
  mode: WizardMode
}) {
  return (
    <div className="space-y-4">
      <Field label={mode === 'book' ? '这本书 / 这门课叫什么' : '课程名称'} hint="必填，最多 80 字">
        <input
          autoFocus
          value={form.title}
          onChange={(e) => set('title', e.target.value.slice(0, 80))}
          placeholder={mode === 'book' ? '例：粤菜烹饪基础（我的那本教材）' : '例：粤菜基础 · 火候与鲜'}
          className={inputCls}
        />
      </Field>

      <Field label="学完要能做到什么" hint="可选 · 越具体，后面排的进度越准">
        <textarea
          value={form.goal}
          onChange={(e) => set('goal', e.target.value.slice(0, 400))}
          rows={3}
          placeholder="例：把「蒸、浸、灼、焯」四种基本功练到能稳定出菜，不靠感觉判断火候"
          className={`${inputCls} resize-none leading-relaxed`}
        />
      </Field>

      <Field label="现在的基础" hint="可选 · 决定第一节课从哪开始，写「零基础」也完全可以">
        <textarea
          value={form.baseline}
          onChange={(e) => set('baseline', e.target.value.slice(0, 400))}
          rows={2}
          placeholder="例：会做家常菜，但火候靠感觉，出品不稳定"
          className={`${inputCls} resize-none leading-relaxed`}
        />
      </Field>

      {/* 有现成资料就先传，传完当场告诉你它是讲什么的，你确认了再往下走 */}
      <UploadAndAnalyze
        analyzed={form.uploaded}
        setAnalyzed={(v) => set('uploaded', v)}
      />
    </div>
  )
}

/* ───────────────────────── 上传并分析 ───────────────────────── */

export type UploadedMaterial = {
  id: string
  name: string
  chars: number
  topic: string
  summary: string
  points: string[]
  suitable: string
} | null

function UploadAndAnalyze({
  analyzed,
  setAnalyzed,
}: {
  analyzed: UploadedMaterial
  setAnalyzed: (v: UploadedMaterial) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [stage, setStage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File) => {
    setBusy(true)
    setErr(null)
    setStage('上传中…')
    try {
      const r = await api.uploadMaterials([file], null)
      const mat = r.materials?.[0]
      if (!mat) throw new Error('上传没返回资料')
      setStage('正在看这份资料讲什么…')
      const a = await api.analyzeMaterial(mat.id)
      setAnalyzed({
        id: mat.id,
        name: a.name ?? mat.name,
        chars: a.chars ?? 0,
        topic: a.topic ?? '',
        summary: a.summary ?? '',
        points: a.points ?? [],
        suitable: a.suitable ?? '',
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '处理失败')
    } finally {
      setBusy(false)
      setStage('')
    }
  }

  if (analyzed) {
    return (
      <div className="rounded-lg border border-info/30 bg-info/[0.06] p-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <FileText size={12} className="text-info" />
          <span className="text-xs font-medium text-ink">{analyzed.name}</span>
          <span className="text-[10px] text-ink-mute">
            {analyzed.chars > 0 ? `${analyzed.chars.toLocaleString()} 字` : ''}
          </span>
          <button
            onClick={() => setAnalyzed(null)}
            className="ml-auto text-[10px] text-ink-mute hover:text-danger"
          >
            移除
          </button>
        </div>

        {analyzed.topic && (
          <div className="mb-1 flex items-center gap-1.5">
            <span className="rounded-sm bg-info/20 px-1.5 py-0.5 text-[10px] text-info">{analyzed.topic}</span>
            {analyzed.suitable && <span className="text-[10px] text-ink-mute">{analyzed.suitable}</span>}
          </div>
        )}

        <p className="text-2xs leading-relaxed text-ink-dim">{analyzed.summary}</p>

        {analyzed.points.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {analyzed.points.map((p, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[10px] text-ink-mute">
                <span className="mt-[4px] h-1 w-1 shrink-0 rounded-full bg-info/60" />
                {p}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-2 text-[10px] text-ink-mute">
          内容对得上就点「下一步」；不对就移除重传。
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-dashed border-line bg-surface-2 px-3 py-3">
      <div className="flex items-center gap-2">
        <FileUp size={13} className="text-ink-mute" />
        <span className="text-xs text-ink-dim">有现成资料？传上来我先看看是什么</span>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="ml-auto rounded-md border border-line bg-surface px-2.5 py-1 text-2xs text-ink-dim hover:text-ink disabled:opacity-50"
        >
          {busy ? stage : '选择文件'}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-ink-mute">
        什么都能传：PDF / Word / PPT / Markdown / 纯文本 / epub / azw3 / mobi。可选——不传也行，我按名字和你的描述来写。
      </p>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ''
        }}
      />
      {err && <p className="mt-1.5 text-2xs text-danger">{err}</p>}
    </div>
  )
}

/* ───────────────────────── 第 3 步：工作量 ───────────────────────── */

function StepWorkload({
  form,
  set,
  mode,
}: {
  form: Form
  set: <K extends keyof Form>(k: K, v: Form[K]) => void
  mode: WizardMode
}) {
  const isSkill = form.kind === 'skill'
  const minuteChips = [15, 30, 45, 60, 90]
  const itemChips = [0, 5, 8, 10, 20]

  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-ink-dim">
        {isSkill
          ? '技能类不按时间管你——只要目标清楚，练到哪算到哪。下面这些都可以不填。'
          : '这三种度量可以同时生效：按时间、按题量、按截止日倒推。ALP 取其中更紧的那个来排今天的量。全部可选，不填就不管。'}
      </p>

      {!isSkill && (
        <Field label="每天投入" hint="可选 · 分钟">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={5}
              max={600}
              value={form.perDayMinutes ?? ''}
              onChange={(e) => set('perDayMinutes', e.target.value === '' ? null : Number(e.target.value))}
              placeholder="不设"
              className={`${inputCls} w-24`}
            />
            <span className="text-xs text-ink-mute">分钟</span>
            <div className="ml-2 flex flex-wrap gap-1.5">
              {minuteChips.map((m) => (
                <button
                  key={m}
                  onClick={() => set('perDayMinutes', form.perDayMinutes === m ? null : m)}
                  className={`rounded-sm px-2 py-1 text-2xs transition-colors ${
                    form.perDayMinutes === m ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-ink-dim hover:text-ink'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </Field>
      )}

      <Field
        label="每天题量"
        hint={isSkill ? '可选 · 技能类一般不用' : mode === 'book' ? '可选 · 建议 8–20 题' : '可选'}
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={500}
            value={form.perDayItems ?? ''}
            onChange={(e) => set('perDayItems', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="不设"
            className={`${inputCls} w-24`}
          />
          <span className="text-xs text-ink-mute">题 / 天</span>
          <div className="ml-2 flex flex-wrap gap-1.5">
            {itemChips.map((m) => (
              <button
                key={m}
                onClick={() => set('perDayItems', form.perDayItems === m ? null : m)}
                className={`rounded-sm px-2 py-1 text-2xs transition-colors ${
                  form.perDayItems === m ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-ink-dim hover:text-ink'
                }`}
              >
                {m === 0 ? '不设' : m}
              </button>
            ))}
          </div>
        </div>
      </Field>

      {!isSkill && (
        <Field label="截止日期" hint="可选 · 有考试或交付就填，ALP 会倒推每天的量">
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={form.deadline}
              onChange={(e) => set('deadline', e.target.value)}
              className={`${inputCls} w-52`}
            />
            {form.deadline && (
              <button onClick={() => set('deadline', '')} className="text-2xs text-ink-mute hover:text-danger">
                清空
              </button>
            )}
          </div>
        </Field>
      )}

      {/* 补充材料 */}
      <div className="space-y-2 rounded-lg border border-line bg-surface-2 p-3">
        <SwitchRow
          icon={Globe2}
          title="让 ALP 去网上找更多相关书籍做补充"
          desc="除了你导入的资料，再从公开来源补几本；找完会先给你看清单，确认后才入库"
          checked={form.searchMore}
          onChange={(b) => {
            set('searchMore', b)
            if (!b) set('withKeywords', false)
          }}
        />
        {form.searchMore && (
          <div className="ml-6 border-l border-line pl-3">
            <SwitchRow
              icon={Tags}
              title="同时整理关键词与参考文档"
              desc="生成一份关键词表（附出处），教学和出题时会用到"
              checked={form.withKeywords}
              onChange={(b) => set('withKeywords', b)}
              small
            />
          </div>
        )}
      </div>
    </div>
  )
}

function SwitchRow({
  icon: Icon,
  title,
  desc,
  checked,
  onChange,
  small,
}: {
  icon: typeof Globe2
  title: string
  desc: string
  checked: boolean
  onChange: (b: boolean) => void
  small?: boolean
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${
        checked ? 'bg-accent-soft/60' : 'hover:bg-surface-3'
      }`}
    >
      <span className={`mt-0.5 shrink-0 ${checked ? 'text-accent' : 'text-ink-mute'}`}>
        <Icon size={small ? 12 : 14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block ${small ? 'text-2xs' : 'text-xs'} font-medium ${checked ? 'text-ink' : 'text-ink-dim'}`}>
          {title}
        </span>
        <span className="mt-0.5 block text-2xs leading-relaxed text-ink-mute">{desc}</span>
      </span>
      <span
        className={`mt-1 flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors ${
          checked ? 'justify-end bg-accent' : 'justify-start bg-line-strong'
        }`}
      >
        <span className="h-3 w-3 rounded-full bg-white/90" />
      </span>
    </button>
  )
}

/* ───────────────────────── 第 4 步：记忆库 ───────────────────────── */

function StepMemory({
  form,
  set,
}: {
  form: Form
  set: <K extends keyof Form>(k: K, v: Form[K]) => void
}) {
  const modes: { k: MemoryMode; title: string; desc: string }[] = [
    { k: 'auto', title: '自动判断（推荐）', desc: '按资料量决定：少于 3 万字直接全文读；超过就建向量库' },
    { k: 'on', title: '始终开启', desc: '资料不多也建索引，检索更快、更省 token' },
    { k: 'off', title: '关闭', desc: '只做全文直读。适合资料很少、想省内存的课程' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5">
        <Database size={15} className="mt-0.5 shrink-0 text-ink-mute" />
        <p className="text-2xs leading-relaxed text-ink-dim">
          记忆库 = 把这门课的资料切块、转向量、建索引。开着它，回答时会先检索再说话，
          能引用到具体文件第几段；关掉它，就是把你导入的文字整篇塞进上下文。
        </p>
      </div>

      <div className="space-y-2">
        {modes.map(({ k, title, desc }) => {
          const on = form.memoryMode === k
          return (
            <button
              key={k}
              onClick={() => set('memoryMode', k)}
              className={`flex w-full items-start gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-all ${
                on ? 'border-accent/70 bg-accent-soft' : 'border-line bg-surface-2 hover:bg-surface-3'
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
                <span className="block text-xs font-medium text-ink">{title}</span>
                <span className="mt-0.5 block text-2xs leading-relaxed text-ink-mute">{desc}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <Gauge size={14} className="text-ink-mute" />
          <span className="text-xs font-medium text-ink">讲解密度</span>
          <span className="text-2xs text-ink-mute">每节正文上限 {VERBOSITY_MAX_CHARS[form.verbosity]} 字</span>
        </div>
        <div className="flex gap-1.5">
          {([1, 2, 3, 4, 5] as Verbosity[]).map((v) => (
            <button
              key={v}
              onClick={() => set('verbosity', v)}
              className={`flex-1 rounded-md border px-2 py-2 text-2xs transition-all ${
                form.verbosity === v
                  ? 'border-accent/70 bg-accent-soft text-accent'
                  : 'border-line bg-surface-2 text-ink-mute hover:text-ink-dim'
              }`}
            >
              {VERBOSITY_LABEL[v]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-2xs text-ink-mute">
          默认第 3 档：一屏能读完，但不再是三句话。嫌啰嗦调到 1–2 档。
        </p>
      </div>
    </div>
  )
}
