import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, BookX, Database, Loader2 } from 'lucide-react'
import { MiniMarkdown } from './MiniMarkdown'
import { Figure, type FigureSpec } from './Figures'

/**
 * 一条问答卡片。
 *
 * 两个动作的反馈：
 *   加入错题本 → 卡片闪一下（像快门）
 *   存入记忆库 → 边框跑彩虹呼吸灯，直到真的存完
 *
 * 文字模式和语音模式共用这一个，行为完全一致。
 */

export type AnswerTurn = {
  id: string
  q: string
  a?: string
  label?: string
  figures?: unknown[]
  savedToMistakes?: boolean
  savedToMemory?: boolean
  saving?: 'mistake' | 'memory' | null
}

export function AnswerCard({
  turn,
  onMistake,
  onMemory,
}: {
  turn: AnswerTurn
  onMistake: () => void
  onMemory: () => void
}) {
  const [flash, setFlash] = useState(false)

  // 存进错题本 → 闪一下
  useEffect(() => {
    if (turn.savedToMistakes) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 620)
      return () => clearTimeout(t)
    }
  }, [turn.savedToMistakes])

  const breathing = turn.saving === 'memory'

  return (
    <motion.div
      animate={
        flash
          ? {
              backgroundColor: [
                'rgba(231,183,95,0)',
                'rgba(231,183,95,0.22)',
                'rgba(255,255,255,0.10)',
                'rgba(231,183,95,0)',
              ],
              scale: [1, 1.006, 1],
            }
          : { backgroundColor: 'rgba(0,0,0,0)' }
      }
      transition={{ duration: 0.6, times: [0, 0.18, 0.42, 1] }}
      className={`relative rounded-xl border bg-surface-2 px-4 py-3 ${
        breathing ? 'border-transparent' : 'border-line'
      }`}
    >
      {/* 彩虹呼吸灯：存记忆库期间一直转 */}
      <AnimatePresence>
        {breathing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.45, 1, 0.45] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity }}
            className="pointer-events-none absolute -inset-px rounded-xl"
            style={{
              background:
                'conic-gradient(from 0deg, #ff6b6b, #ffd93d, #6bcf7f, #4ecdc4, #5b8def, #c77dff, #ff6b6b)',
              padding: 1.5,
              WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
            }}
          />
        )}
      </AnimatePresence>

      <div className="mb-1 text-2xs text-ink-mute">
        {turn.label && <span className="mr-1.5 text-accent">{turn.label}</span>}
        {turn.q}
      </div>

      {turn.a ? (
        <>
          <div className="text-[13.5px]">
            <MiniMarkdown text={turn.a} />
          </div>
          {Array.isArray(turn.figures) && turn.figures.length > 0 && (
            <div className="mt-2">
              {(turn.figures as FigureSpec[]).map((f, i) => (
                <Figure key={i} spec={f} />
              ))}
            </div>
          )}

          {/* 右下角两个按钮 */}
          <div className="mt-2.5 flex items-center justify-end gap-1.5">
            <button
              onClick={onMistake}
              disabled={turn.savedToMistakes || Boolean(turn.saving)}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors ${
                turn.savedToMistakes
                  ? 'border-ok/40 bg-ok/10 text-ok'
                  : 'border-line text-ink-mute hover:border-line-strong hover:text-ink'
              }`}
            >
              {turn.savedToMistakes ? <Check size={9} /> : <BookX size={9} />}
              {turn.savedToMistakes ? '已进错题本' : '加入错题本'}
            </button>
            <button
              onClick={onMemory}
              disabled={turn.savedToMemory || Boolean(turn.saving)}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors ${
                turn.savedToMemory
                  ? 'border-info/40 bg-info/10 text-info'
                  : 'border-line text-ink-mute hover:border-line-strong hover:text-ink'
              }`}
            >
              {turn.savedToMemory ? <Check size={9} /> : <Database size={9} />}
              {turn.savedToMemory ? '已存记忆库' : '存入记忆库'}
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-1.5 text-2xs text-ink-mute">
          <Loader2 size={10} className="animate-spin" />
          查教材…
        </div>
      )}
    </motion.div>
  )
}
