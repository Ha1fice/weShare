/**
 * 会话服务。
 *
 * 职责边界：会话的**生命周期**。HTTP 细节（Cookie、状态码）在 http 层，
 * 密码学在 lib/password.ts 与 lib/session-token.ts，存储在 packages/db。
 *
 * 关键设计：
 *
 * 1. **明文 token 只在创建时出现一次**。服务端返回明文给客户端（进 Cookie），
 *    数据库只存 sha256 哈希。之后所有校验都用哈希比对。
 *
 * 2. **滑动续期**。每次校验会话时若剩余有效期不足一半，就延长到完整 TTL。
 *    这样活跃用户不会被强制重新登录，而长期不活跃的会话自然过期。
 *
 * 3. **登出即删**。服务端删除会话记录，token 立刻失效——
 *    只清 Cookie 是不够的，被窃取的 token 仍可用。
 */

import { randomUUID } from 'node:crypto'
import type { Repositories } from '@weshare/db'
import { generateToken, hashToken } from '../lib/session-token.js'

export interface SessionServiceOptions {
  /** 会话有效期（毫秒）。 */
  ttlMs: number
  /** 剩余有效期低于这个比例时触发续期。 */
  renewThreshold?: number
}

export interface CreatedSession {
  /** 明文 token——只在这里出现一次，交给客户端。 */
  token: string
  sessionId: string
  expiresAt: Date
}

export interface ResolvedSession {
  sessionId: string
  userId: string
  expiresAt: Date
}

export class SessionService {
  private readonly repos: Repositories
  private readonly ttlMs: number
  private readonly renewThreshold: number

  constructor(repos: Repositories, options: SessionServiceOptions) {
    this.repos = repos
    this.ttlMs = options.ttlMs
    this.renewThreshold = options.renewThreshold ?? 0.5
  }

  /**
   * 创建会话。
   *
   * @param userId 用户 id
   * @param meta 客户端信息（IP、UA），用于审计
   */
  async create(
    userId: string,
    meta?: { ip?: string | null; userAgent?: string | null },
  ): Promise<CreatedSession> {
    const token = generateToken()
    const sessionId = randomUUID()
    const expiresAt = new Date(Date.now() + this.ttlMs)

    await this.repos.users.createSession({
      id: sessionId,
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
    })

    return { token, sessionId, expiresAt }
  }

  /**
   * 校验会话 token。
   *
   * 返回 null 表示无效（不存在 / 已撤销 / 已过期 / 已登出），
   * 四种情况**不做区分**——区分会泄露信息。
   *
   * @param token 客户端带来的明文 token
   */
  async resolve(token: string): Promise<ResolvedSession | null> {
    if (!token) return null

    const session = await this.repos.users.findSessionByTokenHash(hashToken(token))
    if (!session) return null

    // 已撤销
    if (session.revokedAt !== null) return null

    // 已过期
    const now = Date.now()
    if (session.expiresAt.getTime() <= now) return null

    // 滑动续期：剩余不足一半时延长到完整 TTL
    const remaining = session.expiresAt.getTime() - now
    if (remaining < this.ttlMs * this.renewThreshold) {
      const newExpiresAt = new Date(now + this.ttlMs)
      await this.repos.users.extendSession(session.id, newExpiresAt)
      return {
        sessionId: session.id,
        userId: session.userId,
        expiresAt: newExpiresAt,
      }
    }

    return {
      sessionId: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
    }
  }

  /**
   * 撤销会话（登出）。
   *
   * 用"标记撤销"而非物理删除——保留记录便于审计"谁在何时登出过"。
   */
  async revoke(sessionId: string): Promise<void> {
    await this.repos.users.revokeSession(sessionId, new Date())
  }

  /** 清理过期会话。返回清理条数。 */
  async pruneExpired(): Promise<number> {
    return this.repos.users.deleteExpiredSessions(new Date())
  }
}
