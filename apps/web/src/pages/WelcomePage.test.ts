import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import WelcomePage from '@/pages/WelcomePage.vue'

/**
 * 首屏"输个名字就进"页。
 *
 * 只 mock 网络层：真正要验证的是"名字为空不给提交"、"提交后跳到 /"、
 * "服务端拒绝时留在页面并把原因说清楚"——这些是组件自己的行为。
 */

function mockFetch(
  handler: (url: string, init?: RequestInit) => { status: number; body: unknown },
) {
  const calls: Array<{ url: string; body: unknown }> = []
  const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const res = handler(u, init)
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', spy)
  return { calls }
}

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>home</div>' } },
      { path: '/welcome', name: 'welcome', component: WelcomePage },
      { path: '/login', name: 'login', component: { template: '<div>login</div>' } },
    ],
  })
  await router.push('/welcome')
  await router.isReady()

  const wrapper = mount(WelcomePage, {
    global: { plugins: [createPinia(), router] },
  })
  return { wrapper, router }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('首屏输名字', () => {
  it('名字为空时按钮禁用', async () => {
    const { wrapper } = await mountPage()
    const button = wrapper.find('button[type="submit"]')
    expect(button.attributes('disabled')).toBeDefined()

    await wrapper.find('input').setValue('  ')
    expect(button.attributes('disabled')).toBeDefined()

    await wrapper.find('input').setValue('张三')
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('提交名字后建立身份并跳到首页', async () => {
    const { calls } = mockFetch((url) => {
      if (url.includes('/auth/device')) {
        return {
          status: 201,
          body: {
            created: true,
            user: {
              id: 'du_1',
              email: 'x@device.weshare.local',
              displayName: '张三',
              avatarKey: null,
              status: 'active',
              createdAt: new Date().toISOString(),
            },
          },
        }
      }
      return {
        status: 200,
        body: {
          user: {
            id: 'du_1',
            email: 'x@device.weshare.local',
            displayName: '张三',
            avatarKey: null,
            status: 'active',
            createdAt: new Date().toISOString(),
          },
          workspaces: [],
        },
      }
    })

    const { wrapper, router } = await mountPage()
    await wrapper.find('input').setValue('张三')
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'))

    const deviceCall = calls.find((c) => c.url.includes('/auth/device'))
    expect(deviceCall?.body).toMatchObject({ displayName: '张三' })
    // 客户端算出的设备 key 是 64 位 hex（服务端契约）
    expect((deviceCall?.body as { deviceKey: string }).deviceKey).toMatch(/^[0-9a-f]{64}$/)
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('服务端拒绝时留在本页并展示原因', async () => {
    mockFetch(() => ({
      status: 403,
      body: {
        error: { code: 'FORBIDDEN', message: '账号已被禁用', requestId: 'r1' },
      },
    }))

    const { wrapper, router } = await mountPage()
    await wrapper.find('input').setValue('张三')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toContain('账号已被禁用')
    expect(router.currentRoute.value.path).toBe('/welcome')
  })
})

/**
 * 免密模式下页脚那条「用账号登录」必须消失。
 *
 * 原因不是审美：守卫会把「已登录 + 访问 /login」送回首页，
 * 而免密用户根本没有密码账号——那条链接点下去只会回到原处。
 */
describe('免密模式的页脚', () => {
  it('默认（免密开）不出现"用账号登录"入口', async () => {
    vi.stubEnv('VITE_DEVICE_IDENTITY', 'true')
    const { wrapper } = await mountPage()

    expect(wrapper.text()).not.toContain('用账号登录')
    expect(wrapper.find('a[href="/login"]').exists()).toBe(false)
    // 替代说明要写清楚"为什么回不去"
    expect(wrapper.text()).toContain('免密模式')
  })

  it('免密关（密码模式）时保留登录入口', async () => {
    vi.stubEnv('VITE_DEVICE_IDENTITY', 'false')
    const { wrapper } = await mountPage()

    expect(wrapper.text()).toContain('用账号登录')
    expect(wrapper.find('a[href="/login"]').exists()).toBe(true)
  })
})
