/**
 * 免密身份（设备指纹）集成测试。
 *
 * 关注点不是"接口能通"，而是几条容易只有真机才暴露的特性：
 * 同一设备幂等、不同设备隔离、默认空间可读可写、改名跟随、关掉开关即 404。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApiTestContext, extractSessionToken, type ApiTestContext } from './fixture.js'

let ctx: ApiTestContext

/** 64 位 hex 的设备标识。 */
const KEY_A = 'a'.repeat(64)
const KEY_B = 'b'.repeat(64)

async function establish(deviceKey: string, displayName: string, app = ctx.app) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/device',
    payload: { deviceKey, displayName },
  })
}

beforeAll(async () => {
  ctx = await createApiTestContext({ deviceIdentity: true })
})

beforeEach(async () => {
  await ctx.reset()
})

afterAll(async () => {
  await ctx.close()
})

describe('POST /api/v1/auth/device', () => {
  it('首次进入建账号并下发会话 Cookie', async () => {
    const res = await establish(KEY_A, '张三')

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.created).toBe(true)
    expect(body.user.displayName).toBe('张三')
    expect(extractSessionToken(res.headers['set-cookie'] as string)).toBeTruthy()

    // Cookie 立即生效：能读到自己的空间
    const token = extractSessionToken(res.headers['set-cookie'] as string)
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `weshare_session=${token}` },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json().workspaces).toHaveLength(1)
    expect(me.json().workspaces[0].role).toBe('owner')
  })

  it('同一设备再次进入回到同一账号，不重复建空间', async () => {
    const first = await establish(KEY_A, '张三')
    const second = await establish(KEY_A, '张三')

    expect(second.statusCode).toBe(200)
    expect(second.json().created).toBe(false)
    expect(second.json().user.id).toBe(first.json().user.id)

    const token = extractSessionToken(second.headers['set-cookie'] as string)
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `weshare_session=${token}` },
    })
    expect(me.json().workspaces).toHaveLength(1)
  })

  it('重新输入名字即改名：身份与空间不变，空间名不跟着改', async () => {
    const first = await establish(KEY_A, '张三')
    const renamed = await establish(KEY_A, '张三丰')

    expect(renamed.json().user.id).toBe(first.json().user.id)
    expect(renamed.json().user.displayName).toBe('张三丰')

    const token = extractSessionToken(renamed.headers['set-cookie'] as string)
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `weshare_session=${token}` },
    })
    // 空间名是建空间时定的，改名不该偷偷改动别人看到的名称
    expect(me.json().workspaces[0].name).toBe('张三 的空间')
  })

  it('不同设备是不同身份，互相看不到空间', async () => {
    const a = await establish(KEY_A, '张三')
    const b = await establish(KEY_B, '李四')

    expect(b.json().user.id).not.toBe(a.json().user.id)

    const tokenB = extractSessionToken(b.headers['set-cookie'] as string)
    const meB = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `weshare_session=${tokenB}` },
    })
    const ids = meB.json().workspaces.map((w: { id: string }) => w.id)

    const tokenA = extractSessionToken(a.headers['set-cookie'] as string)
    const meA = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `weshare_session=${tokenA}` },
    })
    expect(ids).not.toContain(meA.json().workspaces[0].id)
  })

  it('新身份带有可直接打开的欢迎文档', async () => {
    const res = await establish(KEY_A, '张三')
    const token = extractSessionToken(res.headers['set-cookie'] as string)
    const cookie = { cookie: `weshare_session=${token}` }

    const me = await ctx.app.inject({ method: 'GET', url: '/api/v1/me', headers: cookie })
    const workspaceId = me.json().workspaces[0].id

    const tree = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/tree`,
      headers: cookie,
    })
    expect(tree.statusCode).toBe(200)
    const titles = tree.json().nodes.map((n: { title: string }) => n.title)
    expect(titles).toContain('欢迎使用 weShare')
  })

  it('设备标识格式不合法时 422', async () => {
    const res = await establish('not-a-key', '张三')
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('VALIDATION_FAILED')
  })

  it('名字为空时 422', async () => {
    const res = await establish(KEY_A, '   ')
    expect(res.statusCode).toBe(422)
  })

  it('被禁用的身份不能靠重新输入名字绕过', async () => {
    const first = await establish(KEY_A, '张三')
    const userId = first.json().user.id
    await ctx.db.repos.users.setStatus(userId, 'disabled')

    const again = await establish(KEY_A, '张三')
    expect(again.statusCode).toBe(403)
    expect(again.json().error.code).toBe('FORBIDDEN')
  })
})

describe('POST /api/v1/auth/device/bind', () => {
  it('已登录时把设备绑到自己', async () => {
    const res = await establish(KEY_A, '张三')
    const token = extractSessionToken(res.headers['set-cookie'] as string)

    const bind = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/device/bind',
      headers: { cookie: `weshare_session=${token}` },
      payload: { deviceKey: KEY_A, displayName: '张三' },
    })
    expect(bind.statusCode).toBe(200)
  })

  it('不能把别人的设备绑到自己身上', async () => {
    await establish(KEY_B, '李四')
    const mine = await establish(KEY_A, '张三')
    const token = extractSessionToken(mine.headers['set-cookie'] as string)

    const bind = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/device/bind',
      headers: { cookie: `weshare_session=${token}` },
      payload: { deviceKey: KEY_B, displayName: '张三' },
    })
    expect(bind.statusCode).toBe(409)
  })

  it('未登录时 401', async () => {
    const bind = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/device/bind',
      payload: { deviceKey: KEY_A, displayName: '张三' },
    })
    expect(bind.statusCode).toBe(401)
  })
})

describe('DEVICE_IDENTITY 关闭时', () => {
  it('身份接口不存在（404），密码登录照旧可用', async () => {
    const closed = await createApiTestContext({ deviceIdentity: false })
    try {
      const res = await closed.app.inject({
        method: 'POST',
        url: '/api/v1/auth/device',
        payload: { deviceKey: KEY_A, displayName: '张三' },
      })
      expect(res.statusCode).toBe(404)

      const register = await closed.app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'alice@example.com', password: 'correct horse battery', displayName: '爱丽丝' },
      })
      expect(register.statusCode).toBe(201)
    } finally {
      await closed.close()
    }
  })
})
