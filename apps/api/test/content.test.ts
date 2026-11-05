/**
 * 正文接口集成测试。
 *
 * 用真实数据库，不 mock——这里要验证的正是"写入后真的落库了"
 * 与"冲突真的被挡住了"，mock 掉就什么都没验证。
 *
 * 覆盖：读写往返、revision 乐观锁冲突、只读用户被拒、跨空间 404、
 * 已删除文档 404、体积上限、协同启用后 REST 写入被拒（不变式 I2）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApiTestContext, extractSessionToken, type ApiTestContext } from './fixture.js'

let ctx: ApiTestContext

const PASSWORD = 'correct horse battery staple'
const OWNER = { id: 'c-owner', name: '所有者' }
const EDITOR = { id: 'c-editor', name: '编辑者' }
const VIEWER = { id: 'c-viewer', name: '只读' }
const OUTSIDER = { id: 'c-outsider', name: '外部' }

const emailOf = (userId: string) => `${userId}@example.com`

beforeAll(async () => {
  ctx = await createApiTestContext()
})

beforeEach(async () => {
  await ctx.reset()
})

afterAll(async () => {
  await ctx.close()
})

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

const auth = (token: string) => ({ cookie: `weshare_session=${token}` })

async function createWorkspace(token: string, name = '正文测试空间'): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/workspaces',
    headers: auth(token),
    payload: { name },
  })
  return res.json().workspace.id
}

async function createDoc(token: string, workspaceId: string, title = '文档'): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/nodes',
    headers: auth(token),
    payload: { workspaceId, type: 'doc', title },
  })
  return res.json().node.id
}

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

// ---------------------------------------------------------------- 读

describe('GET /api/v1/nodes/:id/content', () => {
  it('返回初始空文档，revision 为 0', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const nodeId = await createDoc(token, wsId)

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(token),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.doc.type).toBe('doc')
    expect(body.revision).toBe(0)
    expect(body.collabEnabled).toBe(false)
    expect(body.contentSchemaVersion).toBe(1)
  })

  it('未登录返回 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/nodes/x/content' })
    expect(res.statusCode).toBe(401)
  })

  it('非空间成员返回 404（不泄露存在性）', async () => {
    const ownerToken = await loginAs(OWNER)
    const wsId = await createWorkspace(ownerToken)
    const nodeId = await createDoc(ownerToken, wsId)

    const outsiderToken = await loginAs(OUTSIDER)
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(outsiderToken),
    })

    expect(res.statusCode).toBe(404)
  })

  it('只读成员可以读', async () => {
    const ownerToken = await loginAs(OWNER)
    const wsId = await createWorkspace(ownerToken)
    const nodeId = await createDoc(ownerToken, wsId)

    await ensureUser(VIEWER)
    await ctx.db.repos.workspaces.upsertMember({ workspaceId: wsId, userId: VIEWER.id, role: 'viewer' })
    const viewerToken = await loginAs(VIEWER)

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(viewerToken),
    })
    expect(res.statusCode).toBe(200)
  })
})

// ---------------------------------------------------------------- 写

describe('PUT /api/v1/nodes/:id/content', () => {
  it('保存后能读回，revision 递增', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const nodeId = await createDoc(token, wsId)

    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(token),
      payload: { revision: 0, doc: doc('第一版内容') },
    })

    expect(put.statusCode).toBe(200)
    expect(put.json().revision).toBe(1)
    expect(put.json().textPreview).toBe('第一版内容')
    expect(put.json().charCount).toBe(5)

    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(token),
    })
    expect(get.json().doc.content[0].content[0].text).toBe('第一版内容')
    expect(get.json().revision).toBe(1)
  })

  it('内容真的落库了（绕过接口直接查仓储）', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const nodeId = await createDoc(token, wsId)

    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(token),
      payload: { revision: 0, doc: doc('落库验证') },
    })

    const row = await ctx.db.repos.contents.findByNodeId(nodeId)
    expect(row?.revision).toBe(1)
    expect(JSON.stringify(row?.contentJson)).toContain('落库验证')
    expect(row?.textPreview).toBe('落库验证')
  })

  it('revision 不匹配返回 409', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const nodeId = await createDoc(token, wsId)

    // 第一次保存成功，revision 变成 1
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(token),
      payload: { revision: 0, doc: doc('A') },
    })

    // 第二个标签页还拿着 revision 0 保存
    const stale = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(token),
      payload: { revision: 0, doc: doc('B') },
    })

    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('CONFLICT')

    // 冲突不能产生副作用：内容仍是 A
    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(token),
    })
    expect(get.json().doc.content[0].content[0].text).toBe('A')
    expect(get.json().revision).toBe(1)
  })

  it('只读成员写入返回 403（服务端强制，不靠前端）', async () => {
    const ownerToken = await loginAs(OWNER)
    const wsId = await createWorkspace(ownerToken)
    const nodeId = await createDoc(ownerToken, wsId)

    await ensureUser(VIEWER)
    await ctx.db.repos.workspaces.upsertMember({ workspaceId: wsId, userId: VIEWER.id, role: 'viewer' })
    const viewerToken = await loginAs(VIEWER)

    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(viewerToken),
      payload: { revision: 0, doc: doc('偷偷改') },
    })

    expect(res.statusCode).toBe(403)

    // 确实没写进去
    const row = await ctx.db.repos.contents.findByNodeId(nodeId)
    expect(row?.revision).toBe(0)
  })

  it('成员角色可以写入', async () => {
    const ownerToken = await loginAs(OWNER)
    const wsId = await createWorkspace(ownerToken)
    const nodeId = await createDoc(ownerToken, wsId)

    await ensureUser(EDITOR)
    await ctx.db.repos.workspaces.upsertMember({ workspaceId: wsId, userId: EDITOR.id, role: 'member' })
    const editorToken = await loginAs(EDITOR)

    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(editorToken),
      payload: { revision: 0, doc: doc('成员写的') },
    })
    expect(res.statusCode).toBe(200)
  })

  it('已删除文档的正文不能写入', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const nodeId = await createDoc(token, wsId)

    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/nodes/${nodeId}`,
      headers: auth(token),
    })

    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(token),
      payload: { revision: 0, doc: doc('回收站里的文档') },
    })
    expect(res.statusCode).toBe(404)
  })

  it('doc 不是 PM JSON 结构时返回 422', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const nodeId = await createDoc(token, wsId)

    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(token),
      payload: { revision: 0, doc: { hello: 'world' } },
    })
    expect(res.statusCode).toBe(422)
  })

  it('缺少 revision 返回 422', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const nodeId = await createDoc(token, wsId)

    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(token),
      payload: { doc: doc('x') },
    })
    expect(res.statusCode).toBe(422)
  })

  it('超出体积上限返回 413', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const nodeId = await createDoc(token, wsId)

    // 20 MB 上限；造 21 MB 的文本
    const huge = 'x'.repeat(21 * 1024 * 1024)
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(token),
      payload: { revision: 0, doc: doc(huge) },
    })
    expect(res.statusCode).toBe(413)
  })

  it('文档启用协同后 REST 写入返回 409 COLLAB_ENABLED（不变式 I2）', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const nodeId = await createDoc(token, wsId)

    // 模拟"协同服务已经落过一次库"
    await ctx.db.repos.contents.saveCollaborative({
      nodeId,
      yjsState: new Uint8Array([1, 2, 3]),
      stateVector: new Uint8Array([4, 5]),
    })

    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(token),
      payload: { revision: 0, doc: doc('REST 想抢着写') },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('COLLAB_ENABLED')
  })

  it('协同启用后 GET 会标记 collabEnabled', async () => {
    const token = await loginAs(OWNER)
    const wsId = await createWorkspace(token)
    const nodeId = await createDoc(token, wsId)

    await ctx.db.repos.contents.saveCollaborative({
      nodeId,
      yjsState: new Uint8Array([1]),
      stateVector: new Uint8Array([2]),
    })

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/nodes/${nodeId}/content`,
      headers: auth(token),
    })
    expect(res.json().collabEnabled).toBe(true)
  })
})
