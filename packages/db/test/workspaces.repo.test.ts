import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { createTestDb, IDs, type TestDb } from './fixture.js'

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()
})

beforeEach(async () => {
  await db.reset()
  // 空间与节点都依赖用户存在
  for (const [id, name] of [
    [IDs.user, '所有者'],
    [IDs.user2, '成员'],
    [IDs.user3, '外部人'],
  ] as const) {
    await db.repos.users.create({
      id,
      email: `${id}@example.com`,
      passwordHash: 'hash',
      displayName: name,
    })
  }
})

afterAll(async () => {
  await db.close()
})

describe('WorkspacesRepository', () => {
  it('创建空间时创建者自动成为 owner', async () => {
    const ws = await db.repos.workspaces.create({
      id: IDs.workspace,
      name: '研发空间',
      ownerId: IDs.user,
    })

    expect(ws.name).toBe('研发空间')
    expect(ws.defaultRole).toBe('edit')

    // 关键：空间与 owner 成员必须原子创建，不能出现"空间存在但无 owner"
    const members = await db.repos.workspaces.listMembers(IDs.workspace)
    expect(members).toHaveLength(1)
    expect(members[0]?.userId).toBe(IDs.user)
    expect(members[0]?.role).toBe('owner')
  })

  it('可指定默认角色', async () => {
    const ws = await db.repos.workspaces.create({
      id: IDs.workspace,
      name: '只读空间',
      ownerId: IDs.user,
      defaultRole: 'view',
    })
    expect(ws.defaultRole).toBe('view')
  })

  it('按 id 查空间', async () => {
    await db.repos.workspaces.create({
      id: IDs.workspace,
      name: '研发空间',
      ownerId: IDs.user,
    })

    const found = await db.repos.workspaces.findById(IDs.workspace)
    expect(found?.name).toBe('研发空间')
    expect(await db.repos.workspaces.findById('nope')).toBeNull()
  })

  it('列出我参与的空间', async () => {
    await db.repos.workspaces.create({
      id: IDs.workspace,
      name: '我创建的',
      ownerId: IDs.user,
    })
    await db.repos.workspaces.create({
      id: 'w-2',
      name: '我被邀请的',
      ownerId: IDs.user2,
    })
    await db.repos.workspaces.upsertMember({
      workspaceId: 'w-2',
      userId: IDs.user,
      role: 'member',
    })

    const mine = await db.repos.workspaces.listForUser(IDs.user)
    expect(mine.map((w) => w.id).sort()).toEqual([IDs.workspace, 'w-2'].sort())

    // 非成员看不到
    const theirs = await db.repos.workspaces.listForUser(IDs.user3)
    expect(theirs).toHaveLength(0)
  })

  it('更新空间名称与默认角色', async () => {
    await db.repos.workspaces.create({
      id: IDs.workspace,
      name: '旧名',
      ownerId: IDs.user,
    })

    const updated = await db.repos.workspaces.update(IDs.workspace, {
      name: '新名',
      defaultRole: 'comment',
    })
    expect(updated.name).toBe('新名')
    expect(updated.defaultRole).toBe('comment')
  })

  it('添加成员与查询角色', async () => {
    await db.repos.workspaces.create({
      id: IDs.workspace,
      name: '研发空间',
      ownerId: IDs.user,
    })

    const member = await db.repos.workspaces.upsertMember({
      workspaceId: IDs.workspace,
      userId: IDs.user2,
      role: 'viewer',
    })
    expect(member.role).toBe('viewer')

    expect(await db.repos.workspaces.findMemberRole(IDs.workspace, IDs.user2)).toBe('viewer')
    expect(await db.repos.workspaces.findMemberRole(IDs.workspace, IDs.user3)).toBeNull()
  })

  it('重复添加成员是更新而非新增', async () => {
    await db.repos.workspaces.create({
      id: IDs.workspace,
      name: '研发空间',
      ownerId: IDs.user,
    })
    await db.repos.workspaces.upsertMember({
      workspaceId: IDs.workspace,
      userId: IDs.user2,
      role: 'viewer',
    })
    await db.repos.workspaces.upsertMember({
      workspaceId: IDs.workspace,
      userId: IDs.user2,
      role: 'admin',
    })

    const members = await db.repos.workspaces.listMembers(IDs.workspace)
    expect(members.filter((m) => m.userId === IDs.user2)).toHaveLength(1)
    expect(await db.repos.workspaces.findMemberRole(IDs.workspace, IDs.user2)).toBe('admin')
  })

  it('移除成员', async () => {
    await db.repos.workspaces.create({
      id: IDs.workspace,
      name: '研发空间',
      ownerId: IDs.user,
    })
    await db.repos.workspaces.upsertMember({
      workspaceId: IDs.workspace,
      userId: IDs.user2,
      role: 'member',
    })

    expect(await db.repos.workspaces.removeMember(IDs.workspace, IDs.user2)).toBe(true)
    expect(await db.repos.workspaces.findMemberRole(IDs.workspace, IDs.user2)).toBeNull()
    // 移除不存在的成员返回 false
    expect(await db.repos.workspaces.removeMember(IDs.workspace, IDs.user3)).toBe(false)
  })

  it('删除空间会级联删除成员', async () => {
    await db.repos.workspaces.create({
      id: IDs.workspace,
      name: '研发空间',
      ownerId: IDs.user,
    })
    await db.repos.workspaces.upsertMember({
      workspaceId: IDs.workspace,
      userId: IDs.user2,
      role: 'member',
    })

    await db.prisma.workspace.delete({ where: { id: IDs.workspace } })

    const members = await db.repos.workspaces.listMembers(IDs.workspace)
    expect(members).toHaveLength(0)
  })
})
