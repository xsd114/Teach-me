/**
 * 触发一次文件下载。
 *
 * Electron 和浏览器都认 a[download]；不用 IPC 是因为打包版跑的就是标准 Chromium，
 * 下载落到系统「下载」目录，用户自己会去找。
 */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
