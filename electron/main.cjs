/**
 * Electron 主进程。
 *
 * 结构：
 *   - 打包后：fork `dist/server.cjs`（esbuild 打好的单文件后端）→ 等健康检查 →
 *     打开 http://127.0.0.1:5274（后端同时托管 web/dist 静态文件）
 *   - 开发时：直接打开 vite 的 5273，自己另跑 server
 *
 * 这样做的好处：前端不用改任何代码，浏览器里怎么跑，Electron 里就怎么跑。
 */
const { app, BrowserWindow, shell, Menu, Tray, nativeImage, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { fork } = require('node:child_process')

const isDev = !app.isPackaged
const API_PORT = Number(process.env.ALP_PORT || 5274)
const DEV_WEB_URL = 'http://127.0.0.1:5273'
const PROD_URL = `http://127.0.0.1:${API_PORT}`

/** 用户数据目录：跟后端保持同一套逻辑（优先非系统盘） */
function pickHome() {
  if (process.env.ALP_HOME) return path.resolve(process.env.ALP_HOME)
  if (process.platform === 'win32') {
    for (const letter of ['E', 'D', 'F', 'G']) {
      const root = `${letter}:\\`
      try {
        if (!fs.existsSync(root)) continue
        fs.mkdirSync(path.join(root, 'ALP-data'), { recursive: true })
        return path.join(root, 'ALP-data')
      } catch {
        /* skip */
      }
    }
  }
  return path.join(app.getPath('appData'), 'ALP')
}

const ALP_HOME = pickHome()

/**
 * 主进程自己的日志。
 *
 * 打包后的 Electron 没有控制台窗口，console.log 全扔了 —— 出了事（后端起不来、
 * 页面白屏）用户和我们都是两眼一抹黑。这里直接 append 到 ALP_HOME/logs/app-*.log，
 * 和服务端那份日志放在一起，「设置 → 关于 → 生成日志」会一并打包出去。
 */
function appLog(line, level = 'info') {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const stamp = `[${day} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}] ${String(level).toUpperCase()}`
  try {
    const dir = path.join(ALP_HOME, 'logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, `app-${day}.log`), `${stamp} ${line}\n`, 'utf8')
  } catch {
    /* 磁盘写不进去也不能把启动搞挂 */
  }
  if (isDev) console.log('[ALP]', line)
}

appLog(`—— 启动 app v${app.getVersion()} · electron ${process.versions.electron} · ${process.platform} ${process.arch}`)
app.on('child-process-gone', (_e, details) => appLog(`子进程退出：${JSON.stringify(details)}`, 'error'))
process.on('uncaughtException', (e) => appLog(`主进程未捕获异常：${e?.stack ?? e}`, 'error'))
process.on('unhandledRejection', (e) => appLog(`主进程未处理拒绝：${e?.stack ?? e}`, 'error'))

/** 窗口/托盘图标：打包后图标跟 main.cjs 同级（build.mjs 会拷过去） */
function appIcon() {
  for (const p of [path.join(__dirname, 'icon.png'), path.join(__dirname, '..', 'build', 'icon.png')]) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      /* 继续找下一个 */
    }
  }
  return null
}

const ICON_PATH = appIcon()

let mainWindow = null
let serverProc = null
let tray = null

