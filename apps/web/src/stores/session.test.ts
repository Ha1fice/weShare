import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { router } from '@/app/router.js'
import { api } from '@/api/client.js'
import { useSessionStore } from '@/stores/session.js'

/**
 * S2 验收：401 触发 unauthorized handler 时，除了清状态，
 * 还要跳登录页并带 redirect，让登录后能回跳原页面。
 * 当前路由已是 login 时不重复跳（避免与守卫互相触发循环）。
 *
 * 走真实链路：stub fetch → client 解析 401 → store handler → 断言路由。
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const unauthorized = () =>
  json(
    {
      error: {
        code: 'UNAUTHENTICATED',
        message: '登录状态已失效，请重新登录',
        requestId: 'r1',
      },
    },
    401,
  )

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/me')) {
        return json({
          user: { id: 'u1', email: 'a@b.c', displayName: '用户A', status: 'active' },
          workspaces: [],
        })
      }
      return unauthorized()
    }),
  )
}

describe('401 统一登录跳转', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    useSessionStore().clear()
  })

  it('停在业务页面时会话过期：清状态并跳登录页带 redirect', async () => {
    stubFetch()
    await router.push('/w/w1')
    await router.isReady()
    const session = useSessionStore()
    await session.fetchMe()
    expect(session.status).toBe('authenticated')

    // 页面里的某个请求吃到 401
    await expect(api.get('/workspaces/w1/trash')).rejects.toThrow()
    // handler 里的 router.push 是异步的，等导航落地
    await flushPromises()

    expect(session.status).toBe('anonymous')
    expect(session.user).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/w/w1')
  })

  it('已在登录页时触发 401：不再发起跳转（防守卫循环）', async () => {
    // 未登录用户进登录页：守卫拉 /me 也吃到 401（与 stubFetch 不同）
    vi.stubGlobal('fetch', vi.fn(async () => unauthorized()))
    await router.push('/login')
    await router.isReady()
    const pushSpy = vi.spyOn(router, 'push')
    const session = useSessionStore()

    await expect(api.post('/auth/login', {})).rejects.toThrow()
    await flushPromises()

    expect(session.status).toBe('anonymous')
    // 登录失败的 401 不该触发任何额外导航
    expect(pushSpy).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('匿名状态触发 401：不清状态、不导航', async () => {
    stubFetch()
    await router.push('/w/w1')
    await router.isReady()
    const pushSpy = vi.spyOn(router, 'push')
    const session = useSessionStore()
    session.status = 'anonymous'

    await expect(api.get('/workspaces/w1/trash')).rejects.toThrow()
    await flushPromises()

    expect(session.status).toBe('anonymous')
    expect(pushSpy).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('workspace')
  })
})
