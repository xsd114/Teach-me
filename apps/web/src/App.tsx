import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Library, MessagesSquare, Settings, Search, BookOpen, Plus } from 'lucide-react'
import { api } from './lib/api'
import type { Course, CreateCourseInput } from './lib/types'
import { Shelf } from './pages/Shelf'
import { CourseDetail } from './pages/CourseDetail'
import { AskPage } from './pages/AskPage'
import { SettingsPage } from './pages/SettingsPage'
import { CourseWizard, type WizardMode } from './components/CourseWizard'
import { AddPicker, type AddKind } from './components/AddMenu'
import { WelcomeModal, shouldWelcome } from './components/WelcomeModal'
import { useRadialMark, RadialMarkOverlay, type MarkColor } from './components/RadialMark'
import { Modal } from './components/Modal'

type NavKey = 'shelf' | 'ask' | 'settings'
type Health = 'checking' | 'ok' | 'down'

const NAV: { key: NavKey; icon: typeof Library; label: string }[] = [
  { key: 'shelf', icon: Library, label: '书架' },
  { key: 'ask', icon: MessagesSquare, label: '问答' },
  { key: 'settings', icon: Settings, label: '设置' },
]

export default function App() {
  const [nav, setNav] = useState<NavKey>('shelf')
  const [health, setHealth] = useState<Health>('checking')
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [openedId, setOpenedId] = useState<string | null>(null)

  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardMode, setWizardMode] = useState<WizardMode>('course')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [renaming, setRenaming] = useState<Course | null>(null)
  const [renameText, setRenameText] = useState('')
  const [deleting, setDeleting] = useState<Course | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // 长按鼠标键 → 三色圆盘 → 给选中的文字打色
  // 第一次打开这件软件，先把能干什么讲清楚
  useEffect(() => {
    if (shouldWelcome()) {
      const t = setTimeout(() => setWelcomeOpen(true), 700)
      return () => clearTimeout(t)
    }
  }, [])

  const radial = useRadialMark((color: MarkColor, text: string) => {
    const cid = openedId
    if (!cid) {
      setToast('先进一门课再标记')
      return
    }
    void api
      .addAnnotation({ courseId: cid, sourceKind: 'note', text, color })
      .then(() => {
        const cn = color === 'yellow' ? '黄' : color === 'white' ? '白' : '蓝'
        setToast(`已标记为${cn}`)
        // 通知当前开着的页面重新拉一遍标记，不然要切页才看得到
        window.dispatchEvent(new CustomEvent('alp:annotations-changed'))
      })
      .catch(() => setToast('标记失败'))
  })

  const refresh = useCallback(async () => {
    try {
      const r = await api.listCourses('all')
      setCourses(r.courses)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let alive = true
    const ping = async () => {
      try {
        const r = await api.health()
        if (alive) setHealth(r.ok ? 'ok' : 'down')
      } catch {
        if (alive) setHealth('down')
      }
    }
    void ping()
    const t = setInterval(ping, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const opened = useMemo(
    () => courses.find((c) => c.id === openedId) ?? null,
    [courses, openedId],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return courses
    return courses.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.goal.toLowerCase().includes(q) ||
        (c.kind === 'skill' ? '技能' : '学业').includes(q),
    )
  }, [courses, query])

  const handleCreate = async (
    input: CreateCourseInput,
    extra: { searchMore: boolean; withKeywords: boolean; mode: WizardMode; materialId?: string | null },
  ) => {
    const r = await api.createCourse({ ...input, options: extra })
    // 第 2 步传的那份资料，建完课就绑到这门课名下
    if (extra.materialId) {
      await api.bindMaterial(extra.materialId, r.course.id).catch(() => {})
    }
    await refresh()
    setToast(extra.mode === 'book' ? '建好了 —— 去「资料」页导入你要学的书' : '课程已创建')
    // 建完直接进去，省一步
    setOpenedId(r.course.id)
  }

  const handleLoadDemo = async () => {
    try {
      const r = await api.loadDemo()
      await refresh()
      setToast(r.skipped ? '示例数据已存在' : `已载入 ${r.courses.length} 门课程、${r.lessons} 个课时`)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '载入失败')
    }
  }

  const handleArchive = async (c: Course) => {
    try {
      await api.updateCourse(c.id, { status: c.status === 'archived' ? 'active' : 'archived' })
      await refresh()
      setToast(c.status === 'archived' ? '已取消归档' : '已归档')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '操作失败')
    }
  }

  const handleRename = async () => {
    if (!renaming || !renameText.trim()) return
    try {
      await api.updateCourse(renaming.id, { title: renameText.trim() })
      setRenaming(null)
      await refresh()
      setToast('已重命名')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '重命名失败')
    }
  }

  const [delMem, setDelMem] = useState<{ materials: number; chunks: number } | null>(null)
  const [purgeMem, setPurgeMem] = useState(true)

  const handleDelete = async () => {
    if (!deleting) return
    try {
      await api.deleteCourse(deleting.id, purgeMem)
      if (openedId === deleting.id) setOpenedId(null)
      setDeleting(null)
      await refresh()
      setToast('课程已删除')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base">
      {/* 左侧导航 */}
      <nav className="flex w-[76px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface/60 py-4">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-accent text-accent-fg">
          <BookOpen size={18} strokeWidth={2.2} />
        </div>
        {NAV.map(({ key, icon: Icon, label }) => {
          const on = key === nav
          return (
            <button
              key={key}
              onClick={() => {
                setNav(key)
                if (key === 'shelf') setOpenedId(null)
              }}
              className={`flex w-[60px] flex-col items-center gap-1 rounded-md py-2.5 transition-colors ${
                on
                  ? 'bg-surface-3 text-accent'
                  : 'text-ink-mute hover:bg-surface-2 hover:text-ink-dim'
              }`}
              title={label}
            >
              <Icon size={18} strokeWidth={1.9} />
              <span className="text-2xs tracking-wide">{label}</span>
            </button>
          )
        })}

        <div className="mt-auto text-center text-[9px] leading-tight text-ink-mute/60">
          ALP
          <br />
          v1.0
        </div>
      </nav>

      {/* 主区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line px-5">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight">Teach me</span>
            <span className="text-2xs text-ink-mute">你的私人教师</span>
          </div>

          <div className="relative ml-4 max-w-sm flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-mute"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索课程…"
              className="h-9 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-ink-mute focus:border-line-strong focus:outline-none"
            />
          </div>

          <div className="ml-auto flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-ink-dim select-none">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  health === 'ok' ? 'bg-ok' : health === 'down' ? 'bg-danger' : 'bg-ink-mute'
                }`}
              />
              <span>
                {health === 'ok' ? '服务正常' : health === 'down' ? '服务未启动' : '连接中'}
              </span>
            </div>
            <button
              onClick={() => setPickerOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              <Plus size={15} strokeWidth={2.4} />
              添加
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1">
          {nav === 'shelf' &&
            (opened ? (
              <CourseDetail course={opened} onBack={() => setOpenedId(null)} />
            ) : (
              <Shelf
                courses={filtered}
                loading={loading}
                onCreate={() => setWizardOpen(true)}
                onOpen={(c) => setOpenedId(c.id)}
                onRename={(c) => {
                  setRenaming(c)
                  setRenameText(c.title)
                }}
                onArchive={handleArchive}
                onDelete={(c) => {
            setDeleting(c)
            setDelMem(null)
            setPurgeMem(true)
            void api
              .courseMemory(c.id)
              .then((r) => setDelMem({ materials: r.materials, chunks: r.chunks }))
              .catch(() => setDelMem({ materials: 0, chunks: 0 }))
          }}
                onLoadDemo={handleLoadDemo}
              />
            ))}

          {nav === 'ask' && <AskPage />}
          {nav === 'settings' && <SettingsPage />}
        </main>
      </div>

      {/* 新建课程向导 */}
      <AddPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(k: AddKind) => {
          setWizardMode(k === 'book' ? 'book' : 'course')
          setWizardOpen(true)
        }}
      />

      <CourseWizard open={wizardOpen} mode={wizardMode} onClose={() => setWizardOpen(false)} onSubmit={handleCreate} />

      {/* 重命名 */}
      <Modal
        open={Boolean(renaming)}
        onClose={() => setRenaming(null)}
        title="重命名课程"
        width={420}
        footer={
          <>
            <button
              onClick={() => setRenaming(null)}
              className="ml-auto h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink-dim hover:bg-surface-2 hover:text-ink"
            >
              取消
            </button>
            <button
              onClick={handleRename}
              disabled={!renameText.trim()}
              className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
            >
              保存
            </button>
          </>
        }
      >
        <input
          autoFocus
          value={renameText}
          onChange={(e) => setRenameText(e.target.value.slice(0, 80))}
          onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none"
        />
      </Modal>

      {/* 删除确认 */}
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="删除课程"
        width={420}
        footer={
          <>
            <button
              onClick={() => setDeleting(null)}
              className="ml-auto h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink-dim hover:bg-surface-2 hover:text-ink"
            >
              取消
            </button>
            <button
              onClick={handleDelete}
              className="h-9 rounded-md bg-danger px-4 text-sm font-medium text-white hover:brightness-110"
            >
              {purgeMem ? '删除' : '删除（保留记忆库）'}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-dim">
          删除 <span className="font-medium text-ink">《{deleting?.title}》</span> 会连同它的课时、
          教学记录、题目一起删掉，不可恢复。
        </p>
        <div className="mt-3 rounded-md border border-line bg-surface-2 px-3 py-2.5">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={purgeMem}
              onChange={(e) => setPurgeMem(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-danger)]"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-ink">同时删除这门课的记忆库</span>
              <span className="mt-0.5 block text-2xs leading-relaxed text-ink-mute">
                {delMem === null
                  ? '正在统计…'
                  : delMem.materials === 0
                    ? '这门课还没有资料进入记忆库'
                    : `有 ${delMem.materials} 份资料、${delMem.chunks} 个分块。` +
                      (purgeMem ? '' : '不勾的话它们会转成全局书库，以后还能被别的课用到。')}
              </span>
            </span>
          </label>
        </div>

        <p className="mt-2 text-2xs text-ink-mute">想留着以后再看，用「归档」而不是删除。</p>
      </Modal>

      <WelcomeModal open={welcomeOpen} onClose={() => setWelcomeOpen(false)} />

      <RadialMarkOverlay
        state={radial.state}
        active={radial.active}
        colors={radial.cfg.colors}
        radius={radial.radius}
      />

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
            onAnimationComplete={() => setTimeout(() => setToast(null), 2200)}
            className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-line-strong bg-surface-3 px-4 py-2 text-xs text-ink shadow-xl"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
