export type AddKind = 'book' | 'course'

import { BookOpen, Target, Sparkles } from 'lucide-react'
import { Modal } from './Modal'

/**
 * 「添加」点开是一个居中的小弹窗，不是下拉。
 * 先问「我想…」，再落到两个入口。
 */
export function AddPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (kind: AddKind) => void
}) {
  const pick = (k: AddKind) => {
    onClose()
    onPick(k)
  }

  return (
    <Modal open={open} onClose={onClose} title="添加" subtitle="我想…" width={480}>
      <div className="space-y-2">
        <button
          onClick={() => pick('course')}
          className="flex w-full items-start gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3.5 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/40"
        >
          <BookOpen size={18} className="mt-0.5 shrink-0 text-accent" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">看书</span>
            <span className="mt-0.5 block text-2xs leading-relaxed text-ink-mute">
              定一门课，我先给你写一本专属教材，再带你读
            </span>
          </span>
        </button>

        <button
          onClick={() => pick('book')}
          className="flex w-full items-start gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3.5 text-left transition-colors hover:border-info/50 hover:bg-info/[0.06]"
        >
          <Target size={18} className="mt-0.5 shrink-0 text-info" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">学习</span>
            <span className="mt-0.5 block text-2xs leading-relaxed text-ink-mute">
              我手上有本书（PDF/资料），按它原来的章节来教我
            </span>
          </span>
        </button>

        <div className="flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2">
          <Sparkles size={12} className="mt-0.5 shrink-0 text-ink-mute" />
          <p className="text-[10px] leading-relaxed text-ink-mute">
            两个的区别：<b className="text-ink-dim">看书</b>我会照你的水平写一本新的；
            <b className="text-ink-dim">学习</b>我一个字都不改，只把你那本书按原结构拆成章节。
          </p>
        </div>
      </div>
    </Modal>
  )
}