async function waitForServer(url, timeoutMs = 40000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`)
      if (res.ok) return true
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

function startServer() {
  const entry = path.join(__dirname, 'server.cjs')
  if (!fs.existsSync(entry)) {
    appLog(`找不到后端入口：${entry}`, 'error')
    return false
  }

  const env = {
    ...process.env,
    // 关键：Electron 的 fork 默认会再起一个 Electron 进程，
    // 只有带上这个标志才是"纯 Node 模式"，否则后端加载不了 node:sqlite
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    ALP_HOME,
    ALP_PORT: String(API_PORT),
    ALP_HOST: '127.0.0.1',
    ALP_WEB_DIST: path.join(__dirname, 'web'),
    // 版本号只认 app.getVersion()（= package.json），诊断包里显示的就是它
    ALP_APP_VERSION: app.getVersion(),
    ALP_ELECTRON_VERSION: process.versions.electron,
  }

  serverProc = fork(entry, [], {
    env,
    execPath: process.execPath,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })

  serverProc.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`))
  serverProc.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`))
  serverProc.on('exit', (code) => {
    appLog(`后端退出，code = ${code}`, code === 0 ? 'info' : 'error')
    serverProc = null
  })
  serverProc.on('error', (e) => {
    appLog(`后端起不来：${e.stack ?? e.message}`, 'error')
    serverProc = null
  })
  return true
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0e0f12',
    title: 'Teach me',
    ...(ICON_PATH ? { icon: ICON_PATH } : {}),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // 外链一律用系统浏览器打开，不在应用内跳走
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const url = isDev ? DEV_WEB_URL : PROD_URL
  try {
    await mainWindow.loadURL(url)
  } catch (e) {
    appLog(`页面加载失败：${String(e && e.message ? e.message : e)}（${url}）`, 'error')
    await mainWindow.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<body style="background:#0e0f12;color:#eceef2;font:14px system-ui;padding:40px">
             <h2>连不上 Teach me 的服务</h2>
             <p style="color:#a8aebc">请确认端口 ${API_PORT} 没被占用。日志在：<br />
               <code>${ALP_HOME}\\logs</code>（设置 → 关于 → 生成日志 也能拿）</p>
           </body>`,
        ),
    )
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * 下载落点。
 *
 * 「设置 → 关于 → 生成并导出日志」走的是 a[download]。Electron 默认会弹「另存为」，
 * 而这个按钮的语义就是"导出来给我"——多一个对话框只会让人以为卡住了。
 * 所以直接放到系统「下载」目录；重名就加 (1)(2)，不覆盖。
 */
function setupDownloads() {
  try {
    session.defaultSession.on('will-download', (_e, item) => {
      try {
        const dir = app.getPath('downloads')
        const name = item.getFilename() || `teachme-export-${Date.now()}.txt`
        const ext = path.extname(name)
        const base = name.slice(0, name.length - ext.length)
        let target = path.join(dir, name)
        let i = 1
        while (fs.existsSync(target)) target = path.join(dir, `${base}(${i++})${ext}`)
        item.setSavePath(target)
        appLog(`下载开始 → ${target}`)
        item.once('done', (_evt, state) => appLog(`下载 ${state}：${target}`, state === 'completed' ? 'info' : 'error'))
      } catch (err) {
        appLog(`下载落点设置失败：${err?.message ?? err}`, 'error')
      }
    })
  } catch (e) {
    appLog(`下载钩子没装上：${e?.message ?? e}`, 'error')
  }
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '文件',
        submenu: [
          {
            label: '打开数据目录',
            click: () => shell.openPath(ALP_HOME),
          },
          { type: 'separator' },
          { role: 'quit', label: '退出' },
        ],
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '刷新' },
          { role: 'toggleDevTools', label: '开发者工具' },
          { type: 'separator' },
          { role: 'resetZoom', label: '实际大小' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '全屏' },
        ],
      },
    ]),
  )
}

function buildTray() {
  try {
    // 以前是 createEmpty()，Windows 上托盘就只剩一个空白方块
    const icon = ICON_PATH ? nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 }) : nativeImage.createEmpty()
    tray = new Tray(icon)
    tray.setToolTip('Teach me · 你的私人教师')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开 ALP', click: () => (mainWindow ? mainWindow.show() : createWindow()) },
        { label: '打开数据目录', click: () => shell.openPath(ALP_HOME) },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ]),
    )
  } catch {
    /* 托盘失败不影响主流程 */
  }
}

// 单实例：再次启动时聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    setupDownloads()
    if (!isDev) {
      const ok = startServer()
      if (ok) {
        const ready = await waitForServer(PROD_URL)
        if (!ready) appLog('后端 40 秒内没起来，仍然尝试打开窗口', 'error')
      }
    }
    buildMenu()
    buildTray()
    await createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    if (serverProc) {
      try {
        serverProc.kill()
      } catch {
        /* ignore */
      }
    }
  })
}
