import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal, Pencil, Archive, Trash2, ArrowRight } from 'lucide-react'
import type { Course } from '../lib/types'
import { KIND_META, relTime, daysUntil } from '../lib/api'
import { Ring } from './Ring'

type Props = {
  course: Course
  onOpen: (c: Course) => void
  onRename: (c: Course) => void
  onArchive: (c: Course) => void
  onDelete: (c: Course) => void
}

const COVER_TINT: Record<string, string> = {
  skill: 'from-[#2a2317] via-[#1d1a14] to-surface',
  academic: 'from-[#17202b] via-[#151a20] to-surface',
}

export function CourseCard({ course, onOpen, onRename, onArchive, onDelete }: Props) {
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const pct = course.stats.lessonTotal > 0 ? course.stats.lessonDone / course.stats.lessonTotal : 0
  const glyph = course.cover || course.title.slice(0, 1)
  const left = daysUntil(course.deadline)

  return (
    <article
      onClick={() => onOpen(course)}
      className="card card-hover group relative flex h-full cursor-pointer flex-col overflow-hidden"
    >
      {/* 封面 */}
      <div
        className={`relative h-[92px] bg-gradient-to-br ${COVER_TINT[course.kind]} px-4 py-3`}
      >
        <div className="flex h-full items-start justify-between">
          <span className="select-none text-[40px] leading-none font-semibold text-white/[0.13]">
            {glyph}
          </span>
          <Ring
            value={pct}
            size={38}
            label={`${Math.round(pct * 100)}`}
          />
        </div>
        <span className="absolute bottom-2.5 left-4 rounded-sm bg-black/35 px-1.5 py-0.5 text-2xs text-ink-dim">
          {KIND_META[course.kind].label}
        </span>
      </div>

      {/* 主体 */}
      <div className="flex flex-1 flex-col gap-1.5 px-4 py-3">
        <h3 className="truncate text-[15px] font-medium tracking-tight text-ink" title={course.title}>
          {course.title}
        </h3>
        <p className="line-clamp-2 min-h-[2.4em] text-xs leading-relaxed text-ink-dim">
          {course.goal || '还没写目标'}
        </p>

        <div className="mt-auto flex items-center gap-2 pt-2 text-2xs text-ink-mute">
          <span className="tabular-nums">
            {course.stats.lessonTotal} 节 · 完成 {course.stats.lessonDone}
          </span>
          <span className="text-line-strong">·</span>
          <span>{relTime(course.stats.lastStudiedAt)}</span>
          {left !== null && (
            <>
              <span className="text-line-strong">·</span>
              <span className={left <= 7 ? 'text-warn' : ''}>
                {left >= 0 ? `剩 ${left} 天` : `逾期 ${-left} 天`}
              </span>
            </>
          )}
          <ArrowRight
            size={13}
            className="ml-auto -translate-x-1 text-ink-mute opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
          />
        </div>
      </div>

      {/* 操作菜单 */}
      <div ref={menuRef} className="absolute top-2 right-2">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setMenu((v) => !v)
          }}
          className={`rounded-md bg-black/30 p-1.5 text-ink-dim transition-opacity backdrop-blur group-hover:opacity-100 hover:bg-black/50 hover:text-ink ${
            menu ? 'opacity-100' : 'opacity-0'
          }`}
          aria-label="课程操作"
        >
          <MoreHorizontal size={15} />
        </button>

        {menu && (
          <div
            className="absolute right-0 z-10 mt-1 w-36 overflow-hidden rounded-md border border-line bg-surface-3 py-1 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <MenuItem icon={<Pencil size={13} />} onClick={() => { setMenu(false); onRename(course) }}>
              重命名
            </MenuItem>
            <MenuItem icon={<Archive size={13} />} onClick={() => { setMenu(false); onArchive(course) }}>
              归档
            </MenuItem>
            <MenuItem
              icon={<Trash2 size={13} />}
              danger
              onClick={() => { setMenu(false); onDelete(course) }}
            >
              删除
            </MenuItem>
          </div>
        )}
      </div>
    </article>
  )
}

function MenuItem({
  children,
  icon,
  onClick,
  danger,
}: {
  children: ReactNode
  icon: ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-2 ${
        danger ? 'text-danger' : 'text-ink-dim hover:text-ink'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}
