import type { FastifyInstance } from 'fastify'
import { ALP_HOME, APP_VERSION, DB_PATH, IS_DEV, MODELS_DIR, UPLOADS_DIR } from '../config.js'
import { dbStatus } from '../db/index.js'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    const db = dbStatus()
    return {
      ok: db.ok,
      version: APP_VERSION,
      time: new Date().toISOString(),
      env: IS_DEV ? 'dev' : 'prod',
      db,
    }
  })

  /** 给"设置 → 关于"页用：把运行环境一次说清，方便排障和提 issue */
  app.get('/api/info', async () => ({
    version: APP_VERSION,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    env: IS_DEV ? 'dev' : 'prod',
    paths: {
      home: ALP_HOME,
      db: DB_PATH,
      uploads: UPLOADS_DIR,
      models: MODELS_DIR,
    },
  }))
}
