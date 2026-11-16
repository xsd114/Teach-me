#!/usr/bin/env node
/**
 * ALP 截图工具（CDP，无需 puppeteer/playwright）
 *
 *   node scripts/shot.mjs <url> <out.png> [options]
 *
 *   --w=1440 --h=920        视口
 *   --wait=1200             加载后再等多久（毫秒）
 *   --full                  整页（不只是首屏）
 *   --click=<css>           截图前先点这个元素
 *   --eval=<js>             截图前先执行 JS
 *   --tab=<substring>       复用已有 tab（默认新建一个）
 *   --port=9222
 *
 * 前置：Edge/Chrome 带 --remote-debugging-port=9222 在跑。
 */
import fs from 'node:fs'
import path from 'node:path'

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : def
}
function flag(name) {
  return process.argv.includes(`--${name}`)
}

const url = process.argv[2]
const out = process.argv[3]
if (!url || !out) {
  console.error('用法：node scripts/shot.mjs <url> <out.png> [--w=1440 --h=920 --wait=1200 --full --click=sel --eval=js]')
  process.exit(1)
}

const PORT = arg('port', '9222')
const W = Number(arg('w', '1440'))
const H = Number(arg('h', '920'))
const WAIT = Number(arg('wait', '1200'))
const FULL = flag('full')
const CLICK = arg('click', '')
const EVAL = arg('eval', '')
const TAB = arg('tab', '')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
  const ws = new WebSocket(ver.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('CDP WebSocket 连接失败，浏览器开了 --remote-debugging-port 吗？'))
  })

  let seq = 0
  const pending = new Map()
  const waiters = []

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      return
    }
    if (msg.method) {
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].method === msg.method && waiters[i].sessionId === msg.sessionId) {
          waiters[i].resolve(msg.params)
          waiters.splice(i, 1)
        }
      }
    }
  }

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })

  const waitEvent = (method, sessionId, ms = 20000) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`等待 ${method} 超时`)), ms)
      waiters.push({ method, sessionId, resolve: (p) => { clearTimeout(t); resolve(p) } })
    })

  // 复用已有 tab 或新建
  let targetId
  let sessionId
  let created = false

  if (TAB) {
    const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    const hit = tabs.find((t) => t.type === 'page' && (t.url.includes(TAB) || t.title.includes(TAB)))
    if (!hit) throw new Error(`找不到包含 "${TAB}" 的 tab`)
    targetId = hit.id
  } else {
    const r = await send('Target.createTarget', { url: 'about:blank' })
    targetId = r.targetId
    created = true
  }

  const att = await send('Target.attachToTarget', { targetId, flatten: true })
  sessionId = att.sessionId

  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: W, height: H, deviceScaleFactor: 1, mobile: false },
    sessionId,
  )

  const loaded = waitEvent('Page.loadEventFired', sessionId)
  await send('Page.navigate', { url }, sessionId)
  await loaded.catch(() => {})
  await sleep(WAIT)

  if (CLICK) {
    const sel = JSON.stringify(CLICK)
    const r = await send(
      'Runtime.evaluate',
      {
        expression: `(() => { const el = document.querySelector(${sel}); if (!el) return 'NOT_FOUND'; el.click(); return 'OK'; })()`,
        returnByValue: true,
      },
      sessionId,
    )
    const v = r?.result?.value
    if (v !== 'OK') throw new Error(`点击失败：${sel} → ${v}`)
    await sleep(500)
  }

  if (EVAL) {
    const r = await send('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true }, sessionId)
    // 把 eval 的返回值打出来：脚本没跑到想去的页面时，一眼能看出卡在哪一步
    if (r?.exceptionDetails) {
      console.error('EVAL 抛错：', r.exceptionDetails.text, r.exceptionDetails.exception?.description ?? '')
    } else if (r?.result?.value !== undefined) {
      console.log(`EVAL → ${JSON.stringify(r.result.value)}`)
    }
    await sleep(400)
  }

  const shot = await send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: FULL, fromSurface: true },
    sessionId,
  )

  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(`OK ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${W}x${H}${FULL ? ' full' : ''})`)

  if (created) {
    await send('Target.closeTarget', { targetId }).catch(() => {})
  }
  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
