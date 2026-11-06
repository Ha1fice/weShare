import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { clearTables, createTestDatabase } from '@weshare/db/test-support'
import type { DbHandle } from '@weshare/db'
import { NodeService } from '../src/domain/node-service.js'

let db: DbHandle
let dbPath: string
let svc: NodeService

const OWNER = 'u-owner'
const ADMIN = 'u-admin'
const MEMBER = 'u-member'
const VIEWER = 'u-viewer'
const OUTSIDER = 'u-outsider'
const WS = 'w-1'
const WS2 = 'w-2'

beforeAll(async () => {
  const created = await createTestDatabase()
  db = created.db
  dbPath = created.dbPath
  svc = new NodeService({ repos: db.repos })
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

  await db.repos.workspaces.create({ id: WS, name: '空间一', ownerId: OWNER })
  await db.repos.workspaces.upsertMember({ workspaceId: WS, userId: ADMIN, role: 'admin' })
  await db.repos.workspaces.upsertMember({ workspaceId: WS, userId: MEMBER, role: 'member' })
  await db.repos.workspaces.upsertMember({ workspaceId: WS, userId: VIEWER, role: 'viewer' })

  // 第二个空间（用于跨空间隔离）
  await db.repos.workspaces.create({ id: WS2, name: '空间二', ownerId: OUTSIDER })
})

afterAll(async () => {
  await db.close()
})

/** 建一个文件夹（用 owner 身份，走服务校验）。 */
async function makeFolder(title: string, parentId: string | null = null): Promise<string> {
  const r = await svc.createNode(OWNER, { workspaceId: WS, parentId, type: 'folder', title })
  return r.node.id
}

/** 建一个文档。 */
async function makeDoc(title: string, parentId: string | null = null): Promise<string> {
  const r = await svc.createNode(OWNER, { workspaceId: WS, parentId, type: 'doc', title })
  return r.node.id
}

