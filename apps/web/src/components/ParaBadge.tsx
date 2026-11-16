/**
 * 教材里每段右上角那个编号气泡（A2-3）。
 *
 * 点一下复制编号 —— 自习问答里直接粘进去就能定位到这一段。
 * 它是文本定位锚的"人能看见的那一半"：编号、章节、字符偏移三者对得上，
 * 模型才知道 A2-3 到底是哪几十个字。
 */
export function ParaBadge({ label }: { label: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard?.writeText(label)
      }}
      title="点一下复制编号（自习问答里能用它定位）"
      className="absolute -top-1 right-0 rounded px-1 font-mono text-[10px] text-ink-mute/45 transition-colors select-none hover:text-accent"
    >
      {label}
    </button>
  )
}
