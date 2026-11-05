import { beforeEach, describe, expect, it, vi } from 'vitest'
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

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
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
    await flushPromises()
    await flushPromises()

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
