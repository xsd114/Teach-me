import { Quote, X, ImageIcon } from 'lucide-react'
import type { ChatImage } from '../lib/api'
import { anchorLabel, type TextAnchor } from '../lib/anchor'

/**
 * 对话框上方的两样东西：引用气泡 + 待发送的图片。
 *
 * 引用气泡做成 QQ 那样：左边一道竖线，上面一行小字（第2章 · A2-3），
 * 下面两行原文，右上角一个叉。位置坐标（字符偏移、前后文）**不显示**，
 * 它藏在 anchor 里，发请求时随消息一起给模型。
 */

export function QuoteChip({
  anchor,
  onClear,
  tone = 'accent',
}: {
  anchor: TextAnchor | null
  onClear?: () => void
  tone?: 'accent' | 'info'
}) {
  if (!anchor?.quote) return null
  const label = anchorLabel(anchor)
  return (
    <div className="mb-2 overflow-hidden rounded-md border border-line bg-surface-2/70">
      <div className="flex items-stretch gap-2 py-1.5 pr-1.5 pl-2.5">
        <span className={`w-0.5 shrink-0 rounded-full ${tone === 'info' ? 'bg-info/70' : 'bg-accent/70'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[10px] text-ink-mute">
            <Quote size={8} />
            {label || '引用'}
          </div>
          <div className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-ink-dim">「{anchor.quote}」</div>
        </div>
        {onClear && (
          <button
            onClick={onClear}
            title="取消引用"
            className="mt-0.5 shrink-0 self-start rounded p-0.5 text-ink-mute hover:bg-surface-3 hover:text-ink"
          >
            <X size={11} />
          </button>
        )}
      </div>
    </div>
  )
}

/** 已贴上来、还没发的图：一排小方图，像 ChatGPT 那样浮在输入框上面 */
export function ImageTray({
  images,
  onRemove,
}: {
  images: ChatImage[]
  onRemove?: (id: string) => void
}) {
  if (!images.length) return null
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {images.map((im) => (
        <div key={im.id} className="group relative">
          <img
            src={im.dataUrl}
            alt={im.name}
            className="h-14 w-14 rounded-md border border-line object-cover"
          />
          {onRemove && (
            <button
              onClick={() => onRemove(im.id)}
              title="移除这张图"
              className="absolute -top-1.5 -right-1.5 rounded-full border border-line-strong bg-surface-3 p-0.5 text-ink-mute opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
            >
              <X size={9} />
            </button>
          )}
        </div>
      ))}
      <span className="flex items-center gap-1 text-[10px] text-ink-mute">
        <ImageIcon size={9} />
        {images.length} 张图 · 发送时一起带上
      </span>
    </div>
  )
}

/* ── 粘贴 / 拖文件 ── */

/** 从剪贴板事件里挑出图片文件 */
export function imagesFromPaste(e: ClipboardEvent | React.ClipboardEvent): File[] {
  const dt = 'clipboardData' in e ? e.clipboardData : null
  if (!dt) return []
  const out: File[] = []
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) out.push(f)
    }
  }
  if (out.length) return out
  return Array.from(dt.files ?? []).filter((f) => f.type.startsWith('image/'))
}

export function imagesFromFiles(list: FileList | File[] | null): File[] {
  if (!list) return []
  return Array.from(list).filter((f) => f.type.startsWith('image/'))
}

let seq = 0

/** 读成 dataURL（顺便记下像素尺寸，模型读不了图时也能知道大概多大） */
export function readImage(file: File): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读不出这张图'))
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      const img = new Image()
      img.onload = () =>
        resolve({
          id: `img${Date.now()}${seq++}`,
          name: file.name || '粘贴的图片',
          dataUrl,
          w: img.naturalWidth,
          h: img.naturalHeight,
        })
      img.onerror = () => resolve({ id: `img${Date.now()}${seq++}`, name: file.name || '粘贴的图片', dataUrl })
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

/**
 * 图只能留在对话里（当前模型读不了图），所以给模型一句"有图"的说明，
 * 让它知道用户手上有一张图、该请用户描述哪里不懂。
 */
export function describeImages(images: ChatImage[]): string {
  if (!images.length) return ''
  const one = images
    .map((im) => `${im.name}${im.w && im.h ? `（${im.w}×${im.h}）` : ''}`)
    .join('、')
  return `\n\n【用户附了图】${one}。你看不到图，回答时请让他描述图里卡住的地方。`
}
