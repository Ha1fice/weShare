import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { createTestDb, IDs, type TestDb } from './fixture.js'

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()
})

beforeEach(async () => {
  await db.reset()
  for (const [id, name] of [
    [IDs.user, '所有者'],
    [IDs.user2, '被授权人'],
  ] as const) {
    await db.repos.users.create({
      id,
      email: `${id}@example.com`,
      passwordHash: 'hash',
      displayName: name,
    })
  }
  await db.repos.workspaces.create({
    id: IDs.workspace,
    name: '研发空间',
    ownerId: IDs.user,
  })
  await db.repos.nodes.create({
    id: IDs.doc,
    workspaceId: IDs.workspace,
    type: 'doc',
    title: '需求文档',
    ownerId: IDs.user,
  })
})

afterAll(async () => {
  await db.close()
})

describe('AclRepository', () => {
  it('新增授权规则', async () => {
    const entry = await db.repos.acl.upsert({
      id: 'acl-1',
      nodeId: IDs.doc,
      subjectType: 'user',
      subjectId: IDs.user2,
      role: 'edit',
      createdBy: IDs.user,
    })

    expect(entry.role).toBe('edit')
    expect(entry.effect).toBe('allow')
    expect(entry.subjectType).toBe('user')
  })

  it('默认是 allow 效果', async () => {
    const entry = await db.repos.acl.upsert({
      id: 'acl-1',
      nodeId: IDs.doc,
      subjectType: 'user',
      subjectId: IDs.user2,
      role: 'view',
      createdBy: IDs.user,
    })
    expect(entry.effect).toBe('allow')
  })

  it('可以设置 deny 降权', async () => {
    const entry = await db.repos.acl.upsert({
      id: 'acl-1',
      nodeId: IDs.doc,
      subjectType: 'user',
      subjectId: IDs.user2,
      role: 'view',
      effect: 'deny',
      createdBy: IDs.user,
    })
    expect(entry.effect).toBe('deny')
  })

  it('同一节点同一主体重复授权是覆盖而非新增', async () => {
    await db.repos.acl.upsert({
      id: 'acl-1',
      nodeId: IDs.doc,
      subjectType: 'user',
      subjectId: IDs.user2,
      role: 'view',
      createdBy: IDs.user,
    })
    await db.repos.acl.upsert({
      id: 'acl-2',
      nodeId: IDs.doc,
      subjectType: 'user',
      subjectId: IDs.user2,
      role: 'manage',
      createdBy: IDs.user,
    })

    const list = await db.repos.acl.listForNode(IDs.doc)
    expect(list).toHaveLength(1)
    expect(list[0]?.role).toBe('manage')
    // id 保持首次创建的值——upsert 的 update 分支不改主键
    expect(list[0]?.id).toBe('acl-1')
  })

  it('列出节点的全部规则', async () => {
    await db.repos.acl.upsert({
      id: 'acl-1',
      nodeId: IDs.doc,
      subjectType: 'user',
      subjectId: IDs.user2,
      role: 'edit',
      createdBy: IDs.user,
    })
    await db.repos.acl.upsert({
      id: 'acl-2',
      nodeId: IDs.doc,
      subjectType: 'workspace',
      subjectId: IDs.workspace,
      role: 'view',
      createdBy: IDs.user,
    })

    const list = await db.repos.acl.listForNode(IDs.doc)
    expect(list).toHaveLength(2)
  })

  it('按主体查询：同时命中用户与空间两类主体', async () => {
    await db.repos.acl.upsert({
      id: 'acl-user',
      nodeId: IDs.doc,
      subjectType: 'user',
      subjectId: IDs.user2,
      role: 'edit',
      createdBy: IDs.user,
    })
    await db.repos.acl.upsert({
      id: 'acl-ws',
      nodeId: IDs.doc,
      subjectType: 'workspace',
      subjectId: IDs.workspace,
      role: 'view',
      createdBy: IDs.user,
    })
    await db.repos.acl.upsert({
      id: 'acl-other',
      nodeId: IDs.doc,
      subjectType: 'user',
      subjectId: IDs.user3,
      role: 'manage',
      createdBy: IDs.user,
    })

    const list = await db.repos.acl.listForSubjects(IDs.doc, IDs.user2, IDs.workspace)
    expect(list.map((e) => e.id).sort()).toEqual(['acl-user', 'acl-ws'].sort())
  })

  it('撤销授权', async () => {
    await db.repos.acl.upsert({
      id: 'acl-1',
      nodeId: IDs.doc,
      subjectType: 'user',
      subjectId: IDs.user2,
      role: 'edit',
      createdBy: IDs.user,
    })

    expect(await db.repos.acl.remove(IDs.doc, 'acl-1')).toBe(true)
    expect(await db.repos.acl.listForNode(IDs.doc)).toHaveLength(0)
    // 撤销不存在的返回 false
    expect(await db.repos.acl.remove(IDs.doc, 'acl-nope')).toBe(false)
  })

  it('撤销不能跨节点（aclId 必须属于该节点）', async () => {
    await db.repos.acl.upsert({
      id: 'acl-1',
      nodeId: IDs.doc,
      subjectType: 'user',
      subjectId: IDs.user2,
      role: 'edit',
      createdBy: IDs.user,
    })

    expect(await db.repos.acl.remove('n-other-node', 'acl-1')).toBe(false)
    expect(await db.repos.acl.listForNode(IDs.doc)).toHaveLength(1)
  })

  it('删除节点会级联删除授权规则', async () => {
    await db.repos.acl.upsert({
      id: 'acl-1',
      nodeId: IDs.doc,
      subjectType: 'user',
      subjectId: IDs.user2,
      role: 'edit',
      createdBy: IDs.user,
    })

    await db.prisma.node.delete({ where: { id: IDs.doc } })

    expect(await db.repos.acl.listForNode(IDs.doc)).toHaveLength(0)
  })
})
