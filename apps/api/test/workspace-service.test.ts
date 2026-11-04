import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { clearTables, createTestDatabase } from '@weshare/db/test-support'
import type { DbHandle } from '@weshare/db'
import { WorkspaceService } from '../src/domain/workspace-service.js'

let db: DbHandle
let dbPath: string
let svc: WorkspaceService

const OWNER = 'u-owner'
const ADMIN = 'u-admin'
const MEMBER = 'u-member'
const VIEWER = 'u-viewer'
const OUTSIDER = 'u-outsider'
const WS = 'w-1'

beforeAll(async () => {
  const created = await createTestDatabase()
  db = created.db
  dbPath = created.dbPath
  svc = new WorkspaceService({ repos: db.repos })
})

beforeEach(async () => {
  await clearTables(dbPath)

  for (const id of [OWNER, ADMIN, MEMBER, VIEWER, OUTSIDER]) {
    await db.repos.users.create({
      id,
      email: `${id}@example.com`,
      passwordHash: 'hash',
      displayName: id,
    })
  }

  await db.repos.workspaces.create({ id: WS, name: '研发空间', ownerId: OWNER })
  await db.repos.workspaces.upsertMember({ workspaceId: WS, userId: ADMIN, role: 'admin' })
  await db.repos.workspaces.upsertMember({ workspaceId: WS, userId: MEMBER, role: 'member' })
  await db.repos.workspaces.upsertMember({ workspaceId: WS, userId: VIEWER, role: 'viewer' })
})

afterAll(async () => {
  await db.close()
})

