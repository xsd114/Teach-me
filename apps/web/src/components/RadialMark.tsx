import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 长按鼠标键弹出三色圆盘，滑到某个颜色上松开就给选中的文字打上那个颜色。
 *
 * 默认中键，但如果鼠标没中键（很多无线鼠标按下去是滚轮），
 * 可以在设置里改成右键或者侧键。右键会临时吃掉上下文菜单。
 */

export type MarkColor = 'yellow' | 'white' | 'blue'

export type RadialConfig = {
  /** 配置版本。旧版（没有这个字段）默认是中键，迁移时改成右键 */
  v: number
  /** 0 = 不启用；1 = 中键；2 = 右键；3 = 侧键后；4 = 侧键前 */
  button: number
  /** 长按多少毫秒才弹出来 */
  holdMs: number
  colors: MarkColor[]
}

const KEY = 'alp.radial'

export const RADIAL_DEFAULT: RadialConfig = {
  v: 2,
  button: 2,
  holdMs: 320,
  colors: ['yellow', 'white', 'blue'],
}

export function loadRadialConfig(): RadialConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<RadialConfig>
      // 老版本存的 button=1（中键）是当时的默认值，不是用户选的。
      // 升级到 v2 时换成右键——很多人鼠标按不出中键。
      if (!saved.v) {
        return { ...RADIAL_DEFAULT, ...saved, v: 2, button: saved.button === 1 ? 2 : (saved.button ?? 2) }
      }
      return { ...RADIAL_DEFAULT, ...saved }
    }
  } catch {
    /* ignore */
  }
  return { ...RADIAL_DEFAULT }
}

export function saveRadialConfig(c: RadialConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* ignore */
  }
}

export const COLOR_META: Record<MarkColor, { label: string; hex: string; ring: string }> = {
  yellow: { label: '黄', hex: '#fbbf24', ring: 'rgba(251,191,36,.45)' },
  white: { label: '白', hex: '#e2e8f0', ring: 'rgba(226,232,240,.45)' },
  blue: { label: '天蓝', hex: '#38bdf8', ring: 'rgba(56,189,248,.45)' },
}

type RadialState = {
  x: number
  y: number
  /** 当前鼠标相对中心的偏移，用来算高亮 */
  dx: number
  dy: number
  text: string
} | null

const RADIUS = 78

/** 三个颜色在圆周上的角度（-90 是正上方） */
function angleOf(i: number, n: number): number {
  return -90 + (360 / n) * i
}

export function useRadialMark(onPick: (color: MarkColor, text: string) => void) {
  const [state, setState] = useState<RadialState>(null)
  const cfg = useRef<RadialConfig>(loadRadialConfig())
  const timer = useRef<number | null>(null)
  const armed = useRef(false)
  const textRef = useRef('')
  /** 最近一次有效的选区。右键按下去会清掉现有选区，所以要在 selectionchange 时就记住 */
  const lastSel = useRef('')
  const originRef = useRef({ x: 0, y: 0 })

  const clear = useCallback(() => {
    if (timer.current) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    armed.current = false
    setState(null)
  }, [])

  /** 鼠标在圆周上指向第几个色块 */
  const hitTest = useCallback((dx: number, dy: number): number | null => {
    const dist = Math.hypot(dx, dy)
    if (dist < RADIUS * 0.35) return null // 太近就算没选
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI
    if (ang < -90) ang += 360
    const n = cfg.current.colors.length
    let best = 0
    let bestDiff = 999
    for (let i = 0; i < n; i++) {
      const a = angleOf(i, n)
      let diff = Math.abs(ang - a)
      if (diff > 180) diff = 360 - diff
      if (diff < bestDiff) {
        bestDiff = diff
        best = i
      }
    }
    return bestDiff < 70 ? best : null
  }, [])

  // 一直记着"用户最后选中的是什么"
  useEffect(() => {
    const onSel = () => {
      const s = window.getSelection()
      const text = s?.toString().trim() ?? ''
      if (text.length >= 2) lastSel.current = text
    }
    document.addEventListener('selectionchange', onSel)
    onSel()
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const c = cfg.current
      if (!c.button || c.button !== e.button) return

      // 右键按下浏览器默认会清掉选区，先按住它
      if (e.button === 2) e.preventDefault()

      const now = window.getSelection()?.toString().trim() ?? ''
      const text = now.length >= 2 ? now : lastSel.current
      if (!text || text.length < 2) return

      textRef.current = text
      originRef.current = { x: e.clientX, y: e.clientY }
      armed.current = false

      timer.current = window.setTimeout(() => {
        armed.current = true
        setState({ x: e.clientX, y: e.clientY, dx: 0, dy: 0, text })
        if (c.button === 2) e.preventDefault()
      }, c.holdMs)
    }

    const onMove = (e: MouseEvent) => {
      if (!armed.current) return
      setState((s) =>
        s ? { ...s, dx: e.clientX - originRef.current.x, dy: e.clientY - originRef.current.y } : s,
      )
    }

    const onUp = (e: MouseEvent) => {
      if (timer.current) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
      if (!armed.current) return

      const c = cfg.current
      const dx = e.clientX - originRef.current.x
      const dy = e.clientY - originRef.current.y
      const idx = hitTest(dx, dy)
      armed.current = false
      setState(null)

      if (idx !== null) {
        const color = c.colors[idx]
        lastSel.current = ''
        // 清掉选区，避免圆盘消失后文字还蓝着
        window.getSelection()?.removeAllRanges()
        onPick(color, textRef.current)
      }
      if (c.button === 2) e.preventDefault()
    }

    const onCtx = (e: MouseEvent) => {
      // 右键模式下必须全程拦掉菜单，否则长按到一半菜单弹出来盖住圆盘
      if (cfg.current.button === 2) e.preventDefault()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && armed.current) clear()
    }

    window.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('contextmenu', onCtx)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('contextmenu', onCtx)
      window.removeEventListener('keydown', onKey)
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [clear, hitTest, onPick])

  const active = state ? hitTest(state.dx, state.dy) : null
  return { state, active, cfg: cfg.current, radius: RADIUS, angleOf }
}

