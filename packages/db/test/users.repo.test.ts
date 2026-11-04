import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { createTestDb, IDs, type TestDb } from './fixture.js'

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()
})

beforeEach(async () => {
  await db.reset()
})

afterAll(async () => {
  await db.close()
})

describe('UsersRepository', () => {
  it('创建用户后可按 id 查到', async () => {
    const created = await db.repos.users.create({
      id: IDs.user,
      email: 'owner@example.com',
      passwordHash: 'hash',
      displayName: '空间所有者',
    })

    expect(created.id).toBe(IDs.user)
    expect(created.displayName).toBe('空间所有者')
    expect(created.status).toBe('active')
    expect(created.lastLoginAt).toBeNull()

    const found = await db.repos.users.findById(IDs.user)
    expect(found?.email).toBe('owner@example.com')
  })

  it('按邮箱查是大小写不敏感的', async () => {
    await db.repos.users.create({
      id: IDs.user,
      email: 'Owner@Example.COM',
      passwordHash: 'hash',
      displayName: '大小写',
    })

    // 三种写法都要命中同一个人
    for (const q of ['owner@example.com', 'OWNER@EXAMPLE.COM', 'Owner@Example.Com']) {
      const found = await db.repos.users.findByEmail(q)
      expect(found?.id).toBe(IDs.user)
    }
  })

  it('邮箱大小写不敏感的唯一性由数据库保证', async () => {
    await db.repos.users.create({
      id: IDs.user,
      email: 'dup@example.com',
      passwordHash: 'hash',
      displayName: '第一个',
    })

    // 用不同大小写创建第二个 —— 必须失败
    await expect(
      db.repos.users.create({
        id: IDs.user2,
        email: 'DUP@Example.com',
        passwordHash: 'hash',
        displayName: '第二个',
      }),
    ).rejects.toThrow()
  })

  it('查不存在的用户返回 null', async () => {
    expect(await db.repos.users.findById('nope')).toBeNull()
    expect(await db.repos.users.findByEmail('nope@example.com')).toBeNull()
  })

  it('更新显示名', async () => {
    await db.repos.users.create({
      id: IDs.user,
      email: 'a@example.com',
      passwordHash: 'hash',
      displayName: '旧名',
    })

    const updated = await db.repos.users.updateDisplayName(IDs.user, '新名')
    expect(updated.displayName).toBe('新名')

    const reread = await db.repos.users.findById(IDs.user)
    expect(reread?.displayName).toBe('新名')
  })

  it('记录登录时间', async () => {
    await db.repos.users.create({
      id: IDs.user,
      email: 'a@example.com',
      passwordHash: 'hash',
      displayName: 'A',
    })

    const at = new Date('2026-01-02T03:04:05.000Z')
    await db.repos.users.touchLastLogin(IDs.user, at)

    const reread = await db.repos.users.findById(IDs.user)
    expect(reread?.lastLoginAt?.toISOString()).toBe(at.toISOString())
  })
})

describe('会话', () => {
  beforeEach(async () => {
    await db.repos.users.create({
      id: IDs.user,
      email: 'a@example.com',
      passwordHash: 'hash',
      displayName: 'A',
    })
  })

  it('创建会话后可按 token 哈希找回', async () => {
    const tokenHash = new Uint8Array([1, 2, 3, 4, 5])
    const expiresAt = new Date(Date.now() + 86_400_000)

    const session = await db.repos.users.createSession({
      id: 's-1',
      userId: IDs.user,
      tokenHash,
      expiresAt,
    })

    expect(session.userId).toBe(IDs.user)
    expect(session.revokedAt).toBeNull()

    const found = await db.repos.users.findSessionByTokenHash(tokenHash)
    expect(found?.id).toBe('s-1')
  })

  it('不同的 token 哈希查不到会话', async () => {
    await db.repos.users.createSession({
      id: 's-1',
      userId: IDs.user,
      tokenHash: new Uint8Array([1, 2, 3]),
      expiresAt: new Date(Date.now() + 86_400_000),
    })

    const found = await db.repos.users.findSessionByTokenHash(new Uint8Array([9, 9, 9]))
    expect(found).toBeNull()
  })

  it('撤销会话', async () => {
    const tokenHash = new Uint8Array([1, 2, 3])
    await db.repos.users.createSession({
      id: 's-1',
      userId: IDs.user,
      tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
    })

    const at = new Date()
    await db.repos.users.revokeSession('s-1', at)

    const found = await db.repos.users.findSessionByTokenHash(tokenHash)
    expect(found?.revokedAt).not.toBeNull()
  })

  it('清理过期会话', async () => {
    const now = Date.now()
    await db.repos.users.createSession({
      id: 's-old',
      userId: IDs.user,
      tokenHash: new Uint8Array([1]),
      expiresAt: new Date(now - 1000),
    })
    await db.repos.users.createSession({
      id: 's-new',
      userId: IDs.user,
      tokenHash: new Uint8Array([2]),
      expiresAt: new Date(now + 86_400_000),
    })

    const removed = await db.repos.users.deleteExpiredSessions(new Date(now))
    expect(removed).toBe(1)

    expect(await db.repos.users.findSessionByTokenHash(new Uint8Array([1]))).toBeNull()
    expect(await db.repos.users.findSessionByTokenHash(new Uint8Array([2]))).not.toBeNull()
  })

  it('删除用户会级联删除其会话', async () => {
    await db.repos.users.createSession({
      id: 's-1',
      userId: IDs.user,
      tokenHash: new Uint8Array([1]),
      expiresAt: new Date(Date.now() + 86_400_000),
    })

    await db.prisma.user.delete({ where: { id: IDs.user } })

    expect(await db.repos.users.findSessionByTokenHash(new Uint8Array([1]))).toBeNull()
  })
})
