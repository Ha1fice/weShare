import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
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

/**
 * 等某个异步条件成立。
 *
 * 这些用例里提交要经过 crypto.subtle.digest、两次 fetch 与路由跳转，
 * 全链路耗时随机器负载浮动；vi.waitFor 默认 1s 的窗口在 CI 上不够用，
 * 于是会出现"本地绿、CI 红"的假失败。
 */
async function waitFor(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion, { timeout: 5000, interval: 25 })
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
  // 1.0 决策：提交按钮不禁用，点错了才标红（见 LoginPage 同款交互）。
  // "点错了才标红"的两半都要成立：未交互不标红，点过「进入」才出提示。
  it('初始与输入过程中不标红，点过「进入」后才给出行内提示', async () => {
    const { wrapper } = await mountPage()

    // 未交互：无红框、无红字
    expect(wrapper.text()).not.toContain('先给自己起个名字')
    expect(wrapper.find('input').attributes('aria-invalid')).toBeUndefined()

    // 输入又清空仍不算"点错"——只有提交动作才触发校验展示
    await wrapper.find('input').setValue('  ')
    expect(wrapper.text()).not.toContain('先给自己起个名字')
    expect(wrapper.find('input').attributes('aria-invalid')).toBeUndefined()

    // 点过「进入」：空名字标红（红框 + 红字）
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('先给自己起个名字')
    expect(wrapper.find('input').attributes('aria-invalid')).toBe('true')

    // 填了名字提示消失
    await wrapper.find('input').setValue('张三')
    expect(wrapper.text()).not.toContain('先给自己起个名字')
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
    await waitFor(() => expect(router.currentRoute.value.path).toBe('/'))

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

    // 设备 key 要经过 crypto.subtle.digest，比 flushPromises 的一轮微任务慢，
    // 固定 flushPromises 跑在慢机器上会查到一个还没渲染出来的页面。
    const alert = () => {
      const el = wrapper.find('[role="alert"]')
      expect(el.exists()).toBe(true)
      expect(el.text()).toContain('账号已被禁用')
    }
    await waitFor(alert)
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
