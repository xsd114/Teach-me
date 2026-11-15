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
const { app, BrowserWindow, shell, Menu, Tray, nativeImage } = require('electron')
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
    console.error('[ALP] 找不到后端入口：', entry)
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
  }

  serverProc = fork(entry, [], {
    env,
    execPath: process.execPath,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })

  serverProc.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`))
  serverProc.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`))
  serverProc.on('exit', (code) => {
    console.log('[ALP] 后端退出，code =', code)
    serverProc = null
  })
  serverProc.on('error', (e) => {
    console.error('[ALP] 后端起不来：', e.message)
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
  } catch {
    await mainWindow.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<body style="background:#0e0f12;color:#eceef2;font:14px system-ui;padding:40px">
             <h2>连不上 ALP 服务</h2>
             <p style="color:#a8aebc">请确认端口 ${API_PORT} 没被占用，或看控制台日志。</p>
           </body>`,
        ),
    )
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
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
    const icon = nativeImage.createEmpty()
    tray = new Tray(icon)
    tray.setToolTip('ALP · AI Library Professor')
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
    if (!isDev) {
      const ok = startServer()
      if (ok) {
        const ready = await waitForServer(PROD_URL)
        if (!ready) console.warn('[ALP] 后端 40 秒内没起来，仍然尝试打开窗口')
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
