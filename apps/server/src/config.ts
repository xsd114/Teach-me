import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

/**
 * 用户数据目录。
 *
 * 默认策略（按顺序找第一个可用的）：
 *   1) 环境变量 ALP_HOME
 *   2) Windows 上第一个非系统盘的空闲根目录，如 E:\ALP-data、D:\ALP-data
 *   3) %APPDATA%\ALP  （macOS/Linux 上是 ~/.alp）
 *
 * 为什么不是直接 %APPDATA%：用户机器 C 盘空间紧张，几十 GB 的教材与模型
 * 落在系统盘会把机器拖死。仓库里永远不放用户数据 —— 见 DECISIONS D23。
 */
function pickHome(): string {
  const env = process.env.ALP_HOME
  if (env && env.trim()) return path.resolve(env)

  if (process.platform === 'win32') {
    for (const letter of ['E', 'D', 'F', 'G']) {
      const root = `${letter}:\\`
      try {
        if (!fs.existsSync(root)) continue
        // 能创建目录才算可用
        fs.mkdirSync(path.join(root, 'ALP-data'), { recursive: true })
        return path.join(root, 'ALP-data')
      } catch {
        /* 盘不存在或没权限，跳过 */
      }
    }
  }

  const appData = process.env.APPDATA
  if (appData && appData.trim()) return path.join(appData, 'ALP')
  return path.join(os.homedir(), '.alp')
}

export const ALP_HOME = pickHome()

export const DB_PATH = process.env.ALP_DB ?? path.join(ALP_HOME, 'alp.db')

/** 用户导入的原始文件副本 */
export const UPLOADS_DIR = path.join(ALP_HOME, 'uploads')
/** 解析后的中间产物（markdown 等） */
export const CACHE_DIR = path.join(ALP_HOME, 'cache')
/** 本地 embedding 模型与语音模型 */
export const MODELS_DIR = path.join(ALP_HOME, 'models')
/** 日志 */
export const LOGS_DIR = path.join(ALP_HOME, 'logs')

export const API_HOST = process.env.ALP_HOST ?? '127.0.0.1'
export const API_PORT = Number(process.env.ALP_PORT ?? 5274)
export const NODE_ENV = process.env.NODE_ENV ?? 'development'
export const IS_DEV = NODE_ENV !== 'production'
export const APP_VERSION = '0.1.0'

export function ensureDirs(): void {
  for (const dir of [ALP_HOME, UPLOADS_DIR, CACHE_DIR, MODELS_DIR, LOGS_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
