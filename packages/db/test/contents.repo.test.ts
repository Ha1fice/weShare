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

const PM_JSON = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }] }

describe('ContentsRepository', () => {
  it('创建正文', async () => {
    const content = await db.repos.contents.create({
      nodeId: IDs.doc,
      contentJson: PM_JSON,
    })

    expect(content.nodeId).toBe(IDs.doc)
    expect(content.revision).toBe(0)
    expect(content.contentSchemaVersion).toBe(1)
    expect(content.yjsSchemaVersion).toBe(1)
    expect(content.storedAt).toBeNull()
    expect(content.contentJson).toEqual(PM_JSON)
  })

  it('查不存在的正文返回 null', async () => {
    expect(await db.repos.contents.findByNodeId('nope')).toBeNull()
  })

  it('保存正文会让 revision 递增', async () => {
    await db.repos.contents.create({ nodeId: IDs.doc, contentJson: PM_JSON })

    const saved = await db.repos.contents.save({
      nodeId: IDs.doc,
      contentJson: { type: 'doc', content: [] },
      textPreview: '正文',
      charCount: 2,
    })

    expect(saved.revision).toBe(1)
    expect(saved.textPreview).toBe('正文')
    expect(saved.charCount).toBe(2)
  })

  it('乐观锁：版本不匹配时抛错', async () => {
    await db.repos.contents.create({ nodeId: IDs.doc, contentJson: PM_JSON })

    // 期望 revision=0 时成功
    await db.repos.contents.save({
      nodeId: IDs.doc,
      contentJson: PM_JSON,
      expectedRevision: 0,
    })

    // 再用 revision=0 保存 → 必须抛错（对应上层转 409）
    await expect(
      db.repos.contents.save({
        nodeId: IDs.doc,
        contentJson: PM_JSON,
        expectedRevision: 0,
      }),
    ).rejects.toThrow(/版本冲突/)
  })

  it('乐观锁：正文不存在时抛错', async () => {
    await expect(
      db.repos.contents.save({
        nodeId: 'nope',
        contentJson: PM_JSON,
        expectedRevision: 0,
      }),
    ).rejects.toThrow(/正文不存在/)
  })

  it('协同落库会写 storedAt 且不动 revision', async () => {
    await db.repos.contents.create({ nodeId: IDs.doc, contentJson: PM_JSON })

    const yjsState = new Uint8Array([1, 2, 3, 4])
    const { claimed } = await db.repos.contents.saveCollaborative({
      nodeId: IDs.doc,
      yjsState,
      stateVector: new Uint8Array([9]),
      textPreview: '协同内容',
      charCount: 4,
      docSizeBytes: 4,
    })
    const saved = (await db.repos.contents.findByNodeId(IDs.doc))!

    expect(claimed).toBe(true)
    expect(saved.storedAt).not.toBeNull()
    // 协同路径不参与单机乐观锁，不递增 revision
    expect(saved.revision).toBe(0)
    expect(saved.yjsState).toEqual(yjsState)
    expect(saved.stateVector).toEqual(new Uint8Array([9]))
    expect(saved.docSizeBytes).toBe(4)
  })

  it('字节字段可以写 null 清空', async () => {
    await db.repos.contents.create({ nodeId: IDs.doc, contentJson: PM_JSON })
    await db.repos.contents.saveCollaborative({
      nodeId: IDs.doc,
      yjsState: new Uint8Array([1]),
    })

    await db.repos.contents.saveCollaborative({
      nodeId: IDs.doc,
      yjsState: null,
    })
    expect((await db.repos.contents.findByNodeId(IDs.doc))!.yjsState).toBeNull()
  })

  it('删除节点会级联删除正文', async () => {
    await db.repos.contents.create({ nodeId: IDs.doc, contentJson: PM_JSON })

    await db.prisma.node.delete({ where: { id: IDs.doc } })

    expect(await db.repos.contents.findByNodeId(IDs.doc)).toBeNull()
  })
})
