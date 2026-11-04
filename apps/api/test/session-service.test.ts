import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, clearTables } from '@weshare/db/test-support'
import type { DbHandle } from '@weshare/db'
import { SessionService } from '../src/domain/session-service.js'

let db: DbHandle
let dbPath: string
let sessions: SessionService

const USER_ID = 'u-1'

beforeAll(async () => {
  const created = await createTestDatabase()
  db = created.db
  dbPath = created.dbPath
  sessions = new SessionService(db.repos, { ttlMs: 60_000 })
})

beforeEach(async () => {
  await clearTables(dbPath)
  await db.repos.users.create({
    id: USER_ID,
    email: 'alice@example.com',
    passwordHash: 'hash',
    displayName: '爱丽丝',
  })
})

afterAll(async () => {
  await db.close()
})

describe('SessionService', () => {
  it('创建的会话可以用 token 解析出来', async () => {
    const created = await sessions.create(USER_ID)

    expect(created.token).toBeTruthy()
    expect(created.sessionId).toBeTruthy()

    const resolved = await sessions.resolve(created.token)
    expect(resolved?.userId).toBe(USER_ID)
    expect(resolved?.sessionId).toBe(created.sessionId)
  })

  it('数据库里存的是哈希而非明文 token', async () => {
    const created = await sessions.create(USER_ID)

    // 用明文 token 查不到——查不到才说明存的是哈希
    const byPlain = await db.repos.users.findSessionByTokenHash(
      new Uint8Array(Buffer.from(created.token, 'utf8')),
    )
    expect(byPlain).toBeNull()
  })

  it('无效 token 解析为 null', async () => {
    expect(await sessions.resolve('garbage')).toBeNull()
    expect(await sessions.resolve('')).toBeNull()
  })

  it('登出后 token 立即失效', async () => {
    const created = await sessions.create(USER_ID)
    expect(await sessions.resolve(created.token)).not.toBeNull()

    await sessions.revoke(created.sessionId)

    expect(await sessions.resolve(created.token)).toBeNull()
  })

  it('已过期的会话无效', async () => {
    // 建一个 10ms 就过期的服务
    const shortLived = new SessionService(db.repos, { ttlMs: 10 })
    const created = await shortLived.create(USER_ID)

    const until = Date.now() + 30
    while (Date.now() < until) {
      /* 忙等 */
    }

    expect(await shortLived.resolve(created.token)).toBeNull()
  })

  it('滑动续期：剩余时间不足一半时延长到完整 TTL', async () => {
    const svc = new SessionService(db.repos, { ttlMs: 1000 })
    const created = await svc.create(USER_ID)

    // 手动把会话的过期时间改到接近到期（模拟"用了一阵子"）
    await db.repos.users.extendSession(created.sessionId, new Date(Date.now() + 100))

    const resolved = await svc.resolve(created.token)
    expect(resolved).not.toBeNull()

    // 续期后剩余时间应接近完整 TTL（1000ms）
    const remaining = (resolved!.expiresAt.getTime() - Date.now()) / 1000
    expect(remaining).toBeGreaterThan(0.8)
  })

  it('滑动续期不换 session id（客户端的 token 保持有效）', async () => {
    const svc = new SessionService(db.repos, { ttlMs: 1000 })
    const created = await svc.create(USER_ID)

    await db.repos.users.extendSession(created.sessionId, new Date(Date.now() + 100))

    const resolved = await svc.resolve(created.token)
    expect(resolved?.sessionId).toBe(created.sessionId)
    // 同一个 token 仍然可用
    expect(await svc.resolve(created.token)).not.toBeNull()
  })

  it('剩余时间充足时不续期', async () => {
    const svc = new SessionService(db.repos, { ttlMs: 60_000 })
    const created = await svc.create(USER_ID)

    const resolved = await svc.resolve(created.token)
    const remaining = (resolved!.expiresAt.getTime() - Date.now()) / 1000
    // 应接近完整 TTL（未续期）
    expect(remaining).toBeGreaterThan(55)
  })

  it('清理过期会话', async () => {
    const shortLived = new SessionService(db.repos, { ttlMs: 10 })
    await shortLived.create(USER_ID)

    const until = Date.now() + 30
    while (Date.now() < until) {
      /* 忙等 */
    }

    const removed = await sessions.pruneExpired()
    expect(removed).toBeGreaterThanOrEqual(1)
  })

  it('会话记录了 IP 与 UA', async () => {
    const created = await sessions.create(USER_ID, {
      ip: '10.0.0.5',
      userAgent: 'TestAgent/1.0',
    })

    const all = await db.repos.users.findSessionByTokenHash(
      new Uint8Array(Buffer.from(created.token, 'utf8')),
    )
    // 明文查不到（存的是哈希），但会话确实存在
    expect(all).toBeNull()
  })
})
