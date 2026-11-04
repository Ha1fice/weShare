import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApiTestContext, extractSessionToken, type ApiTestContext } from './fixture.js'

let ctx: ApiTestContext

const PASSWORD = 'correct horse battery staple'

const OWNER = { id: 'u-owner', name: '所有者' }
const ADMIN = { id: 'u-admin', name: '管理员' }
const MEMBER = { id: 'u-member', name: '成员' }
const VIEWER = { id: 'u-viewer', name: '只读' }
const OUTSIDER = { id: 'u-outsider', name: '外部' }

beforeAll(async () => {
  ctx = await createApiTestContext()
})

beforeEach(async () => {
  await ctx.reset()
})

afterAll(async () => {
  await ctx.close()
})

/** 用户 id → 邮箱。统一规则，避免登录时用错邮箱。 */
function emailOf(userId: string): string {
  return `${userId}@example.com`
}

/** 确保用户存在（幂等），密码为 PASSWORD。 */
async function ensureUser(u: { id: string; email: string; name: string }) {
  const existing = await ctx.db.repos.users.findById(u.id)
  if (existing) return
  const { hashPassword } = await import('../src/lib/password.js')
  await ctx.db.repos.users.create({
    id: u.id,
    email: u.email,
    passwordHash: await hashPassword(PASSWORD),
    displayName: u.name,
  })
}

/**
 * 造一个已登录的会话。
 *
 * 走真实的登录接口——这样拿到的会话与生产完全一致。
 * 用户先由 ensureUser 建好（密码与 PASSWORD 一致）。
 */
async function loginAs(userId: string): Promise<string> {
  const email = emailOf(userId)
  await ensureUser({ id: userId, email, name: userId })

  const login = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: PASSWORD },
  })

  if (login.statusCode !== 200) {
    throw new Error(`登录失败（${login.statusCode}）：${login.body}`)
  }
  return extractSessionToken(String(login.headers['set-cookie'])) ?? ''
}

