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
})

afterAll(async () => {
  await db.close()
})

/** 建一棵 folder → doc → child → grandchild 的树。 */
async function seedTree() {
  await db.repos.nodes.create({
    id: IDs.folder,
    workspaceId: IDs.workspace,
    type: 'folder',
    title: '设计稿',
    ownerId: IDs.user,
  })
  await db.repos.nodes.create({
    id: IDs.doc,
    workspaceId: IDs.workspace,
    parentId: IDs.folder,
    type: 'doc',
    title: '需求文档',
    ownerId: IDs.user,
  })
  await db.repos.nodes.create({
    id: IDs.child,
    workspaceId: IDs.workspace,
    parentId: IDs.doc,
    type: 'doc',
    title: '子文档',
    ownerId: IDs.user,
  })
  await db.repos.nodes.create({
    id: IDs.grandchild,
    workspaceId: IDs.workspace,
    parentId: IDs.child,
    type: 'doc',
    title: '孙文档',
    ownerId: IDs.user,
  })
}

describe('NodesRepository', () => {
  it('创建节点时标题归一化', async () => {
    const node = await db.repos.nodes.create({
      id: IDs.doc,
      workspaceId: IDs.workspace,
      type: 'doc',
      title: '  需求文档  ',
      ownerId: IDs.user,
    })

    expect(node.title).toBe('  需求文档  ')
    expect(node.titleNormalized).toBe('需求文档')
    expect(node.visibility).toBe('workspace')
    expect(node.parentId).toBeNull()
  })

  it('可创建私密节点', async () => {
    const node = await db.repos.nodes.create({
      id: IDs.doc,
      workspaceId: IDs.workspace,
      type: 'doc',
      title: '私密文档',
      ownerId: IDs.user,
      visibility: 'private',
    })
    expect(node.visibility).toBe('private')
  })

  it('改名会同步更新归一化标题', async () => {
    await db.repos.nodes.create({
      id: IDs.doc,
      workspaceId: IDs.workspace,
      type: 'doc',
      title: '旧标题',
      ownerId: IDs.user,
    })

    const updated = await db.repos.nodes.update(IDs.doc, { title: 'New Title' })
    expect(updated.title).toBe('New Title')
    expect(updated.titleNormalized).toBe('new title')
  })

  it('移动节点（改父级）', async () => {
    await seedTree()
    const moved = await db.repos.nodes.update(IDs.child, { parentId: IDs.folder })
    expect(moved.parentId).toBe(IDs.folder)

    const children = await db.repos.nodes.listChildIds(IDs.folder)
    expect(children.sort()).toEqual([IDs.child, IDs.doc].sort())
  })

  it('树查询只返回未删除节点', async () => {
    await seedTree()
    const tree = await db.repos.nodes.listTree(IDs.workspace)
    expect(tree).toHaveLength(4)

    await db.repos.nodes.update(IDs.child, { deletedAt: new Date() })
    const after = await db.repos.nodes.listTree(IDs.workspace)
    expect(after.map((n) => n.id)).not.toContain(IDs.child)
  })

  it('软删除会标记整个子树', async () => {
    await seedTree()
    const count = await db.repos.nodes.softDelete({
      id: IDs.doc,
      deletedAt: new Date(),
      deletedBy: IDs.user,
      trashRootId: IDs.doc,
    })

    // doc + child + grandchild
    expect(count).toBe(3)

    const trash = await db.repos.nodes.listTrash(IDs.workspace)
    expect(trash).toHaveLength(3)
    // trashRootId 统一，便于整批还原
    expect(trash.every((n) => n.trashRootId === IDs.doc)).toBe(true)
    expect(trash.every((n) => n.deletedBy === IDs.user)).toBe(true)
  })

  it('按 trashRootId 整批还原', async () => {
    await seedTree()
    await db.repos.nodes.softDelete({
      id: IDs.doc,
      deletedAt: new Date(),
      deletedBy: IDs.user,
      trashRootId: IDs.doc,
    })

    const restored = await db.repos.nodes.restore({
      trashRootId: IDs.doc,
      restoredAt: new Date(),
    })
    expect(restored).toBe(3)

    const trash = await db.repos.nodes.listTrash(IDs.workspace)
    expect(trash).toHaveLength(0)

    const tree = await db.repos.nodes.listTree(IDs.workspace)
    expect(tree).toHaveLength(4)
    expect(tree.every((n) => n.deletedAt === null)).toBe(true)
  })

  it('面包屑按根到近的顺序返回祖先', async () => {
    await seedTree()
    const ancestors = await db.repos.nodes.listAncestors(IDs.grandchild)
    expect(ancestors.map((n) => n.id)).toEqual([IDs.folder, IDs.doc, IDs.child])
  })

  it('根节点没有祖先', async () => {
    await seedTree()
    expect(await db.repos.nodes.listAncestors(IDs.folder)).toHaveLength(0)
  })

  it('按标题前缀搜索（大小写不敏感）', async () => {
    await seedTree()
    await db.repos.nodes.create({
      id: 'n-other',
      workspaceId: IDs.workspace,
      type: 'doc',
      title: '其他需求',
      ownerId: IDs.user,
    })

    // 语义是**前缀**匹配（架构文档 §5.2：title_norm 前缀匹配）。
    // 「需求文档」以「需求」开头 → 命中；
    // 「其他需求」不以「需求」开头 → 不命中。
    const found = await db.repos.nodes.searchByTitle(IDs.workspace, '需求')
    expect(found.map((n) => n.id)).toEqual([IDs.doc])
  })

  it('前缀匹配不命中词中间（不是包含匹配）', async () => {
    await db.repos.nodes.create({
      id: 'n-mid',
      workspaceId: IDs.workspace,
      type: 'doc',
      title: '这是一个包含需求的标题',
      ownerId: IDs.user,
    })

    const found = await db.repos.nodes.searchByTitle(IDs.workspace, '需求')
    expect(found).toHaveLength(0)
  })

  it('英文标题按前缀也能搜到', async () => {
    await db.repos.nodes.create({
      id: 'n-en',
      workspaceId: IDs.workspace,
      type: 'doc',
      title: 'Sprint Notes',
      ownerId: IDs.user,
    })

    const found = await db.repos.nodes.searchByTitle(IDs.workspace, 'sprint')
    expect(found.map((n) => n.id)).toEqual(['n-en'])
  })

  it('搜索不返回已删除节点', async () => {
    await seedTree()
    await db.repos.nodes.update(IDs.doc, { deletedAt: new Date() })

    const found = await db.repos.nodes.searchByTitle(IDs.workspace, '需求')
    expect(found.map((n) => n.id)).not.toContain(IDs.doc)
  })

  it('彻底删除节点会级联删除子树', async () => {
    await seedTree()

    const purged = await db.repos.nodes.purge(IDs.folder)
    expect(purged).toBe(true)

    const tree = await db.repos.nodes.listTree(IDs.workspace)
    expect(tree).toHaveLength(0)
  })

  it('删除不存在的节点返回 false', async () => {
    expect(await db.repos.nodes.purge('nope')).toBe(false)
  })
})
