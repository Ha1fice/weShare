/**
 * api 集成测试夹具。
 *
 * 与 packages/db 的夹具同理：**用真实数据库**，不 mock。
 * 认证逻辑的价值全在"Cookie 属性 / 会话生命周期 / 错误语义 / 限流"这些
 * 只有真实请求才能验证的地方——mock 掉一切就只剩"函数被调用过"。
 *
 * 边界：api 包**不直接依赖数据库驱动**（不变式 I7）。
 * 建库与清库由 @weshare/db/test-support 提供——只有 packages/db 能碰驱动。
 */

import { clearTables, createTestDatabase } from '@weshare/db/test-support'
import type { DbHandle } from '@weshare/db'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { LoginRateLimiter } from '../src/lib/login-rate-limit.js'

export interface ApiTestContext {
  app: FastifyInstance
  db: DbHandle
  /** 登录限流器——测试间需要重置，否则计数会跨用例累积。 */
  rateLimiter: LoginRateLimiter
  /** 清空所有表与限流计数。 */
  reset(): Promise<void>
  close(): Promise<void>
}

/**
 * 建一个带完整结构的临时库 + 一个装配好的 Fastify 实例。
 */
export async function createApiTestContext(
  options: { allowRegister?: boolean } = {},
): Promise<ApiTestContext> {
  const { db, dbPath } = await createTestDatabase()

  const config = loadConfig({
    NODE_ENV: 'test',
    DB_PATH: dbPath,
    ALLOW_REGISTER: options.allowRegister === false ? 'false' : 'true',
    SECURE_COOKIE: 'false',
    SESSION_TTL_DAYS: '30',
    LOG_LEVEL: 'silent',
  })

  // 限流器由夹具持有——server 用注入的那个，
  // 这样 reset() 能把计数一并清掉（否则计数会跨用例累积）。
  const rateLimiter = new LoginRateLimiter({
    maxAttempts: config.LOGIN_MAX_ATTEMPTS,
    windowMs: config.LOGIN_LOCK_WINDOW_SECONDS * 1000,
  })

  const app = await buildServer(config, { db, rateLimiter })

  return {
    app,
    db,
    rateLimiter,
    async reset() {
      await clearTables(dbPath)
      // 清掉限流计数——它是进程内状态，不在数据库里，
      // 重建测试库不会清掉它。
      rateLimiter.reset()
    },
    async close() {
      await app.close()
      // 不删临时目录——libSQL 的文件句柄在 Windows 上不及时释放，
      // 此刻删会 EPERM（详见架构文档 §15.2 限制 10）。
      // 残留由操作系统清理临时目录，或由 packages/db 的 globalSetup 统一处理。
    },
  }
}

/**
 * 从 Set-Cookie 头里取出会话 token。
 *
 * @param setCookie 响应头的 set-cookie 值
 */
export function extractSessionToken(setCookie: string | undefined): string | null {
  if (!setCookie) return null
  const match = setCookie.match(/^[^=]+=([^;]*)/)
  return match?.[1] ?? null
}
