/**
 * Fastify 装配与优雅退出（架构文档 T0.4）。
 */

import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { LogController } from 'fastify'
import { ERROR_CODES, type ErrorCode } from '@weshare/shared'
import { createDbHandle, type DbHandle, type Repositories } from '@weshare/db'
import { loadConfig, type AppConfig } from './config.js'
import { AppError, toErrorBody } from './http/errors.js'
import { registerAuthRoutes } from './http/auth-routes.js'
import { registerWorkspaceRoutes } from './http/workspace-routes.js'
import { registerNodeRoutes } from './http/node-routes.js'
import { registerContentRoutes } from './http/content-routes.js'
import { registerIdentityRoutes } from './http/identity-routes.js'
import { IdentityService } from './domain/identity-service.js'
import { SessionService } from './domain/session-service.js'
import { WorkspaceService } from './domain/workspace-service.js'
import { NodeService } from './domain/node-service.js'
import { ContentService } from './domain/content-service.js'
import { LoginRateLimiter } from './lib/login-rate-limit.js'

export interface ServerDeps {
  /**
   * 数据库句柄。
   *
   * 业务侧只拿 Repository 接口——Prisma Client 始终留在 packages/db 内
   * （不变式 I7）。测试注入用内存库建的句柄。
   */
  db?: DbHandle
  /** 会话服务。 */
  sessions?: SessionService
  /** 登录限流器。 */
  rateLimiter?: LoginRateLimiter
}

/** 组装 Fastify 实例（不监听端口，便于测试复用）。 */
export async function buildServer(
  config: AppConfig = loadConfig(),
  deps: ServerDeps = {},
): Promise<FastifyInstance> {
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
      code?: string
    }

    // Fastify 自身的校验/解析错误
    if (fastifyError.validation) {
      req.log.info({ err: error, requestId }, '请求校验失败')
      return reply.status(422).send(toErrorBody('VALIDATION_FAILED', '请求参数不合法', requestId))
    }

    // Fastify 抛出的 4xx（如 JSON 解析失败、请求体为空、URL 参数非法）
    // 必须原样透传状态码——统统转成 500 会污染错误指标，
    // 也会让客户端以为是服务端挂了而盲目重试。
    const status = fastifyError.statusCode
    if (typeof status === 'number' && status >= 400 && status < 500) {
      req.log.info({ err: error, requestId, status }, '客户端请求不合法')

      const code: ErrorCode =
        status === 404 ? 'NOT_FOUND' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED'

      const message =
        status === 413 ? '请求体过大' : status === 404 ? '资源不存在' : '请求格式不合法'

      return reply.status(status).send(toErrorBody(code, message, requestId))
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

  // 数据层与领域服务
  // Prisma Client 由 packages/db 内部创建与持有——业务侧只见 Repository 接口
  const db = deps.db ?? createDbHandle(config.DB_PATH)
  const repos: Repositories = db.repos
  const sessionTtlMs = config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
  const sessions =
    deps.sessions ?? new SessionService(repos, { ttlMs: sessionTtlMs })
  const rateLimiter =
    deps.rateLimiter ??
    new LoginRateLimiter({
      maxAttempts: config.LOGIN_MAX_ATTEMPTS,
      windowMs: config.LOGIN_LOCK_WINDOW_SECONDS * 1000,
    })

  // 认证路由
  registerAuthRoutes(app, {
    repos,
    sessions,
    rateLimiter,
    secureCookie: config.SECURE_COOKIE,
    sessionMaxAgeSeconds: config.SESSION_TTL_DAYS * 24 * 60 * 60,
    allowRegister: config.ALLOW_REGISTER,
  })

  // 免密身份（设备指纹）——只在开关打开时注册，关闭时路径直接 404
  if (config.DEVICE_IDENTITY) {
    registerIdentityRoutes(app, {
      repos,
      sessions,
      identity: new IdentityService(repos),
      secureCookie: config.SECURE_COOKIE,
      sessionMaxAgeSeconds: config.SESSION_TTL_DAYS * 24 * 60 * 60,
    })
  }

  // 空间与成员路由
  const workspaceService = new WorkspaceService({ repos })
  registerWorkspaceRoutes(app, {
    repos,
    workspaces: workspaceService,
    sessions,
    secureCookie: config.SECURE_COOKIE,
  })

  // 节点路由
  const nodeService = new NodeService({ repos })
  registerNodeRoutes(app, {
    repos,
    nodes: nodeService,
    sessions,
    secureCookie: config.SECURE_COOKIE,
  })

  // 文档正文路由（Phase 2：单机编辑 + 自动保存）
  const contentService = new ContentService({ repos, nodes: nodeService })
  registerContentRoutes(app, {
    repos,
    contents: contentService,
    sessions,
    secureCookie: config.SECURE_COOKIE,
  })

  // 进程退出前关闭数据库连接
  app.addHook('onClose', async () => {
    await db.close()
  })

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
