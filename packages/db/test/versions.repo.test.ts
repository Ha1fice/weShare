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

const JSON_V1 = { type: 'doc', content: [{ type: 'paragraph' }] }

describe('VersionsRepository', () => {
  it('创建版本快照，版本号从 1 开始', async () => {
    const v = await db.repos.versions.create({
      id: 'v-1',
      nodeId: IDs.doc,
      kind: 'manual',
      label: '第一版',
      contentJson: JSON_V1,
      createdBy: IDs.user,
    })

    expect(v.versionNo).toBe(1)
    expect(v.kind).toBe('manual')
    expect(v.label).toBe('第一版')
    expect(v.contentSchemaVersion).toBe(1)
    expect(v.yjsSchemaVersion).toBe(1)
  })

  it('版本号递增', async () => {
    await db.repos.versions.create({
      id: 'v-1',
      nodeId: IDs.doc,
      kind: 'auto',
      contentJson: JSON_V1,
    })
    const v2 = await db.repos.versions.create({
      id: 'v-2',
      nodeId: IDs.doc,
      kind: 'auto',
      contentJson: JSON_V1,
    })

    expect(v2.versionNo).toBe(2)
  })

  it('nextVersionNo 反映当前最大版本号', async () => {
    expect(await db.repos.versions.nextVersionNo(IDs.doc)).toBe(1)

    await db.repos.versions.create({
      id: 'v-1',
      nodeId: IDs.doc,
      kind: 'auto',
      contentJson: JSON_V1,
    })
    expect(await db.repos.versions.nextVersionNo(IDs.doc)).toBe(2)
  })

  it('按版本号查快照', async () => {
    await db.repos.versions.create({
      id: 'v-1',
      nodeId: IDs.doc,
      kind: 'auto',
      contentJson: JSON_V1,
    })

    const found = await db.repos.versions.findByNo(IDs.doc, 1)
    expect(found?.id).toBe('v-1')
    expect(await db.repos.versions.findByNo(IDs.doc, 99)).toBeNull()
  })

  it('列出版本按版本号倒序', async () => {
    for (const i of [1, 2, 3]) {
      await db.repos.versions.create({
        id: `v-${i}`,
        nodeId: IDs.doc,
        kind: 'auto',
        contentJson: JSON_V1,
      })
    }

    const list = await db.repos.versions.listForNode(IDs.doc)
    expect(list.map((v) => v.versionNo)).toEqual([3, 2, 1])
  })

  it('裁剪自动快照：只保留最近的 N 个', async () => {
    for (const i of [1, 2, 3, 4, 5]) {
      await db.repos.versions.create({
        id: `v-${i}`,
        nodeId: IDs.doc,
        kind: 'auto',
        contentJson: JSON_V1,
      })
    }

    const removed = await db.repos.versions.pruneAutoVersions({
      nodeId: IDs.doc,
      keepCount: 2,
      keepManual: true,
    })

    expect(removed).toBe(3)
    const left = await db.repos.versions.listForNode(IDs.doc)
    expect(left.map((v) => v.versionNo)).toEqual([5, 4])
  })

  it('裁剪不影响手动快照', async () => {
    await db.repos.versions.create({
      id: 'v-auto-1',
      nodeId: IDs.doc,
      kind: 'auto',
      contentJson: JSON_V1,
    })
    await db.repos.versions.create({
      id: 'v-manual-1',
      nodeId: IDs.doc,
      kind: 'manual',
      contentJson: JSON_V1,
    })
    await db.repos.versions.create({
      id: 'v-auto-2',
      nodeId: IDs.doc,
      kind: 'auto',
      contentJson: JSON_V1,
    })

    await db.repos.versions.pruneAutoVersions({
      nodeId: IDs.doc,
      keepCount: 1,
      keepManual: true,
    })

    const left = await db.repos.versions.listForNode(IDs.doc)
    const kinds = left.map((v) => v.kind).sort()
    expect(kinds).toEqual(['auto', 'manual'])
  })

  it('没有多余快照时裁剪返回 0', async () => {
    await db.repos.versions.create({
      id: 'v-1',
      nodeId: IDs.doc,
      kind: 'auto',
      contentJson: JSON_V1,
    })

    const removed = await db.repos.versions.pruneAutoVersions({
      nodeId: IDs.doc,
      keepCount: 5,
      keepManual: true,
    })
    expect(removed).toBe(0)
  })

  it('删除节点会级联删除版本', async () => {
    await db.repos.versions.create({
      id: 'v-1',
      nodeId: IDs.doc,
      kind: 'auto',
      contentJson: JSON_V1,
    })

    await db.prisma.node.delete({ where: { id: IDs.doc } })

    expect(await db.repos.versions.listForNode(IDs.doc)).toHaveLength(0)
  })
})
