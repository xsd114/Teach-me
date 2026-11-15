import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

type ModalProps = {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  width?: number
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ open, onClose, title, subtitle, width = 560, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <div
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)]"
            style={{ maxWidth: width }}
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            {(title || subtitle) && (
              <header className="flex items-start gap-4 border-b border-line px-5 py-4">
                <div className="min-w-0 flex-1">
                  {title && (
                    <h2 className="truncate text-lg font-semibold tracking-tight text-ink">{title}</h2>
                  )}
                  {subtitle && <p className="mt-0.5 text-xs text-ink-dim">{subtitle}</p>}
                </div>
                <button
                  onClick={onClose}
                  className="-mr-1 rounded-md p-1.5 text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </header>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

            {footer && (
              <footer className="flex items-center gap-2 border-t border-line bg-surface-2/40 px-5 py-3">
                {footer}
              </footer>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
