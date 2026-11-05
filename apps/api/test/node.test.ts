import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApiTestContext, extractSessionToken, type ApiTestContext } from './fixture.js'

let ctx: ApiTestContext

const PASSWORD = 'correct horse battery staple'

const OWNER = { id: 'n-owner', name: '所有者' }
const VIEWER = { id: 'n-viewer', name: '只读' }
const OUTSIDER = { id: 'n-outsider', name: '外部' }

function emailOf(userId: string): string {
  return `${userId}@example.com`
}

beforeAll(async () => {
  ctx = await createApiTestContext()
})

beforeEach(async () => {
  await ctx.reset()
})

afterAll(async () => {
  await ctx.close()
})

/** 确保用户存在（密码为 PASSWORD）。 */
async function ensureUser(u: { id: string; name: string }) {
  if (await ctx.db.repos.users.findById(u.id)) return
  const { hashPassword } = await import('../src/lib/password.js')
  await ctx.db.repos.users.create({
    id: u.id,
    email: emailOf(u.id),
    passwordHash: await hashPassword(PASSWORD),
    displayName: u.name,
  })
}

/** 登录并返回会话 token。 */
async function loginAs(u: { id: string; name: string }): Promise<string> {
  await ensureUser(u)
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: emailOf(u.id), password: PASSWORD },
  })
  if (res.statusCode !== 200) throw new Error(`登录失败：${res.body}`)
  return extractSessionToken(String(res.headers['set-cookie'])) ?? ''
}

/** 建空间，返回 id。 */
async function createWorkspace(token: string, name = '测试空间'): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/workspaces',
    headers: { cookie: `weshare_session=${token}` },
    payload: { name },
  })
  return res.json().workspace.id
}

const auth = (token: string) => ({ cookie: `weshare_session=${token}` })

describe('POST /api/v1/nodes', () => {
  it('创建文件夹', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'folder', title: '设计稿' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().node.type).toBe('folder')
    expect(res.json().node.role).toBe('manage')
  })

  it('创建文档并自动建立正文', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'doc', title: '需求文档' },
    })

    const nodeId = res.json().node.id
    const content = await ctx.db.repos.contents.findByNodeId(nodeId)
    expect(content).not.toBeNull()
  })

  it('未登录返回 401', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      payload: { workspaceId: 'w', type: 'doc', title: 'x' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('viewer 创建返回 403', async () => {
    const ownerToken = await loginAs(OWNER)
    const wsId = await createWorkspace(ownerToken)
    await ensureUser(VIEWER)
    await ctx.db.repos.workspaces.upsertMember({
      workspaceId: wsId,
      userId: VIEWER.id,
      role: 'viewer',
    })

    const viewerToken = await loginAs(VIEWER)
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(viewerToken),
      payload: { workspaceId: wsId, type: 'doc', title: 'x' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('非成员创建返回 404', async () => {
    const ownerToken = await loginAs(OWNER)
    const wsId = await createWorkspace(ownerToken)

    const outsiderToken = await loginAs(OUTSIDER)
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(outsiderToken),
      payload: { workspaceId: wsId, type: 'doc', title: 'x' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('缺少 workspaceId 返回 422', async () => {
    const token = await loginAs(OWNER)
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { type: 'doc', title: 'x' },
    })
    expect(res.statusCode).toBe(422)
  })

  it('非法 type 返回 422', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'sheet', title: 'x' },
    })
    // sheet 在 Phase 5 才做——契约层只允许 folder/doc
    expect(res.statusCode).toBe(422)
  })
})

describe('GET /api/v1/workspaces/:id/tree', () => {
  it('返回可读节点树与 hasChildren', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)

    const folder = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'folder', title: '目录' },
    })
    const folderId = folder.json().node.id

    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, parentId: folderId, type: 'doc', title: '子文档' },
    })

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${wsId}/tree`,
      headers: auth(token),
    })

    expect(res.statusCode).toBe(200)
    const nodes = res.json().nodes
    expect(nodes).toHaveLength(2)

    const f = nodes.find((n: { id: string }) => n.id === folderId)
    expect(f.hasChildren).toBe(true)
  })

  it('私密文档不出现在其他成员树里', async () => {
    const ownerToken = await loginAs(OWNER)
    const wsId = await createWorkspace(ownerToken)
    await ensureUser(VIEWER)
    await ctx.db.repos.workspaces.upsertMember({
      workspaceId: wsId,
      userId: VIEWER.id,
      role: 'viewer',
    })

    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(ownerToken),
      payload: { workspaceId: wsId, type: 'doc', title: '私密', visibility: 'private' },
    })

    const viewerToken = await loginAs(VIEWER)
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${wsId}/tree`,
      headers: auth(viewerToken),
    })

    expect(res.json().nodes).toHaveLength(0)
  })
})

