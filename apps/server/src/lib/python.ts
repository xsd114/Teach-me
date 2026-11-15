import { execFile } from 'node:child_process'

export type PyRunResult = { ok: boolean; stdout: string; stderr: string; ms: number }

export const PYTHON_BIN = process.env.ALP_PYTHON || 'python'

/**
 * 调 Python 的统一入口。
 *
 * 关键点：**必须注入 PYTHONIOENCODING=utf-8 / PYTHONUTF8=1**。
 * Windows 上 python 默认按 CP936 输出，中文会变成乱码，
 * 而且不报错——这是最坑的一类静默失败（实测踩过）。
 */
export function runPython(
  args: string[],
  opts: { timeoutMs?: number; maxBuffer?: number; cwd?: string } = {},
): Promise<PyRunResult> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    execFile(
      PYTHON_BIN,
      args,
      {
        encoding: 'buffer',
        maxBuffer: opts.maxBuffer ?? 128 * 1024 * 1024,
        timeout: opts.timeoutMs ?? 180_000,
        windowsHide: true,
        cwd: opts.cwd,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          PYTHONUNBUFFERED: '1',
        },
      },
      (err, stdoutBuf, stderrBuf) => {
        const out = Buffer.isBuffer(stdoutBuf) ? stdoutBuf.toString('utf8') : String(stdoutBuf ?? '')
        const errText = Buffer.isBuffer(stderrBuf) ? stderrBuf.toString('utf8') : String(stderrBuf ?? '')
        resolve({
          ok: !err,
          stdout: out,
          stderr: err ? errText || String((err as Error).message) : errText,
          ms: Date.now() - t0,
        })
      },
    )
  })
}

type Probe = { python: boolean; markitdown: boolean; version?: string; checkedAt: number }

let probeCache: Probe | null = null

/** 探测 python 与 markitdown 是否可用（缓存 5 分钟，避免每次导入都探） */
export async function probePython(force = false): Promise<Probe> {
  if (!force && probeCache && Date.now() - probeCache.checkedAt < 5 * 60_000) return probeCache

  const py = await runPython(['-c', 'import sys; print(sys.version.split()[0])'], { timeoutMs: 15_000 })
  if (!py.ok) {
    probeCache = { python: false, markitdown: false, checkedAt: Date.now() }
    return probeCache
  }
  const md = await runPython(['-c', 'import markitdown; print("ok")'], { timeoutMs: 25_000 })
  probeCache = {
    python: true,
    markitdown: md.ok,
    version: py.stdout.trim(),
    checkedAt: Date.now(),
  }
  return probeCache
}