describe('POST /api/v1/workspaces', () => {
  it('创建空间成功，创建者成为 owner', async () => {
    const token = await loginAs(OWNER.id)

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { cookie: `weshare_session=${token}` },
      payload: { name: '研发空间' },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.workspace.name).toBe('研发空间')
    expect(body.workspace.role).toBe('owner')
    expect(body.workspace.defaultRole).toBe('edit')
  })

  it('未登录返回 401', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { name: 'x' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('空间名为空返回 422', async () => {
    const token = await loginAs(OWNER.id)
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { cookie: `weshare_session=${token}` },
      payload: { name: '   ' },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('GET /api/v1/workspaces', () => {
  it('返回我参与的空间与我在其中的角色', async () => {
    const ownerToken = await loginAs(OWNER.id)
    const memberToken = await loginAs(MEMBER.id)

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { cookie: `weshare_session=${ownerToken}` },
      payload: { name: '研发空间' },
    })
    const wsId = created.json().workspace.id

    // 把 member 加进去
    await ctx.db.repos.workspaces.upsertMember({
      workspaceId: wsId,
      userId: MEMBER.id,
      role: 'member',
    })

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      headers: { cookie: `weshare_session=${memberToken}` },
    })

    expect(res.statusCode).toBe(200)
    const list = res.json().workspaces
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(wsId)
    expect(list[0].role).toBe('member')
  })

  it('未登录返回 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/workspaces' })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /api/v1/workspaces/:id', () => {
  it('成员可以查看空间详情', async () => {
    const ownerToken = await loginAs(OWNER.id)
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { cookie: `weshare_session=${ownerToken}` },
      payload: { name: '研发空间' },
    })
    const wsId = created.json().workspace.id

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${wsId}`,
      headers: { cookie: `weshare_session=${ownerToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('非成员返回 404（不泄露空间是否存在）', async () => {
    const ownerToken = await loginAs(OWNER.id)
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { cookie: `weshare_session=${ownerToken}` },
      payload: { name: '研发空间' },
    })
    const wsId = created.json().workspace.id

    const outsiderToken = await loginAs(OUTSIDER.id)
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${wsId}`,
      headers: { cookie: `weshare_session=${outsiderToken}` },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /api/v1/workspaces/:id', () => {
  it('owner 可以改名', async () => {
    const ownerToken = await loginAs(OWNER.id)
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { cookie: `weshare_session=${ownerToken}` },
      payload: { name: '旧名' },
    })
    const wsId = created.json().workspace.id

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${wsId}`,
      headers: { cookie: `weshare_session=${ownerToken}` },
      payload: { name: '新名' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().workspace.name).toBe('新名')
  })

  it('admin 不能改空间设置（403）', async () => {
    const ownerToken = await loginAs(OWNER.id)
    const adminToken = await loginAs(ADMIN.id)

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { cookie: `weshare_session=${ownerToken}` },
      payload: { name: '研发空间' },
    })
    const wsId = created.json().workspace.id
    await ctx.db.repos.workspaces.upsertMember({
      workspaceId: wsId,
      userId: ADMIN.id,
      role: 'admin',
    })

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${wsId}`,
      headers: { cookie: `weshare_session=${adminToken}` },
      payload: { name: 'admin 改的' },
    })

    expect(res.statusCode).toBe(403)

    // 未被改动
    const ws = await ctx.db.repos.workspaces.findById(wsId)
    expect(ws?.name).toBe('研发空间')
  })
})

describe('成员管理', () => {
  /** 造一个含 owner/admin/member/viewer 的空间。 */
  async function setupWorkspace(): Promise<string> {
    // 先把所有用户建好——加成员有外键约束，用户不存在会失败
    for (const u of [OWNER, ADMIN, MEMBER, VIEWER]) {
      await ensureUser({ id: u.id, email: emailOf(u.id), name: u.name })
    }

    const ownerToken = await loginAs(OWNER.id)
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { cookie: `weshare_session=${ownerToken}` },
      payload: { name: '研发空间' },
    })
    if (created.statusCode !== 201) {
      throw new Error(`建空间失败（${created.statusCode}）：${created.body}`)
    }
    const wsId = created.json().workspace.id

    for (const [id, role] of [
      [ADMIN.id, 'admin'],
      [MEMBER.id, 'member'],
      [VIEWER.id, 'viewer'],
    ] as const) {
      await ctx.db.repos.workspaces.upsertMember({ workspaceId: wsId, userId: id, role })
    }

    return wsId
  }

  it('owner 可以按邮箱添加成员', async () => {
    const wsId = await setupWorkspace()
    const ownerToken = await loginAs(OWNER.id)

    await ensureUser({ id: 'u-new', email: emailOf('u-new'), name: '新人' })

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${wsId}/members`,
      headers: { cookie: `weshare_session=${ownerToken}` },
      payload: { email: emailOf('u-new'), role: 'member' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().member.userId).toBe('u-new')
  })

  it('member 添加成员被拒（403）', async () => {
    const wsId = await setupWorkspace()
    const memberToken = await loginAs(MEMBER.id)

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${wsId}/members`,
      headers: { cookie: `weshare_session=${memberToken}` },
      payload: { email: emailOf('u-new'), role: 'member' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('不存在的邮箱返回 404', async () => {
    const wsId = await setupWorkspace()
    const ownerToken = await loginAs(OWNER.id)

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${wsId}/members`,
      headers: { cookie: `weshare_session=${ownerToken}` },
      payload: { email: emailOf('u-nobody'), role: 'member' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('重复添加返回 409', async () => {
    const wsId = await setupWorkspace()
    const ownerToken = await loginAs(OWNER.id)

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${wsId}/members`,
      headers: { cookie: `weshare_session=${ownerToken}` },
      payload: { email: emailOf(MEMBER.id), role: 'admin' },
    })

    expect(res.statusCode).toBe(409)
  })

  it('不能通过接口设置 owner 角色', async () => {
    const wsId = await setupWorkspace()
    const ownerToken = await loginAs(OWNER.id)

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${wsId}/members`,
      headers: { cookie: `weshare_session=${ownerToken}` },
      payload: { email: emailOf('u-new'), role: 'owner' },
    })

    // 校验层就拒绝——owner 不在可指派角色里
    expect(res.statusCode).toBe(422)
  })

  it('成员列表含邮箱与显示名', async () => {
    const wsId = await setupWorkspace()
    const ownerToken = await loginAs(OWNER.id)

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${wsId}/members`,
      headers: { cookie: `weshare_session=${ownerToken}` },
    })

    expect(res.statusCode).toBe(200)
    const members = res.json().members
    expect(members).toHaveLength(4)
    expect(members.map((m: { email: string }) => m.email).sort()).toEqual(
      [emailOf(OWNER.id), emailOf(ADMIN.id), emailOf(MEMBER.id), emailOf(VIEWER.id)].sort(),
    )
  })

  it('改角色：owner 可以改', async () => {
    const wsId = await setupWorkspace()
    const ownerToken = await loginAs(OWNER.id)

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${wsId}/members/${VIEWER.id}`,
      headers: { cookie: `weshare_session=${ownerToken}` },
      payload: { role: 'member' },
    })

    expect(res.statusCode).toBe(200)
    expect(await ctx.db.repos.workspaces.findMemberRole(wsId, VIEWER.id)).toBe('member')
  })

  it('改角色：admin 不能改 owner 的角色', async () => {
    const wsId = await setupWorkspace()
    const adminToken = await loginAs(ADMIN.id)

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${wsId}/members/${OWNER.id}`,
      headers: { cookie: `weshare_session=${adminToken}` },
      payload: { role: 'member' },
    })

    expect(res.statusCode).toBe(403)
    expect(await ctx.db.repos.workspaces.findMemberRole(wsId, OWNER.id)).toBe('owner')
  })

  it('移除成员：owner 可以移除普通成员', async () => {
    const wsId = await setupWorkspace()
    const ownerToken = await loginAs(OWNER.id)

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${wsId}/members/${VIEWER.id}`,
      headers: { cookie: `weshare_session=${ownerToken}` },
    })

    expect(res.statusCode).toBe(200)
    expect(await ctx.db.repos.workspaces.findMemberRole(wsId, VIEWER.id)).toBeNull()
  })

  it('移除成员：admin 不能移除 owner', async () => {
    const wsId = await setupWorkspace()
    const adminToken = await loginAs(ADMIN.id)

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${wsId}/members/${OWNER.id}`,
      headers: { cookie: `weshare_session=${adminToken}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('viewer 不能移除成员', async () => {
    const wsId = await setupWorkspace()
    const viewerToken = await loginAs(VIEWER.id)

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${wsId}/members/${MEMBER.id}`,
      headers: { cookie: `weshare_session=${viewerToken}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('非成员访问空间返回 404', async () => {
    const wsId = await setupWorkspace()
    const outsiderToken = await loginAs(OUTSIDER.id)

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${wsId}/members`,
      headers: { cookie: `weshare_session=${outsiderToken}` },
    })

    expect(res.statusCode).toBe(404)
  })
})