describe('GET /api/v1/nodes/:id 与面包屑', () => {
  it('返回节点与我的角色', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'doc', title: '文档' },
    })
    const nodeId = created.json().node.id

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/nodes/${nodeId}`,
      headers: auth(token),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().node.role).toBe('manage')
  })

  it('非成员读节点返回 404', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'doc', title: '文档' },
    })
    const nodeId = created.json().node.id

    const outsiderToken = await loginAs(OUTSIDER)
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/nodes/${nodeId}`,
      headers: auth(outsiderToken),
    })
    expect(res.statusCode).toBe(404)
  })

  it('面包屑返回祖先路径', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)

    const a = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'folder', title: 'A' },
    })
    const b = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: {
        workspaceId: wsId,
        parentId: a.json().node.id,
        type: 'doc',
        title: 'B',
      },
    })

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/nodes/${b.json().node.id}/breadcrumb`,
      headers: auth(token),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().items).toEqual([{ id: a.json().node.id, title: 'A' }])
  })
})

describe('PATCH /api/v1/nodes/:id', () => {
  it('改名', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'doc', title: '旧' },
    })

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/nodes/${created.json().node.id}`,
      headers: auth(token),
      payload: { title: '新' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().node.title).toBe('新')
  })

  it('移动节点', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const folder = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'folder', title: '目录' },
    })
    const doc = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'doc', title: '文档' },
    })

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/nodes/${doc.json().node.id}`,
      headers: auth(token),
      payload: { parentId: folder.json().node.id },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().node.parentId).toBe(folder.json().node.id)
  })

  it('移动到自身下返回 422', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const folder = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'folder', title: '目录' },
    })
    const folderId = folder.json().node.id

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/nodes/${folderId}`,
      headers: auth(token),
      payload: { parentId: folderId },
    })

    expect(res.statusCode).toBe(422)
  })

  it('空 body 返回 422', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'doc', title: 'x' },
    })

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/nodes/${created.json().node.id}`,
      headers: auth(token),
      payload: {},
    })
    expect(res.statusCode).toBe(422)
  })

  it('viewer 改名返回 403', async () => {
    const ownerToken = await loginAs(OWNER)
    const wsId = await createWorkspace(ownerToken)
    await ensureUser(VIEWER)
    await ctx.db.repos.workspaces.upsertMember({
      workspaceId: wsId,
      userId: VIEWER.id,
      role: 'viewer',
    })
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(ownerToken),
      payload: { workspaceId: wsId, type: 'doc', title: 'x' },
    })

    const viewerToken = await loginAs(VIEWER)
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/nodes/${created.json().node.id}`,
      headers: auth(viewerToken),
      payload: { title: 'viewer 改的' },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('删除 / 回收站 / 还原 / 彻底删除', () => {
  it('完整生命周期：删除 → 回收站 → 还原', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'doc', title: '生命周期' },
    })
    const nodeId = created.json().node.id

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/nodes/${nodeId}`,
      headers: auth(token),
    })
    expect(del.statusCode).toBe(200)
    expect(del.json().affected).toBe(1)

    const trash = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${wsId}/trash`,
      headers: auth(token),
    })
    expect(trash.json().nodes.map((n: { id: string }) => n.id)).toContain(nodeId)
    // S3 契约补充：软删除节点带 trashRootId（批次根），未删除节点为 null
    const trashed = trash.json().nodes.find((n: { id: string }) => n.id === nodeId)
    expect(trashed.trashRootId).toBe(nodeId)

    const restore = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/nodes/${nodeId}/restore`,
      headers: auth(token),
    })
    expect(restore.statusCode).toBe(200)

    const after = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${wsId}/trash`,
      headers: auth(token),
    })
    expect(after.json().nodes).toHaveLength(0)
  })

  it('删除目录连同子树：回收站按 trashRootId 聚批', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const folder = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'folder', title: '目录' },
    })
    const folderId = folder.json().node.id
    const child = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, parentId: folderId, type: 'doc', title: '子文档' },
    })
    const childId = child.json().node.id

    await ctx.app.inject({ method: 'DELETE', url: `/api/v1/nodes/${folderId}`, headers: auth(token) })

    const trash = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${wsId}/trash`,
      headers: auth(token),
    })
    const nodes = trash.json().nodes
    expect(nodes.map((n: { id: string }) => n.id)).toContain(folderId)
    expect(nodes.map((n: { id: string }) => n.id)).toContain(childId)
    // 子节点和根节点的 trashRootId 都指向批次根（被删目录自身）
    for (const n of nodes) {
      expect(n.trashRootId).toBe(folderId)
    }
  })

  it('彻底删除：未进回收站时返回 422', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'doc', title: 'x' },
    })

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/nodes/${created.json().node.id}/purge`,
      headers: auth(token),
    })
    expect(res.statusCode).toBe(422)
  })

  it('彻底删除：进回收站后可彻底删除', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(token),
      payload: { workspaceId: wsId, type: 'doc', title: 'x' },
    })
    const nodeId = created.json().node.id

    await ctx.app.inject({ method: 'DELETE', url: `/api/v1/nodes/${nodeId}`, headers: auth(token) })
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/nodes/${nodeId}/purge`,
      headers: auth(token),
    })

    expect(res.statusCode).toBe(200)
    expect(await ctx.db.repos.nodes.findById(nodeId)).toBeNull()
  })

  it('viewer 不能删除（403）', async () => {
    const ownerToken = await loginAs(OWNER)
    const wsId = await createWorkspace(ownerToken)
    await ensureUser(VIEWER)
    await ctx.db.repos.workspaces.upsertMember({
      workspaceId: wsId,
      userId: VIEWER.id,
      role: 'viewer',
    })
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/nodes',
      headers: auth(ownerToken),
      payload: { workspaceId: wsId, type: 'doc', title: 'x' },
    })

    const viewerToken = await loginAs(VIEWER)
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/nodes/${created.json().node.id}`,
      headers: auth(viewerToken),
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('搜索', () => {
  it('按 q 前缀搜索', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)

    for (const title of ['Sprint 计划', '其他 Sprint']) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/nodes',
        headers: auth(token),
        payload: { workspaceId: wsId, type: 'doc', title },
      })
    }

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${wsId}/nodes?q=sprint`,
      headers: auth(token),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().nodes.map((n: { title: string }) => n.title)).toEqual(['Sprint 计划'])
  })
})
