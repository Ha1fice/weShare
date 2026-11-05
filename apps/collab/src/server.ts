/**
 * 协同服务。
 *
 * 职责边界（架构文档 §4.1）：连接鉴权、Yjs 同步、在线状态、落库。
 * **不解析业务语义**——不判断"这段该不该改"（那是 api 的权限职责），
 * 只判"这个连接能不能写"。
 *
 * 三道关，缺一不可：
 *
 *   1. **Origin 白名单**（onConnect）：Cookie 鉴权的 WS 不受同源策略保护，
 *      不校验 Origin 就是给跨站 WebSocket 劫持开门（R15）。
 *   2. **会话 + authz**（onAuthenticate）：复用 `@weshare/authz` 的
 *      `effectiveRole`，与 REST 侧同一份算法。
 *   3. **只读强制**（connection.readOnly）：view 角色的连接发来的 update 帧
 *      被服务端直接丢弃，不落库。前端藏按钮只是体验优化。
 */

import { Server } from '@hocuspocus/server'
import { createDbHandle, type DbHandle, type Repositories } from '@weshare/db'
import pino from 'pino'
import { loadConfig, type CollabConfig } from './config.js'
import { checkOrigin, parseAllowedOrigins } from './auth/origin.js'
import { CollabAuth } from './auth/service.js'
import { Persistence } from './persistence.js'
import { parseDocumentName } from './doc-name.js'
import { resolveSession } from './session.js'
import { AppError } from './errors.js'

/** WS 关闭码（架构文档附录 B）。 */
const CLOSE = {
  UNAUTHENTICATED: 4401,
  FORBIDDEN: 4403,
  NOT_FOUND: 4404,
} as const

/** 连接上下文（onAuthenticate 写入，后续钩子读）。 */
export interface CollabContext {
  nodeId: string
  userId: string
  displayName: string
  role: string
  canWrite: boolean
  /** 客户端声明的在线状态（头像色/名字）由 awareness 承载，这里只留身份。 */
}

export interface CollabDeps {
  db?: DbHandle
  config?: CollabConfig
  logger?: pino.Logger
}

export interface BuiltCollab {
  server: Server
  db: DbHandle
  repos: Repositories
  /** 优雅关闭：先 flush 落库，再断开。 */
  close(): Promise<void>
}

/** 组装 Hocuspocus 实例（不监听端口，便于测试）。 */
export function buildCollab(deps: CollabDeps = {}): BuiltCollab {
  const config = deps.config ?? loadConfig()
  const logger =
    deps.logger ??
    pino({
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : {}),
    })

  const db = deps.db ?? createDbHandle(config.DB_PATH)
  const repos = db.repos

  const allowedOrigins = parseAllowedOrigins(config.ALLOWED_ORIGINS)
  if (allowedOrigins.length === 0 && config.NODE_ENV === 'production') {
    // 生产环境没配白名单 = 所有握手都会被拒。喊一声，别让人对着 4403 猜。
    logger.error('ALLOWED_ORIGINS 未配置：所有协同连接都会被拒绝（fail-closed）')
  }

  const auth = new CollabAuth({
    repos,
    resolveSession: (token) => resolveSession(repos, token),
  })
  const persistence = new Persistence({ repos })

  const server = new Server<CollabContext>({
    port: config.PORT,
    // 落库节流：SQLite 单写者，每次改动都写会把自己锁住（R13）
    debounce: config.STORE_DEBOUNCE_MS,
    maxDebounce: config.STORE_MAX_DEBOUNCE_MS,
    // 文档没有连接后不要立刻卸载——卸载会触发一次落库，紧接着又有人连进来
    // 就要重新装载，白白多一轮 IO
    unloadImmediately: false,

    async onConnect({ requestHeaders }) {
      const origin = requestHeaders.get('origin')
      const result = checkOrigin(origin, allowedOrigins)
      if (!result.ok) {
        logger.warn({ origin, reason: result.reason }, '拒绝 WebSocket 握手：Origin 校验失败')
        // onConnect 抛错 → Hocuspocus 关闭连接。这里用 4403（禁止），
        // 不给攻击者"origin 不对"与"没权限"的区分。
        throw new AppError('FORBIDDEN', `origin_${result.reason}`)
      }
    },

    async onAuthenticate({ documentName, requestHeaders, connectionConfig, token }) {
      const nodeId = parseDocumentName(documentName)
      if (!nodeId) {
        throw { code: CLOSE.NOT_FOUND, message: '文档不存在' }
      }

      // token 参数来自客户端 URL / 消息里的显式 token；本项目不用它，
      // 统一走 Cookie（HttpOnly，XSS 拿不到）。留着参数只为写清这一点。
      void token

      const cookie = requestHeaders.get('cookie') ?? undefined
      const result = await auth.authorize(nodeId, cookie)

      if (!result.ok) {
        logger.info({ nodeId, reason: result.reason }, '协同鉴权失败')
        if (result.reason === 'unauthenticated') {
          throw { code: CLOSE.UNAUTHENTICATED, message: result.message }
        }
        // 无权与不存在对外表现一致，避免探测（与 REST 侧 404 语义对齐）
        throw { code: CLOSE.NOT_FOUND, message: '文档不存在' }
      }

      // 只读由服务端强制：Hocuspocus 会拒收来自该连接的 update 帧
      connectionConfig.readOnly = !result.canWrite

      logger.debug(
        { nodeId, userId: result.userId, role: result.role, readOnly: !result.canWrite },
        '协同连接已授权',
      )

      return {
        nodeId: result.nodeId,
        userId: result.userId,
        displayName: result.displayName,
        role: result.role,
        canWrite: result.canWrite,
      }
    },

    async onLoadDocument({ context, document, documentName }) {
      await persistence.load({ context, document, documentName })
    },

    async onStoreDocument({ document, documentName }) {
      try {
        await persistence.store({ document, documentName })
      } catch (err) {
        // 落库失败不能踢人：内存里的 Y.Doc 仍是完整的，下次改动会再试。
        // 但必须喊出来——静默失败等于"以为存了其实没存"（R2）。
        logger.error({ err, documentName }, '协同落库失败，将在下次改动时重试')
      }
    },

    async onDisconnect({ context, documentName }) {
      logger.debug({ documentName, userId: context?.userId }, '协同连接断开')
    },
  })

  return {
    server,
    db,
    repos,
    async close() {
      // Hocuspocus 4 的 destroy() 会先把所有文档 flush 一遍再断开
      await server.destroy()
      await db.close()
    },
  }
}

/** 启动服务（生产入口）。 */
export async function start(): Promise<void> {
  const config = loadConfig()
  const logger = pino({ level: config.LOG_LEVEL })
  const built = buildCollab({ config, logger })

  await built.server.listen()
  logger.info({ host: config.HOST, port: config.PORT }, 'collab 已启动')

  const shutdown = async (signal: string) => {
    logger.info({ signal }, '收到退出信号，开始优雅关闭')
    try {
      await built.close()
      process.exit(0)
    } catch (err) {
      logger.error({ err }, '优雅关闭失败')
      process.exit(1)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}