describe('requireMembership', () => {
  it('空间成员拿到自己的角色', async () => {
    expect(await svc.requireMembership(WS, OWNER)).toBe('owner')
    expect(await svc.requireMembership(WS, ADMIN)).toBe('admin')
    expect(await svc.requireMembership(WS, MEMBER)).toBe('member')
    expect(await svc.requireMembership(WS, VIEWER)).toBe('viewer')
  })

  it('非成员返回 404（不是 403——否则能探测空间是否存在）', async () => {
    await expect(svc.requireMembership(WS, OUTSIDER)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
  })

  it('不存在的空间也返回 404', async () => {
    await expect(svc.requireMembership('w-nope', OWNER)).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('requireMemberManagement', () => {
  it('owner 与 admin 可以管理成员', async () => {
    expect(await svc.requireMemberManagement(WS, OWNER)).toBe('owner')
    expect(await svc.requireMemberManagement(WS, ADMIN)).toBe('admin')
  })

  it('member 与 viewer 不能管理成员（403）', async () => {
    await expect(svc.requireMemberManagement(WS, MEMBER)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
    await expect(svc.requireMemberManagement(WS, VIEWER)).rejects.toMatchObject({
      status: 403,
    })
  })

  it('非成员是 404 而不是 403', async () => {
    await expect(svc.requireMemberManagement(WS, OUTSIDER)).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('requireWorkspaceSettings', () => {
  it('只有 owner 能改空间设置', async () => {
    expect(await svc.requireWorkspaceSettings(WS, OWNER)).toBe('owner')
  })

  it('admin 不能改空间设置', async () => {
    // 刻意不扩大管理员权限——admin 管成员，但不改空间设置
    await expect(svc.requireWorkspaceSettings(WS, ADMIN)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
  })
})

describe('addMemberByEmail', () => {
  it('owner 可以按邮箱添加成员', async () => {
    await db.repos.users.create({
      id: 'u-new',
      email: 'new@example.com',
      passwordHash: 'hash',
      displayName: '新人',
    })

    const result = await svc.addMemberByEmail(WS, OWNER, {
      email: 'new@example.com',
      role: 'member',
    })

    expect(result.userId).toBe('u-new')
    expect(await db.repos.workspaces.findMemberRole(WS, 'u-new')).toBe('member')
  })

  it('admin 也可以添加成员', async () => {
    await db.repos.users.create({
      id: 'u-new',
      email: 'new@example.com',
      passwordHash: 'hash',
      displayName: '新人',
    })

    await svc.addMemberByEmail(WS, ADMIN, { email: 'new@example.com', role: 'viewer' })
    expect(await db.repos.workspaces.findMemberRole(WS, 'u-new')).toBe('viewer')
  })

  it('member 不能添加成员', async () => {
    await expect(
      svc.addMemberByEmail(WS, MEMBER, { email: 'new@example.com', role: 'member' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('邮箱不存在返回 404', async () => {
    await expect(
      svc.addMemberByEmail(WS, OWNER, { email: 'nobody@example.com', role: 'member' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('已是成员时返回 409（不静默改角色）', async () => {
    await expect(
      svc.addMemberByEmail(WS, OWNER, { email: `${MEMBER}@example.com`, role: 'admin' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })

    // 角色未被改动
    expect(await db.repos.workspaces.findMemberRole(WS, MEMBER)).toBe('member')
  })
})

describe('updateMemberRole', () => {
  it('owner 与 admin 都能改角色', async () => {
    await svc.updateMemberRole(WS, OWNER, MEMBER, 'admin')
    expect(await db.repos.workspaces.findMemberRole(WS, MEMBER)).toBe('admin')

    await svc.updateMemberRole(WS, ADMIN, VIEWER, 'member')
    expect(await db.repos.workspaces.findMemberRole(WS, VIEWER)).toBe('member')
  })

  it('member 不能改角色', async () => {
    await expect(svc.updateMemberRole(WS, MEMBER, VIEWER, 'admin')).rejects.toMatchObject({
      status: 403,
    })
  })

  it('不能修改 owner 的角色（防止 admin 提权）', async () => {
    await expect(svc.updateMemberRole(WS, ADMIN, OWNER, 'member')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })

    expect(await db.repos.workspaces.findMemberRole(WS, OWNER)).toBe('owner')
  })

  it('owner 自己也不能通过接口降级（需独立的所有权转移操作）', async () => {
    await expect(svc.updateMemberRole(WS, OWNER, OWNER, 'member')).rejects.toMatchObject({
      status: 403,
    })
  })

  it('非成员返回 404', async () => {
    await expect(svc.updateMemberRole(WS, OWNER, OUTSIDER, 'member')).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('removeMember', () => {
  it('owner 与 admin 都能移除成员', async () => {
    await svc.removeMember(WS, OWNER, VIEWER)
    expect(await db.repos.workspaces.findMemberRole(WS, VIEWER)).toBeNull()

    await svc.removeMember(WS, ADMIN, MEMBER)
    expect(await db.repos.workspaces.findMemberRole(WS, MEMBER)).toBeNull()
  })

  it('member 不能移除成员', async () => {
    await expect(svc.removeMember(WS, MEMBER, VIEWER)).rejects.toMatchObject({ status: 403 })
    expect(await db.repos.workspaces.findMemberRole(WS, VIEWER)).toBe('viewer')
  })

  it('不能移除 owner（否则空间失去所有者）', async () => {
    await expect(svc.removeMember(WS, ADMIN, OWNER)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
    expect(await db.repos.workspaces.findMemberRole(WS, OWNER)).toBe('owner')
  })

  it('移除非成员返回 404', async () => {
    await expect(svc.removeMember(WS, OWNER, OUTSIDER)).rejects.toMatchObject({ status: 404 })
  })
})

describe('updateSettings', () => {
  it('owner 可以改空间名与默认角色', async () => {
    await svc.updateSettings(WS, OWNER, { name: '新名字', defaultRole: 'view' })

    const ws = await db.repos.workspaces.findById(WS)
    expect(ws?.name).toBe('新名字')
    expect(ws?.defaultRole).toBe('view')
  })

  it('admin 不能改空间设置', async () => {
    await expect(
      svc.updateSettings(WS, ADMIN, { name: 'admin 改的名字' }),
    ).rejects.toMatchObject({ status: 403 })

    const ws = await db.repos.workspaces.findById(WS)
    expect(ws?.name).toBe('研发空间')
  })

  it('member 与 viewer 不能改空间设置', async () => {
    await expect(svc.updateSettings(WS, MEMBER, { name: 'x' })).rejects.toMatchObject({
      status: 403,
    })
    await expect(svc.updateSettings(WS, VIEWER, { name: 'x' })).rejects.toMatchObject({
      status: 403,
    })
  })
})

describe('create', () => {
  it('创建者自动成为 owner', async () => {
    const ws = await svc.create(OWNER, { name: '新空间' })

    expect(await db.repos.workspaces.findMemberRole(ws.id, OWNER)).toBe('owner')
    expect(ws.defaultRole).toBe('edit')
  })

  it('可以指定默认角色', async () => {
    const ws = await svc.create(OWNER, { name: '只读空间', defaultRole: 'view' })
    expect(ws.defaultRole).toBe('view')
  })
})
