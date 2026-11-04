import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { createTestDb, IDs, type TestDb } from './fixture.js'

let db: TestDb

beforeAll(async () => {
  db = await createTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.repos.users.create({
    id: IDs.user,
    email: 'owner@example.com',
    passwordHash: 'hash',
    displayName: '所有者',
  })
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

describe('AttachmentsRepository', () => {
  it('创建附件', async () => {
    const att = await db.repos.attachments.create({
      id: 'att-1',
      workspaceId: IDs.workspace,
      nodeId: IDs.doc,
      uploaderId: IDs.user,
      originalName: '截图.png',
      mimeType: 'image/png',
      byteSize: 1024,
      sha256: 'abc123',
      storageKey: 'ws/2026/11/att-1.png',
      width: 800,
      height: 600,
    })

    expect(att.originalName).toBe('截图.png')
    expect(att.storageKey).toBe('ws/2026/11/att-1.png')
    expect(att.width).toBe(800)
    expect(att.height).toBe(600)
  })

  it('附件可以暂不关联节点', async () => {
    const att = await db.repos.attachments.create({
      id: 'att-1',
      workspaceId: IDs.workspace,
      uploaderId: IDs.user,
      originalName: 'a.png',
      mimeType: 'image/png',
      byteSize: 1,
      sha256: 'x',
      storageKey: 'k',
    })

    expect(att.nodeId).toBeNull()
  })

  it('按 id 与 storageKey 查附件', async () => {
    await db.repos.attachments.create({
      id: 'att-1',
      workspaceId: IDs.workspace,
      nodeId: IDs.doc,
      uploaderId: IDs.user,
      originalName: 'a.png',
      mimeType: 'image/png',
      byteSize: 1,
      sha256: 'x',
      storageKey: 'unique-key',
    })

    expect((await db.repos.attachments.findById('att-1'))?.storageKey).toBe('unique-key')
    expect((await db.repos.attachments.findByStorageKey('unique-key'))?.id).toBe('att-1')
    expect(await db.repos.attachments.findById('nope')).toBeNull()
  })

  it('关联与解除关联节点', async () => {
    await db.repos.attachments.create({
      id: 'att-1',
      workspaceId: IDs.workspace,
      uploaderId: IDs.user,
      originalName: 'a.png',
      mimeType: 'image/png',
      byteSize: 1,
      sha256: 'x',
      storageKey: 'k',
    })

    const attached = await db.repos.attachments.attachToNode('att-1', IDs.doc)
    expect(attached.nodeId).toBe(IDs.doc)

    expect(await db.repos.attachments.detachFromNode('att-1')).toBe(true)
    const detached = await db.repos.attachments.findById('att-1')
    expect(detached?.nodeId).toBeNull()
  })

  it('删除节点后附件保留但解除关联（ON DELETE SET NULL）', async () => {
    await db.repos.attachments.create({
      id: 'att-1',
      workspaceId: IDs.workspace,
      nodeId: IDs.doc,
      uploaderId: IDs.user,
      originalName: 'a.png',
      mimeType: 'image/png',
      byteSize: 1,
      sha256: 'x',
      storageKey: 'k',
    })

    await db.prisma.node.delete({ where: { id: IDs.doc } })

    const att = await db.repos.attachments.findById('att-1')
    expect(att).not.toBeNull()
    expect(att?.nodeId).toBeNull()
  })

  it('删除空间会级联删除附件', async () => {
    await db.repos.attachments.create({
      id: 'att-1',
      workspaceId: IDs.workspace,
      uploaderId: IDs.user,
      originalName: 'a.png',
      mimeType: 'image/png',
      byteSize: 1,
      sha256: 'x',
      storageKey: 'k',
    })

    await db.prisma.workspace.delete({ where: { id: IDs.workspace } })

    expect(await db.repos.attachments.findById('att-1')).toBeNull()
  })
})

describe('AuditRepository', () => {
  it('记录审计事件', async () => {
    const event = await db.repos.audit.create({
      workspaceId: IDs.workspace,
      actorId: IDs.user,
      action: 'node.create',
      targetType: 'node',
      targetId: IDs.doc,
      metadata: { title: '需求文档' },
    })

    expect(event.action).toBe('node.create')
    expect(event.targetType).toBe('node')
    expect(event.targetId).toBe(IDs.doc)
    expect(event.metadata).toEqual({ title: '需求文档' })
    expect(typeof event.id).toBe('number')
  })

  it('metadata 缺省为空对象', async () => {
    const event = await db.repos.audit.create({
      workspaceId: IDs.workspace,
      action: 'node.create',
      targetType: 'node',
    })
    expect(event.metadata).toEqual({})
    expect(event.actorId).toBeNull()
  })

  it('自增主键递增', async () => {
    const a = await db.repos.audit.create({
      workspaceId: IDs.workspace,
      action: 'a',
      targetType: 'node',
    })
    const b = await db.repos.audit.create({
      workspaceId: IDs.workspace,
      action: 'b',
      targetType: 'node',
    })
    expect(b.id).toBeGreaterThan(a.id)
  })

  it('按空间分页查询，按时间倒序', async () => {
    for (const action of ['a', 'b', 'c']) {
      await db.repos.audit.create({
        workspaceId: IDs.workspace,
        action,
        targetType: 'node',
      })
    }

    const page1 = await db.repos.audit.listForWorkspace({
      workspaceId: IDs.workspace,
      limit: 2,
    })
    expect(page1).toHaveLength(2)

    const page2 = await db.repos.audit.listForWorkspace({
      workspaceId: IDs.workspace,
      limit: 2,
      offset: 2,
    })
    expect(page2).toHaveLength(1)
    expect(page2[0]?.action).toBe('a')
  })

  it('不返回其他空间的事件', async () => {
    await db.repos.audit.create({
      workspaceId: IDs.workspace,
      action: 'a',
      targetType: 'node',
    })

    const other = await db.repos.audit.listForWorkspace({
      workspaceId: 'w-other',
      limit: 10,
    })
    expect(other).toHaveLength(0)
  })
})