describe('创建节点', () => {
  it('owner 可以在根级创建文件夹', async () => {
    const { node, role } = await svc.createNode(OWNER, {
      workspaceId: WS,
      type: 'folder',
      title: '设计稿',
    })

    expect(node.type).toBe('folder')
    expect(node.title).toBe('设计稿')
    expect(node.parentId).toBeNull()
    expect(role).toBe('manage')
  })

  it('创建文档时会同时建立正文行', async () => {
    const { node } = await svc.createNode(OWNER, {
      workspaceId: WS,
      type: 'doc',
      title: '需求文档',
    })

    // 关键不变式：doc 节点必有正文
    const content = await db.repos.contents.findByNodeId(node.id)
    expect(content).not.toBeNull()
    expect(content?.contentSchemaVersion).toBe(1)
    expect(content?.contentJson).toMatchObject({ type: 'doc' })
  })

  it('viewer 不能在根级创建（403）', async () => {
    await expect(
      svc.createNode(VIEWER, { workspaceId: WS, type: 'doc', title: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })

  it('非成员不能创建（404，不泄露空间存在）', async () => {
    await expect(
      svc.createNode(OUTSIDER, { workspaceId: WS, type: 'doc', title: 'x' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('member 可以在根级创建（默认角色 edit）', async () => {
    const { node } = await svc.createNode(MEMBER, {
      workspaceId: WS,
      type: 'doc',
      title: '成员建的',
    })
    expect(node.ownerId).toBe(MEMBER)
  })

  it('空间默认角色为 view 时 member 不能在根级创建', async () => {
    await db.repos.workspaces.update(WS, { defaultRole: 'view' })

    await expect(
      svc.createNode(MEMBER, { workspaceId: WS, type: 'doc', title: 'x' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('可以在文件夹下创建文档', async () => {
    const folderId = await makeFolder('目录')
    const { node } = await svc.createNode(OWNER, {
      workspaceId: WS,
      parentId: folderId,
      type: 'doc',
      title: '子文档',
    })
    expect(node.parentId).toBe(folderId)
  })

  it('不能在文档下创建节点（422）', async () => {
    const docId = await makeDoc('文档')
    await expect(
      svc.createNode(OWNER, { workspaceId: WS, parentId: docId, type: 'doc', title: 'x' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 })
  })

  it('不能在回收站中的目录下创建', async () => {
    const folderId = await makeFolder('目录')
    await svc.softDelete(OWNER, folderId)

    await expect(
      svc.createNode(OWNER, { workspaceId: WS, parentId: folderId, type: 'doc', title: 'x' }),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('跨空间挂载被拒绝（404）', async () => {
    // WS2 的目录
    const otherFolder = await svc.createNode(OUTSIDER, {
      workspaceId: WS2,
      type: 'folder',
      title: '别人的目录',
    })

    await expect(
      svc.createNode(OWNER, {
        workspaceId: WS,
        parentId: otherFolder.node.id,
        type: 'doc',
        title: 'x',
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('深度超过 8 层被拒绝', async () => {
    // 建 8 层（根算第 1 层）
    let parentId: string | null = null
    for (let i = 1; i <= 8; i++) {
      const r = await svc.createNode(OWNER, {
        workspaceId: WS,
        parentId,
        type: 'folder',
        title: `第 ${i} 层`,
      })
      parentId = r.node.id
    }

    // 第 9 层应被拒绝
    await expect(
      svc.createNode(OWNER, { workspaceId: WS, parentId, type: 'folder', title: '第 9 层' }),
    ).rejects.toMatchObject({ status: 422 })
  })
})

describe('读取与权限', () => {
  it('owner 能读自己创建的文档', async () => {
    const docId = await makeDoc('文档')
    const { node, role } = await svc.getNode(docId, OWNER)
    expect(node.id).toBe(docId)
    expect(role).toBe('manage')
  })

  it('非成员读别人的文档返回 404', async () => {
    const docId = await makeDoc('文档')
    await expect(svc.getNode(docId, OUTSIDER)).rejects.toMatchObject({ status: 404 })
  })

  it('不存在的节点返回 404', async () => {
    await expect(svc.getNode('n-nope', OWNER)).rejects.toMatchObject({ status: 404 })
  })

  it('workspace 可见的文档，viewer 可读', async () => {
    const docId = await makeDoc('公开文档')
    const { role } = await svc.getNode(docId, VIEWER)
    expect(role).toBe('view')
  })

  it('私密文档：同空间 member 读不到（404）', async () => {
    const r = await svc.createNode(OWNER, {
      workspaceId: WS,
      type: 'doc',
      title: '私密',
      visibility: 'private',
    })

    await expect(svc.getNode(r.node.id, MEMBER)).rejects.toMatchObject({ status: 404 })
  })

  it('私密文档：空间 admin 也不因管理身份获得访问（404）', async () => {
    const r = await svc.createNode(OWNER, {
      workspaceId: WS,
      type: 'doc',
      title: '私密',
      visibility: 'private',
    })

    // 这是架构文档 §8.1 明确要求的边界：admin 不自动获得私密文档权限
    await expect(svc.getNode(r.node.id, ADMIN)).rejects.toMatchObject({ status: 404 })
  })

  it('私密文档：显式 ACL 授权后可读', async () => {
    const r = await svc.createNode(OWNER, {
      workspaceId: WS,
      type: 'doc',
      title: '私密',
      visibility: 'private',
    })

    await db.repos.acl.upsert({
      id: 'acl-1',
      nodeId: r.node.id,
      subjectType: 'user',
      subjectId: MEMBER,
      role: 'view',
      createdBy: OWNER,
    })

    const { role } = await svc.getNode(r.node.id, MEMBER)
    expect(role).toBe('view')
  })
})

describe('目录树', () => {
  it('树只包含可读节点', async () => {
    await makeFolder('公开目录')
    await svc.createNode(OWNER, {
      workspaceId: WS,
      type: 'doc',
      title: '私密文档',
      visibility: 'private',
    })

    const tree = await svc.listTree(WS, MEMBER)
    // member 看不到私密文档
    expect(tree.map((n) => n.title)).not.toContain('私密文档')
    expect(tree.map((n) => n.title)).toContain('公开目录')
  })

  it('owner 能看到自己的私密文档', async () => {
    await svc.createNode(OWNER, {
      workspaceId: WS,
      type: 'doc',
      title: '私密文档',
      visibility: 'private',
    })

    const tree = await svc.listTree(WS, OWNER)
    expect(tree.map((n) => n.title)).toContain('私密文档')
  })

  it('hasChildren 反映是否有可读子节点', async () => {
    const folderId = await makeFolder('有内容的目录')
    await svc.createNode(OWNER, {
      workspaceId: WS,
      parentId: folderId,
      type: 'doc',
      title: '子文档',
    })

    const tree = await svc.listTree(WS, OWNER)
    const folder = tree.find((n) => n.id === folderId)
    expect(folder?.hasChildren).toBe(true)
  })

  it('回收站中的节点不出现在树里', async () => {
    const docId = await makeDoc('将被删除')
    await svc.softDelete(OWNER, docId)

    const tree = await svc.listTree(WS, OWNER)
    expect(tree.map((n) => n.id)).not.toContain(docId)
  })

  it('非成员看不到任何节点（404）', async () => {
    await makeFolder('目录')
    await expect(svc.listTree(WS, OUTSIDER)).rejects.toMatchObject({ status: 404 })
  })

  it('子节点可读但父节点不可读时，子节点挂到根级（不消失）', async () => {
    // owner 建私密目录 + 公开子文档
    const privateFolder = await svc.createNode(OWNER, {
      workspaceId: WS,
      type: 'folder',
      title: '私密目录',
      visibility: 'private',
    })
    const child = await svc.createNode(OWNER, {
      workspaceId: WS,
      parentId: privateFolder.node.id,
      type: 'doc',
      title: '子文档',
      visibility: 'workspace',
    })

    // 给 member 授权子文档
    await db.repos.acl.upsert({
      id: 'acl-child',
      nodeId: child.node.id,
      subjectType: 'user',
      subjectId: MEMBER,
      role: 'view',
      createdBy: OWNER,
    })

    const tree = await svc.listTree(WS, MEMBER)
    const visible = tree.find((n) => n.id === child.node.id)

    // 子文档可见，但父节点不可见 → 挂到根级
    expect(visible).toBeDefined()
    expect(visible?.parentId).toBeNull()
    expect(tree.map((n) => n.id)).not.toContain(privateFolder.node.id)
  })
})

describe('改名与可见性', () => {
  it('owner 改自己的节点标题', async () => {
    const docId = await makeDoc('旧标题')
    const { node } = await svc.updateNode(OWNER, docId, { title: '新标题' })
    expect(node.title).toBe('新标题')
    expect(node.titleNormalized).toBe('新标题')
  })

  it('viewer 不能改名（403）', async () => {
    const docId = await makeDoc('文档')
    await expect(
      svc.updateNode(VIEWER, docId, { title: 'viewer 改的' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('可以改可见性', async () => {
    const docId = await makeDoc('文档')
    const { node } = await svc.updateNode(OWNER, docId, { visibility: 'private' })
    expect(node.visibility).toBe('private')
  })

  it('owner 可以改自己节点的可见性', async () => {
    const r = await svc.createNode(MEMBER, { workspaceId: WS, type: 'doc', title: 'member 的文档' })
    const { node } = await svc.updateNode(MEMBER, r.node.id, { visibility: 'private' })
    expect(node.visibility).toBe('private')
  })

  it('member 不能把别人的公开文档改成私密（权限提升）', async () => {
    const docId = await makeDoc('owner 的文档')
    await expect(
      svc.updateNode(MEMBER, docId, { visibility: 'private' }),
    ).rejects.toMatchObject({ status: 403 })

    // 状态未被改动，owner 仍然读得到
    const { node } = await svc.getNode(docId, OWNER)
    expect(node.visibility).toBe('workspace')
  })

  it('空间 admin 也不因管理身份获得他人私密文档的权限（§8.1）', async () => {
    const docId = await makeDoc('owner 的文档')
    const { node } = await svc.updateNode(OWNER, docId, { visibility: 'private' })
    expect(node.visibility).toBe('private')
    // admin 对他人私密文档不因管理身份获得访问
    await expect(svc.getNode(docId, ADMIN)).rejects.toMatchObject({ status: 404 })
  })

  it('member 仍可改他人公开文档的标题（改名不受影响）', async () => {
    const docId = await makeDoc('旧标题')
    const { node } = await svc.updateNode(MEMBER, docId, { title: '新标题' })
    expect(node.title).toBe('新标题')
  })
})

describe('移动', () => {
  it('owner 可以把文档移到另一个目录', async () => {
    const folderId = await makeFolder('目标目录')
    const docId = await makeDoc('文档')

    const { node } = await svc.moveNode(OWNER, docId, folderId)
    expect(node.parentId).toBe(folderId)
  })

  it('可以移到根级', async () => {
    const folderId = await makeFolder('目录')
    const docId = await makeDoc('文档', folderId)

    const { node } = await svc.moveNode(OWNER, docId, null)
    expect(node.parentId).toBeNull()
  })

  it('不能移动到自身下（422）', async () => {
    const folderId = await makeFolder('目录')
    await expect(svc.moveNode(OWNER, folderId, folderId)).rejects.toMatchObject({
      status: 422,
    })
  })

  it('不能移动到自己的子孙下（422）', async () => {
    const a = await makeFolder('A')
    const b = await makeFolder('B', a)

    await expect(svc.moveNode(OWNER, a, b)).rejects.toMatchObject({ status: 422 })
  })

  it('没有目标父级权限时拒绝移动（403）', async () => {
    // owner 建一个私密目录；member 无法编辑它
    const privateFolder = await svc.createNode(OWNER, {
      workspaceId: WS,
      type: 'folder',
      title: '私密目录',
      visibility: 'private',
    })
    // member 建自己的文档
    const memberDoc = await svc.createNode(MEMBER, {
      workspaceId: WS,
      type: 'doc',
      title: 'member 的文档',
    })

    // 这是架构文档 §8.3 明确要求的校验：权限不继承，
    // "能编辑自己的文档"不等于"能把文档放进别人的私密目录"
    await expect(
      svc.moveNode(MEMBER, memberDoc.node.id, privateFolder.node.id),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('不能移动到文档下（422）', async () => {
    const doc1 = await makeDoc('文档1')
    const doc2 = await makeDoc('文档2')

    await expect(svc.moveNode(OWNER, doc1, doc2)).rejects.toMatchObject({ status: 422 })
  })

  it('不能跨空间移动（404）', async () => {
    const otherFolder = await svc.createNode(OUTSIDER, {
      workspaceId: WS2,
      type: 'folder',
      title: '别空间的目录',
    })
    const docId = await makeDoc('文档')

    await expect(
      svc.moveNode(OWNER, docId, otherFolder.node.id),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('移动后总深度超过上限被拒绝', async () => {
    // 建一条 5 层链
    let deep: string | null = null
    for (let i = 1; i <= 5; i++) {
      const r = await svc.createNode(OWNER, {
        workspaceId: WS,
        parentId: deep,
        type: 'folder',
        title: `深 ${i}`,
      })
      deep = r.node.id
    }

    // 再建一条 4 层链
    let other: string | null = null
    for (let i = 1; i <= 4; i++) {
      const r = await svc.createNode(OWNER, {
        workspaceId: WS,
        parentId: other,
        type: 'folder',
        title: `另 ${i}`,
      })
      other = r.node.id
    }

    // 把 5 层链的根移到 4 层链末端 → 总深度 4+5=9 > 8
    const rootOfDeep = (await db.repos.nodes.listAncestors(deep!))[0]
    await expect(
      svc.moveNode(OWNER, rootOfDeep!.id, other),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('回收站中的节点不能移动', async () => {
    const docId = await makeDoc('文档')
    await svc.softDelete(OWNER, docId)

    await expect(svc.moveNode(OWNER, docId, null)).rejects.toMatchObject({ status: 422 })
  })
})

describe('删除与还原', () => {
  it('软删除标记整个子树', async () => {
    const folderId = await makeFolder('目录')
    const childId = await makeDoc('子文档', folderId)

    const { affected } = await svc.softDelete(OWNER, folderId)
    expect(affected).toBe(2)

    // 两个都进回收站，trashRootId 一致
    const trash = await svc.listTrash(WS, OWNER)
    expect(trash.map((n) => n.id).sort()).toEqual([folderId, childId].sort())
    expect(trash.every((n) => n.trashRootId === folderId)).toBe(true)
  })

  it('viewer 不能删除（403）', async () => {
    const docId = await makeDoc('文档')
    await expect(svc.softDelete(VIEWER, docId)).rejects.toMatchObject({ status: 403 })
  })

  it('非成员不能删除（404）', async () => {
    const docId = await makeDoc('文档')
    await expect(svc.softDelete(OUTSIDER, docId)).rejects.toMatchObject({ status: 404 })
  })

  it('重复删除返回 422', async () => {
    const docId = await makeDoc('文档')
    await svc.softDelete(OWNER, docId)
    await expect(svc.softDelete(OWNER, docId)).rejects.toMatchObject({ status: 422 })
  })

  it('还原整批（含子树）', async () => {
    const folderId = await makeFolder('目录')
    await makeDoc('子文档', folderId)
    await svc.softDelete(OWNER, folderId)

    const { affected } = await svc.restore(OWNER, folderId)
    expect(affected).toBe(2)

    const trash = await svc.listTrash(WS, OWNER)
    expect(trash).toHaveLength(0)
  })

  it('还原不在回收站的节点返回 422', async () => {
    const docId = await makeDoc('文档')
    await expect(svc.restore(OWNER, docId)).rejects.toMatchObject({ status: 422 })
  })

  it('软删除父目录后，子文档随整批一起还原', async () => {
    const folderId = await makeFolder('目录')
    const childId = await makeDoc('子文档', folderId)

    // 删父目录 → 子树整批进回收站（trashRootId 统一为父目录）
    await svc.softDelete(OWNER, folderId)

    const trashBefore = await svc.listTrash(WS, OWNER)
    expect(trashBefore.map((n) => n.id).sort()).toEqual([folderId, childId].sort())

    // 还原父目录 → 子文档一起回来，不会悬空
    await svc.restore(OWNER, folderId)

    const child = await db.repos.nodes.findById(childId)
    expect(child?.deletedAt).toBeNull()
    expect(child?.parentId).toBe(folderId)
  })

  it('回收站里只有 manage 权限者可见', async () => {
    const docId = await makeDoc('文档')
    await svc.softDelete(OWNER, docId)

    // viewer 进入回收站，看不到任何东西（不是报错，是空列表）
    const trash = await svc.listTrash(WS, VIEWER)
    expect(trash).toHaveLength(0)

    // owner 能看到
    const ownerTrash = await svc.listTrash(WS, OWNER)
    expect(ownerTrash).toHaveLength(1)
  })

  it('整批计数在权限过滤前聚合：根可见、子项不可见时 batchSize 仍是整批', async () => {
    const folderId = await makeFolder('目录')
    const secretId = await makeDoc('私密文档', folderId)
    await svc.updateNode(OWNER, secretId, { visibility: 'private' })
    // admin 只有目录本身的 manage（ACL 不涉及子项）——这就是"根可见、子项不可见"
    await db.repos.acl.upsert({
      id: 'acl-trash-folder',
      nodeId: folderId,
      subjectType: 'user',
      subjectId: ADMIN,
      role: 'manage',
      createdBy: OWNER,
    })

    await svc.softDelete(OWNER, folderId)

    // owner 整批可见：两条都返回，batchSize 都是 2
    const ownerTrash = await svc.listTrash(WS, OWNER)
    expect(ownerTrash).toHaveLength(2)
    expect(ownerTrash.every((n) => n.batchSize === 2)).toBe(true)

    // admin 能看到目录，但看不到 owner 的私密子文档——计数仍必须如实是 2，
    // 否则前端会把这个批次当完整的，彻底删除会级联删掉它看不见的内容。
    const adminTrash = await svc.listTrash(WS, ADMIN)
    expect(adminTrash.map((n) => n.id)).toEqual([folderId])
    expect(adminTrash[0]!.batchSize).toBe(2)
  })

  it('无 trashRootId 的旧数据按自身成批，batchSize 为 1', async () => {
    const docId = await makeDoc('旧数据')
    await svc.softDelete(OWNER, docId)

    const trash = await svc.listTrash(WS, OWNER)
    expect(trash).toHaveLength(1)
    expect(trash[0]!.batchSize).toBe(1)
  })
})

describe('彻底删除', () => {
  it('owner 可以彻底删除回收站中的节点', async () => {
    const docId = await makeDoc('文档')
    await svc.softDelete(OWNER, docId)

    const result = await svc.purge(OWNER, docId)
    expect(result.ok).toBe(true)

    expect(await db.repos.nodes.findById(docId)).toBeNull()
  })

  it('未删除的节点不能直接彻底删除（422）', async () => {
    const docId = await makeDoc('文档')
    await expect(svc.purge(OWNER, docId)).rejects.toMatchObject({ status: 422 })
  })

  it('彻底删除会级联删除子树与正文', async () => {
    const folderId = await makeFolder('目录')
    const docId = await makeDoc('子文档', folderId)

    await svc.softDelete(OWNER, folderId)
    await svc.purge(OWNER, folderId)

    expect(await db.repos.nodes.findById(docId)).toBeNull()
    expect(await db.repos.contents.findByNodeId(docId)).toBeNull()
  })

  it('member 不能彻底删除（authz 的 purge 分支只允许空间 owner/admin）', async () => {
    const docId = await svc.createNode(MEMBER, {
      workspaceId: WS,
      type: 'doc',
      title: 'member 的文档',
    })
    await svc.softDelete(MEMBER, docId.node.id)

    // member 对自己的文档有 manage，但 purge 分支要求空间 owner/admin
    await expect(svc.purge(MEMBER, docId.node.id)).rejects.toMatchObject({ status: 403 })
  })

  it('空间 admin 可以彻底删除', async () => {
    const r = await svc.createNode(MEMBER, {
      workspaceId: WS,
      type: 'doc',
      title: 'member 的文档',
    })
    await svc.softDelete(MEMBER, r.node.id)

    const result = await svc.purge(ADMIN, r.node.id)
    expect(result.ok).toBe(true)
  })
})

describe('面包屑与搜索', () => {
  it('面包屑返回从根到父级', async () => {
    const a = await makeFolder('A')
    const b = await makeFolder('B', a)
    const docId = await makeDoc('文档', b)

    const crumbs = await svc.breadcrumb(docId, OWNER)
    expect(crumbs).toEqual([
      { id: a, title: 'A' },
      { id: b, title: 'B' },
    ])
  })

  it('根节点没有面包屑', async () => {
    const folderId = await makeFolder('根目录')
    expect(await svc.breadcrumb(folderId, OWNER)).toEqual([])
  })

  it('面包屑不泄露用户不可读的祖先标题', async () => {
    const root = await makeFolder('公开根')
    const secret = await makeFolder('私密中间层', root)
    const leafId = await makeDoc('公开叶子', secret)

    // 把中间层改成私密（owner 操作，走新授权）
    await svc.updateNode(OWNER, secret, { visibility: 'private' })

    // member 仍能读到叶子（公开），但不能读到中间层
    const crumbs = await svc.breadcrumb(leafId, MEMBER)
    expect(crumbs).toEqual([
      { id: root, title: '公开根' },
      { id: secret, title: '…' },
    ])

    // owner 自己看得到真实标题
    const ownerCrumbs = await svc.breadcrumb(leafId, OWNER)
    expect(ownerCrumbs).toEqual([
      { id: root, title: '公开根' },
      { id: secret, title: '私密中间层' },
    ])
  })

  it('搜索只返回可读节点', async () => {
    await svc.createNode(OWNER, {
      workspaceId: WS,
      type: 'doc',
      title: '需求文档',
      visibility: 'private',
    })

    const found = await svc.search(WS, MEMBER, '需求')
    expect(found).toHaveLength(0)

    const ownerFound = await svc.search(WS, OWNER, '需求')
    expect(ownerFound).toHaveLength(1)
  })

  it('搜索按前缀匹配', async () => {
    await makeDoc('Sprint 计划')
    await makeDoc('其他 Sprint')

    const found = await svc.search(WS, OWNER, 'sprint')
    expect(found.map((n) => n.title)).toEqual(['Sprint 计划'])
  })
})
