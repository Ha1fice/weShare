/**
 * Fastify 装配与优雅退出（架构文档 T0.4）。
 */

import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { LogController } from 'fastify'
import { ERROR_CODES, type ErrorCode } from '@weshare/shared'
import { loadConfig, type AppConfig } from './config.js'
import { AppError, toErrorBody } from './http/errors.js'

/** 组装 Fastify 实例（不监听端口，便于测试复用）。 */
export async function buildServer(config: AppConfig = loadConfig()): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } }
          : undefined,
    },
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    // Fastify 5.12 起顶层 disableRequestLogging 已废弃，改用 logController
    logController: new LogController({
      disableRequestLogging: config.NODE_ENV === 'test',
    }),
  })

  // 统一错误处理：任何异常都转成契约化的错误体
  app.setErrorHandler((error: unknown, req, reply) => {
    const requestId = req.id

    if (error instanceof AppError) {
      req.log.info({ err: error, requestId }, '请求失败')
      return reply.status(error.status).send(toErrorBody(error.code, error.message, requestId))
    }

    const fastifyError = error as {
      validation?: unknown
      statusCode?: number
    }

    // Fastify 自身的校验/解析错误
    if (fastifyError.validation) {
      req.log.info({ err: error, requestId }, '请求校验失败')
      return reply.status(422).send(toErrorBody('VALIDATION_FAILED', '请求参数不合法', requestId))
    }

    if (fastifyError.statusCode === 413) {
      return reply.status(413).send(toErrorBody('PAYLOAD_TOO_LARGE', '请求体过大', requestId))
    }

    // 未知错误：不把细节返回给客户端
    req.log.error({ err: error, requestId }, '未处理异常')
    return reply.status(500).send(toErrorBody('INTERNAL_ERROR', '服务器内部错误', requestId))
  })

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send(toErrorBody('NOT_FOUND', '资源不存在', req.id))
  })

  // 健康检查：含数据库连通性
  // 两个路径都注册：/healthz 供容器/进程管理器直接探活，
  // /api/v1/healthz 供前端经 Vite 代理访问（开发期与生产同源）。
  app.get('/healthz', async () => ({ ok: true }))
  app.get('/api/v1/healthz', async () => ({ ok: true }))

  return app
}

/** 启动服务。 */
export async function start(): Promise<void> {
  const config = loadConfig()
  const app = await buildServer(config)

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, '收到退出信号，开始优雅关闭')
    try {
      await app.close()
      process.exit(0)
    } catch (err) {
      app.log.error({ err }, '优雅关闭失败')
      process.exit(1)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ host: config.HOST, port: config.PORT })
  app.log.info({ host: config.HOST, port: config.PORT, env: config.NODE_ENV }, 'api 已启动')
}

// 直接运行时启动（作为模块被 import 时不启动）
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
if (isMain) {
  start().catch((err) => {
    console.error('api 启动失败', err)
    process.exit(1)
  })
}

export { ERROR_CODES }
export type { ErrorCode }
