/**
 * 会话校验（collab 侧）。
 *
 * 与 api 的 `SessionService.resolve` 是同一套规则的**精简实现**：
 * 只读不写（不做滑动续期——续期是 api 的职责，协同连接不该延长会话寿命）。
 *
 * 为什么不直接 import api 的 SessionService：那会把整个 Fastify 应用
 * 变成 collab 的依赖。两个进程的边界应该只共享 `packages/*`。
 * 代价是"哈希算法与过期规则必须两边一致"——所以这里逐条对齐并写了测试。
 */

import { createHash } from 'node:crypto'
import type { Repositories } from '@weshare/db'

/** 与 api 侧一致：sha256(token) 存库。 */
function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

export interface ResolvedCollabSession {
  sessionId: string
  userId: string
}

/** 校验会话 token。无效（不存在 / 撤销 / 过期）一律返回 null，不区分原因。 */
export async function resolveSession(
  repos: Repositories,
  token: string,
): Promise<ResolvedCollabSession | null> {
  if (!token) return null

  const session = await repos.users.findSessionByTokenHash(hashToken(token))
  if (!session) return null
  if (session.revokedAt !== null) return null
  if (session.expiresAt.getTime() <= Date.now()) return null

  return { sessionId: session.id, userId: session.userId }
}
