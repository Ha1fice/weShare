import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApiTestContext, extractSessionToken, type ApiTestContext } from './fixture.js'

let ctx: ApiTestContext

const VALID_PASSWORD = 'correct horse battery staple'

beforeAll(async () => {
  ctx = await createApiTestContext()
})

beforeEach(async () => {
  await ctx.reset()
})

afterAll(async () => {
  await ctx.close()
})

describe('POST /api/v1/auth/register', () => {
  it('注册成功返回用户并下发会话 Cookie', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'alice@example.com',
        password: VALID_PASSWORD,
        displayName: '爱丽丝',
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.user.email).toBe('alice@example.com')
    expect(body.user.displayName).toBe('爱丽丝')
    // 响应里绝不能有密码哈希
    expect(JSON.stringify(body)).not.toContain('passwordHash')
    expect(JSON.stringify(body)).not.toContain('$argon2')

    const setCookie = res.headers['set-cookie']
    expect(setCookie).toBeDefined()
    expect(extractSessionToken(setCookie)).toBeTruthy()
  })

  it('Cookie 带 httpOnly 与 SameSite=Lax', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'alice@example.com',
        password: VALID_PASSWORD,
        displayName: '爱丽丝',
      },
    })

    const setCookie = String(res.headers['set-cookie'])
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('Max-Age=')
  })

  it('邮箱大小写不敏感——重复注册被拒', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'alice@example.com', password: VALID_PASSWORD, displayName: 'A' },
    })

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'ALICE@Example.COM', password: VALID_PASSWORD, displayName: 'A' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('CONFLICT')
  })

  it('密码太短被拒（422）', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'alice@example.com', password: 'short', displayName: 'A' },
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('VALIDATION_FAILED')
  })

  it('密码太长被拒（422）', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'alice@example.com',
        password: 'a'.repeat(65),
        displayName: 'A',
      },
    })

    expect(res.statusCode).toBe(422)
  })

  it('邮箱格式不对被拒（422）', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'not-an-email', password: VALID_PASSWORD, displayName: 'A' },
    })

    expect(res.statusCode).toBe(422)
  })

  it('注册后可立即用该会话访问 /me', async () => {
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'alice@example.com',
        password: VALID_PASSWORD,
        displayName: '爱丽丝',
      },
    })

    const token = extractSessionToken(String(reg.headers['set-cookie']))
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `weshare_session=${token}` },
    })

    expect(me.statusCode).toBe(200)
    expect(me.json().user.email).toBe('alice@example.com')
  })
})

describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'alice@example.com',
        password: VALID_PASSWORD,
        displayName: '爱丽丝',
      },
    })
  })

  it('正确的邮箱密码登录成功', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'alice@example.com', password: VALID_PASSWORD },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().user.email).toBe('alice@example.com')
    expect(extractSessionToken(String(res.headers['set-cookie']))).toBeTruthy()
  })

  it('邮箱大小写不敏感', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ALICE@EXAMPLE.COM', password: VALID_PASSWORD },
    })

    expect(res.statusCode).toBe(200)
  })

  it('密码错误返回统一的"邮箱或密码错误"', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'alice@example.com', password: 'wrong password entirely' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.message).toBe('邮箱或密码错误')
  })

  it('用户不存在时错误信息与密码错误时**完全一致**（防账号枚举）', async () => {
    const wrongPassword = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'alice@example.com', password: 'wrong password entirely' },
    })
    const noSuchUser = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'wrong password entirely' },
    })

    expect(noSuchUser.statusCode).toBe(wrongPassword.statusCode)
    expect(noSuchUser.json().error.code).toBe(wrongPassword.json().error.code)
    expect(noSuchUser.json().error.message).toBe(wrongPassword.json().error.message)
  })

  it('被禁用的账号不能登录', async () => {
    const user = await ctx.db.repos.users.findByEmail('alice@example.com')
    await ctx.db.repos.users.setStatus(user!.id, 'disabled')

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'alice@example.com', password: VALID_PASSWORD },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('FORBIDDEN')
  })

  it('登录失败 5 次后锁定（429）', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'alice@example.com', password: 'wrong password entirely' },
      })
      expect(res.statusCode).toBe(401)
    }

    // 第 6 次应被限流
    const locked = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'alice@example.com', password: VALID_PASSWORD },
    })

    expect(locked.statusCode).toBe(429)
    expect(locked.json().error.code).toBe('RATE_LIMITED')
  })

  it('登录成功后清零失败计数', async () => {
    for (let i = 0; i < 4; i++) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'alice@example.com', password: 'wrong password entirely' },
      })
    }

    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'alice@example.com', password: VALID_PASSWORD },
    })
    expect(ok.statusCode).toBe(200)

    // 计数已清零，可以继续失败 5 次
    for (let i = 0; i < 5; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'alice@example.com', password: 'wrong password entirely' },
      })
      expect(res.statusCode).toBe(401)
    }
  })
})

describe('POST /api/v1/auth/logout', () => {
  it('登出后会话立即失效', async () => {
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'alice@example.com',
        password: VALID_PASSWORD,
        displayName: '爱丽丝',
      },
    })
    const token = extractSessionToken(String(reg.headers['set-cookie']))

    const out = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `weshare_session=${token}` },
    })
    expect(out.statusCode).toBe(200)

    // 清了 Cookie，但服务端已删除会话——旧 token 不能用了
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `weshare_session=${token}` },
    })
    expect(me.statusCode).toBe(401)
  })

  it('登出会下发清除 Cookie 的头', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
    })

    const setCookie = String(res.headers['set-cookie'])
    expect(setCookie).toContain('Max-Age=0')
    expect(setCookie).toContain('HttpOnly')
  })

  it('未登录时登出也不报错', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout' })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET /api/v1/me', () => {
  it('未登录返回 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/me' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHENTICATED')
  })

  it('带无效 token 返回 401', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: 'weshare_session=garbage' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('返回用户与空间列表', async () => {
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'alice@example.com',
        password: VALID_PASSWORD,
        displayName: '爱丽丝',
      },
    })
    const token = extractSessionToken(String(reg.headers['set-cookie']))

    const user = await ctx.db.repos.users.findByEmail('alice@example.com')
    await ctx.db.repos.workspaces.create({
      id: 'w-1',
      name: '研发空间',
      ownerId: user!.id,
    })

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `weshare_session=${token}` },
    })

    expect(me.statusCode).toBe(200)
    const body = me.json()
    expect(body.user.email).toBe('alice@example.com')
    expect(body.workspaces).toHaveLength(1)
    expect(body.workspaces[0].role).toBe('owner')
  })
})

describe('PATCH /api/v1/me', () => {
  it('修改显示名', async () => {
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'alice@example.com',
        password: VALID_PASSWORD,
        displayName: '爱丽丝',
      },
    })
    const token = extractSessionToken(String(reg.headers['set-cookie']))

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie: `weshare_session=${token}` },
      payload: { displayName: '爱丽丝二世' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().user.displayName).toBe('爱丽丝二世')
  })

  it('未登录时拒绝', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      payload: { displayName: '新名字' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('显示名为空被拒', async () => {
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'alice@example.com',
        password: VALID_PASSWORD,
        displayName: '爱丽丝',
      },
    })
    const token = extractSessionToken(String(reg.headers['set-cookie']))

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie: `weshare_session=${token}` },
      payload: { displayName: '   ' },
    })
    expect(res.statusCode).toBe(422)
  })
})
