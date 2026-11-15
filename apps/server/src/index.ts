import path from 'node:path'
import Fastify, { type FastifyError } from 'fastify'
import {
  ALP_HOME,
  API_HOST,
  API_PORT,
  APP_VERSION,
  DB_PATH,
  IS_DEV,
  ensureDirs,
} from './config.js'
import { closeDb, getDb } from './db/index.js'
import { healthRoutes } from './routes/health.js'
import { courseRoutes } from './routes/courses.js'
import { lessonRoutes } from './routes/lessons.js'
import { demoRoutes } from './routes/demo.js'
import { materialRoutes } from './routes/materials.js'
import { teachRoutes } from './routes/teach.js'
import { progressRoutes } from './routes/progress.js'
import { qaRoutes } from './routes/qa.js'
import { quizRoutes } from './routes/quiz.js'
import { textbookRoutes } from './routes/textbook.js'
import { annotationRoutes } from './routes/annotations.js'
import { liveRoutes, selfStudyRoutes } from './routes/live.js'
import { ttsRoutes } from './routes/tts.js'
import { promptRoutes } from './routes/prompts.js'
import { mistakeRoutes } from './routes/mistakes.js'

async function main(): Promise<void> {
  ensureDirs()

  const app = Fastify({
    // 不用 pino-pretty：它走的是"运行时按模块名解析"的 transport 机制，
    // 打包进单文件后名字解析不到，会把服务直接搞挂（实测踩过）。
    // 开发时用 ALP_LOG_LEVEL=debug 看详细日志，输出是 JSON，jq 一下也能读。
    logger: {
      level: process.env.ALP_LOG_LEVEL ?? 'info',
    },
    // 每个请求都打一行会把真正的报错淹掉，只在需要时用 ALP_LOG_REQ=1 打开
    disableRequestLogging: process.env.ALP_LOG_REQ !== '1',
    // 前端用不到 body 的复杂场景，先给一个够用的上限
    bodyLimit: 64 * 1024 * 1024,
  })

  // 初始化数据库（含迁移）。放在监听前，失败就别假装健康。
  const db = getDb()
  const t0 = Date.now()
  db.prepare('SELECT 1').get()
  const dbOk = Date.now() - t0
  const dbv = Number(
    (db.prepare('SELECT MAX(version) AS v FROM schema_migration').get() as { v: number | null })?.v ?? 0,
  )

  await app.register(healthRoutes)
  await app.register(courseRoutes)
  await app.register(lessonRoutes)
  await app.register(demoRoutes)
  await app.register(materialRoutes)
  await app.register(teachRoutes)
  await app.register(progressRoutes)
  await app.register(qaRoutes)
  await app.register(quizRoutes)
  await app.register(textbookRoutes)
  await app.register(annotationRoutes)
  await app.register(liveRoutes)
  await app.register(selfStudyRoutes)
  await app.register(ttsRoutes)
  await app.register(promptRoutes)
  await app.register(mistakeRoutes)

  // 生产模式（Electron 打包后）：后端同时托管前端静态文件
  if (!IS_DEV) {
    const { default: fastifyStatic } = await import('@fastify/static')
    const webRoot = process.env.ALP_WEB_DIST ?? path.resolve(process.cwd(), 'web')
    await app.register(fastifyStatic, { root: webRoot, prefix: '/' })
  }

  // 兜底：任何未捕获的路由错误都以统一 JSON 返回，前端好处理
  app.setNotFoundHandler((req, reply) => {
    if (!IS_DEV && !req.url.startsWith('/api')) {
      return reply.type('text/html').sendFile('index.html')
    }
    reply.code(404).send({ ok: false, error: `no route: ${req.method} ${req.url}` })
  })

  app.setErrorHandler((err: FastifyError, req, reply) => {
    req.log.error({ err }, 'request failed')
    reply.code(err.statusCode ?? 500).send({ ok: false, error: err.message })
  })

  await app.listen({ host: API_HOST, port: API_PORT })

  const line = '─'.repeat(58)
  process.stdout.write(
    [
      '',
      `  ALP · AI Library Professor  v${APP_VERSION}`,
      line,
      `  服务   http://${API_HOST}:${API_PORT}`,
      `  界面   http://127.0.0.1:5273   (pnpm dev:web)`,
      `  数据   ${ALP_HOME}`,
      `  数据库 ${DB_PATH}  (schema v${dbv}, ping ${dbOk}ms)`,
      `  环境   ${IS_DEV ? 'development' : 'production'} · Node ${process.version}`,
      line,
      '',
    ].join('\n'),
  )

  const shutdown = async (sig: string) => {
    app.log.info(`${sig} received, shutting down`)
    try {
      await app.close()
    } finally {
      closeDb()
      process.exit(0)
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('\n[ALP] 启动失败：', err)
  process.exit(1)
})