export function RadialMarkOverlay({
  state,
  active,
  colors,
  radius,
}: {
  state: RadialState
  active: number | null
  colors: MarkColor[]
  radius: number
}) {
  if (!state) return null
  const n = colors.length

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9999]"
      style={{ backdropFilter: 'blur(1px)', background: 'rgba(0,0,0,0.18)' }}
    >
      {/* 选中文字的提示 */}
      <div
        className="pointer-events-none absolute max-w-[280px] truncate rounded-md border border-line bg-surface/95 px-2 py-1 text-[10px] text-ink-dim"
        style={{ left: state.x - 20, top: state.y + radius + 26 }}
      >
        {state.text.slice(0, 40)}
      </div>

      {/* 中心点 */}
      <div
        className="pointer-events-none absolute rounded-full bg-ink/50"
        style={{ left: state.x - 3, top: state.y - 3, width: 6, height: 6 }}
      />

      {colors.map((c, i) => {
        const a = (angleOf(i, n) * Math.PI) / 180
        const cx = state.x + Math.cos(a) * radius
        const cy = state.y + Math.sin(a) * radius
        const on = active === i
        const meta = COLOR_META[c]
        return (
          <div
            key={c + i}
            className="pointer-events-none absolute flex items-center justify-center rounded-full border-2 transition-all duration-150"
            style={{
              left: cx - 26,
              top: cy - 26,
              width: 52,
              height: 52,
              background: on ? meta.hex : 'rgba(20,22,26,.92)',
              borderColor: on ? meta.hex : meta.ring,
              boxShadow: on ? `0 0 22px ${meta.hex}` : 'none',
              transform: on ? 'scale(1.18)' : 'scale(1)',
            }}
          >
            <span
              className="text-[13px] font-semibold"
              style={{ color: on ? '#101114' : meta.hex }}
            >
              {meta.label}
            </span>
          </div>
        )
      })}

      {/* 连线 */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        {colors.map((_, i) => {
          const a = (angleOf(i, n) * Math.PI) / 180
          return (
            <line
              key={i}
              x1={state.x}
              y1={state.y}
              x2={state.x + Math.cos(a) * radius}
              y2={state.y + Math.sin(a) * radius}
              stroke={active === i ? COLOR_META[colors[i]].hex : 'rgba(255,255,255,.12)'}
              strokeWidth={active === i ? 2 : 1}
              strokeDasharray={active === i ? '0' : '3 4'}
            />
          )
        })}
      </svg>
    </div>
  )
}
