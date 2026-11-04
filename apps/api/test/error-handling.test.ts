import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiTestContext, type ApiTestContext } from './fixture.js'

let ctx: ApiTestContext

beforeAll(async () => {
  ctx = await createApiTestContext()
})

afterAll(async () => {
  await ctx.close()
})

/**
 * 统一错误处理的回归测试。
 *
 * 起因：端到端联调时发现，客户端带 `Content-Type: application/json` 但
 * 空 body 发 DELETE，Fastify 抛 400，而错误处理器把所有非校验类错误
 * 都转成了 500。结果是"客户端请求格式不对"被报成"服务端挂了"——
 * 会污染错误指标，也会让客户端盲目重试。
 */
describe('统一错误处理', () => {
  it('JSON 解析失败返回 400 而不是 500', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{ this is not json',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_FAILED')
  })

  it('声明了 JSON 但 body 为空返回 400 而不是 500', async () => {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/v1/nodes/whatever',
      headers: { 'content-type': 'application/json' },
      payload: '',
    })

    expect(res.statusCode).toBe(400)
    // 关键：不能是 500——那表示服务端异常
    expect(res.statusCode).not.toBe(500)
  })

  it('不存在的路由返回 404 且带错误体', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/no-such-route' })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
    expect(res.json().error.requestId).toBeTruthy()
  })

  it('请求体过大返回 413（由 Fastify 限制触发）', async () => {
    // 默认 bodyLimit 是 1 MiB，这里构造一个明显超限的字符串
    const huge = 'x'.repeat(2 * 1024 * 1024)

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'a@b.c', password: huge }),
    })

    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('响应体始终包含 code / message / requestId', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/me' })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: expect.any(String),
      requestId: expect.any(String),
    })
  })
})
