import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Sparkles, BookOpen, Archive, Layers } from 'lucide-react'
import type { Course, CourseKind } from '../lib/types'
import { CourseCard } from '../components/CourseCard'

type Filter = 'all' | CourseKind

export function Shelf({
  courses,
  loading,
  onCreate,
  onOpen,
  onRename,
  onArchive,
  onDelete,
  onLoadDemo,
}: {
  courses: Course[]
  loading: boolean
  onCreate: () => void
  onOpen: (c: Course) => void
  onRename: (c: Course) => void
  onArchive: (c: Course) => void
  onDelete: (c: Course) => void
  onLoadDemo: () => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [showArchived, setShowArchived] = useState(false)

  const visible = useMemo(() => {
    return courses.filter((c) => {
      if (!showArchived && c.status === 'archived') return false
      if (showArchived && c.status !== 'archived') return false
      if (filter !== 'all' && c.kind !== filter) return false
      return true
    })
  }, [courses, filter, showArchived])

  const activeCount = courses.filter((c) => c.status === 'active').length
  const archivedCount = courses.filter((c) => c.status === 'archived').length

  const filters: { k: Filter; label: string; n: number }[] = [
    { k: 'all', label: '全部', n: courses.filter((c) => c.status === 'active').length },
    { k: 'skill', label: '技能', n: courses.filter((c) => c.status === 'active' && c.kind === 'skill').length },
    {
      k: 'academic',
      label: '学业',
      n: courses.filter((c) => c.status === 'active' && c.kind === 'academic').length,
    },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-3.5">
        <h1 className="text-[17px] font-semibold tracking-tight">书架</h1>
        <span className="text-2xs text-ink-mute tabular-nums">{activeCount} 门在学</span>

        <div className="ml-4 flex items-center gap-1 rounded-md bg-surface-2 p-0.5">
          {filters.map(({ k, label, n }) => (
            <button
              key={k}
              onClick={() => {
                setFilter(k)
                setShowArchived(false)
              }}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                filter === k && !showArchived
                  ? 'bg-surface-3 text-ink'
                  : 'text-ink-mute hover:text-ink-dim'
              }`}
            >
              {label}
              <span className="tabular-nums opacity-60">{n}</span>
            </button>
          ))}
        </div>

        {archivedCount > 0 && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
              showArchived ? 'bg-surface-3 text-ink' : 'text-ink-mute hover:text-ink-dim'
            }`}
          >
            <Archive size={13} />
            归档
            <span className="tabular-nums opacity-60">{archivedCount}</span>
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {activeCount === 0 && !loading && (
            <button
              onClick={onLoadDemo}
              className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink"
            >
              <Sparkles size={13} strokeWidth={1.9} />
              载入示例
            </button>
          )}
        </div>
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card h-[220px] animate-pulse bg-surface-2/50" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            archived={showArchived}
            filtered={filter !== 'all'}
            onLoadDemo={onLoadDemo}
            onCreate={onCreate}
          />
        ) : (
          <motion.div
            layout
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {visible.map((c) => (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                className="h-full"
              >
                <CourseCard
                  course={c}
                  onOpen={onOpen}
                  onRename={onRename}
                  onArchive={onArchive}
                  onDelete={onDelete}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  )
}

function EmptyState({
  archived,
  filtered,
  onCreate,
  onLoadDemo,
}: {
  archived: boolean
  filtered: boolean
  onCreate: () => void
  onLoadDemo: () => void
}) {
  if (archived) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-sm text-ink-mute">
        还没有归档的课程
      </div>
    )
  }
  if (filtered) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-ink-mute">
        <Layers size={22} strokeWidth={1.5} />
        <span>这个分类下还没有课程</span>
      </div>
    )
  }

  return (
    <div className="grid-bg flex h-full flex-col items-center justify-center px-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center"
      >
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-xl border border-line bg-surface">
          <BookOpen size={32} strokeWidth={1.4} className="text-ink-mute" />
        </div>

        <h2 className="mb-2 text-xl font-semibold tracking-tight">书架还是空的</h2>
        <p className="prose-narrow mb-7 text-sm text-ink-dim">
          一门课就是一本书。告诉 ALP 你想学什么——是学业里的某一科，还是想拿下的某项技能——
          它会先给你排一份大纲，再一节一节带着你走。
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={onCreate}
            className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            <Plus size={16} strokeWidth={2.4} />
            新建第一门课程
          </button>
          <button
            onClick={onLoadDemo}
            className="flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink"
          >
            <Sparkles size={16} strokeWidth={1.9} />
            载入示例（粤菜 12 道）
          </button>
        </div>
      </motion.div>
    </div>
  )
}
