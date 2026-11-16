import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Download, FolderOpen, RotateCcw } from 'lucide-react'
import { diagnosticsApi } from '../lib/api'
import { downloadText } from '../lib/download'
import { reportClientError } from '../lib/errorReport'

/**
 * 白屏兜底。
 *
 * React 渲染期抛错会把整棵树卸掉，用户眼前就剩一片黑 —— 那时候连「设置」都点不到，
 * 也就没法导日志。所以这里兜住，并且**就地**给出两个按钮：生成日志、打开日志目录。
 */
type State = { error: Error | null; detail: string; busy: boolean; saved: string | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, detail: '', busy: false, saved: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ detail: info.componentStack ?? '' })
    reportClientError('react.render', error)
  }

  private exportLogs = async () => {
    this.setState({ busy: true })
    try {
      const r = await diagnosticsApi.bundle()
      downloadText(r.filename, r.text)
      this.setState({ saved: r.filePath })
    } catch (e) {
      this.setState({ saved: `生成失败：${e instanceof Error ? e.message : '未知错误'}` })
    } finally {
      this.setState({ busy: false })
    }
  }

  private openFolder = () => {
    void diagnosticsApi.openFolder().catch(() => {})
  }

  render(): ReactNode {
    const { error, detail, busy, saved } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-base px-6">
        <div className="w-full max-w-xl rounded-xl border border-line bg-surface p-6 shadow-2xl">
          <div className="flex items-center gap-2 text-danger">
            <AlertTriangle size={18} />
            <span className="text-base font-semibold">界面出错了</span>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-ink-dim">
            这一步崩了，但软件没死。<span className="font-medium text-ink">先把日志导出来</span>
            发给我，比截图有用得多 —— 里面带着版本、数据库状态、最近的报错栈，我照着就能定位。
          </p>

          <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-dim">
            {String(error?.stack || error?.message || error)}
          </pre>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void this.exportLogs()}
              disabled={busy}
              className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
            >
              <Download size={14} />
              {busy ? '正在生成…' : '生成并导出日志'}
            </button>
            <button
              onClick={this.openFolder}
              className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-3 text-sm text-ink-dim hover:bg-surface-3 hover:text-ink"
            >
              <FolderOpen size={14} />
              打开日志目录
            </button>
            <button
              onClick={() => this.setState({ error: null, detail: '' })}
              className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm text-ink-dim hover:bg-surface-2 hover:text-ink"
            >
              <RotateCcw size={14} />
              再试一次
            </button>
          </div>

          {saved && (
            <p className="mt-3 rounded-md border border-ok/30 bg-ok/10 px-3 py-2 text-2xs break-all text-ok">
              已保存：{saved}
            </p>
          )}

          {detail && (
            <details className="mt-3">
              <summary className="cursor-pointer text-2xs text-ink-mute hover:text-ink-dim">
                组件栈（点开）
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-ink-mute">
                {detail}
              </pre>
            </details>
          )}
        </div>
      </div>
    )
  }
}
