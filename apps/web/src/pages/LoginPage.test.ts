import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import LoginPage from '@/pages/LoginPage.vue'

/**
 * 登录页测试。
 *
 * 用真实的组件渲染（happy-dom），只 mock 网络层——
 * 表单校验、状态切换、错误展示都是组件自己的逻辑，必须真跑。
 */

/** 记录请求并返回预设响应。 */
function mockFetch(
  handler: (url: string, init?: RequestInit) => { status: number; body: unknown },
) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, init })
    const res = handler(u, init)
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', spy)
  return { calls, spy }
}

const mountPage = () => {
  const pinia = createPinia()
  return mount(LoginPage, { global: { plugins: [pinia] } })
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('登录页', () => {
  it('渲染邮箱与密码输入框', () => {
    const wrapper = mountPage()
    expect(wrapper.find('#email').exists()).toBe(true)
    expect(wrapper.find('#password').exists()).toBe(true)
    // 登录模式下没有显示名字段
    expect(wrapper.find('#displayName').exists()).toBe(false)
  })

  it('邮箱为空时提交按钮禁用', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const button = wrapper.find('button[type="submit"]')
    expect((button.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('邮箱与密码都填了才允许提交', async () => {
    mockFetch(() => ({ status: 200, body: { user: {} } }))
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('#email').setValue('alice@example.com')
    await wrapper.find('#password').setValue('correct horse battery staple')
    await flushPromises()

    const button = wrapper.find('button[type="submit"]')
    expect((button.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('提交时发出正确的请求', async () => {
    const { calls } = mockFetch(() => ({
      status: 200,
      body: { user: { id: 'u1', email: 'alice@example.com', displayName: 'A' } },
    }))
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('#email').setValue('alice@example.com')
    await wrapper.find('#password').setValue('correct horse battery staple')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0]?.url).toContain('/api/v1/auth/login')
    expect(calls[0]?.init?.method).toBe('POST')
  })

  it('后端返回错误时展示错误信息', async () => {
    mockFetch(() => ({
      status: 401,
      body: {
        error: { code: 'UNAUTHENTICATED', message: '邮箱或密码错误', requestId: 'r1' },
      },
    }))
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('#email').setValue('alice@example.com')
    await wrapper.find('#password').setValue('wrong password entirely')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toBe('邮箱或密码错误')
  })

  it('切换到注册模式后出现显示名字段', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const buttons = wrapper.findAll('button[type="button"]')
    await buttons[buttons.length - 1]?.trigger('click')
    await flushPromises()

    expect(wrapper.find('#displayName').exists()).toBe(true)
  })

  it('注册模式下密码太短时提交按钮禁用', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const buttons = wrapper.findAll('button[type="button"]')
    await buttons[buttons.length - 1]?.trigger('click')
    await flushPromises()

    await wrapper.find('#email').setValue('alice@example.com')
    await wrapper.find('#displayName').setValue('爱丽丝')
    await wrapper.find('#password').setValue('short')
    await flushPromises()

    const button = wrapper.find('button[type="submit"]')
    expect((button.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('注册模式发出 register 请求', async () => {
    const { calls } = mockFetch(() => ({
      status: 201,
      body: { user: { id: 'u1', email: 'alice@example.com', displayName: '爱丽丝' } },
    }))
    const wrapper = mountPage()
    await flushPromises()

    const buttons = wrapper.findAll('button[type="button"]')
    await buttons[buttons.length - 1]?.trigger('click')
    await flushPromises()

    await wrapper.find('#email').setValue('alice@example.com')
    await wrapper.find('#displayName').setValue('爱丽丝')
    await wrapper.find('#password').setValue('correct horse battery staple')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(calls[0]?.url).toContain('/api/v1/auth/register')
  })

  it('提交期间按钮禁用且显示处理中', async () => {
    // 用数组收集 resolver——直接用变量赋值的话，
    // TS 的控制流分析会认为它在读取点恒为 null（赋值发生在回调里）
    const resolvers: Array<(value: Response) => void> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolvers.push(resolve)
          }),
      ),
    )

    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('#email').setValue('alice@example.com')
    await wrapper.find('#password').setValue('correct horse battery staple')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const button = wrapper.find('button[type="submit"]')
    expect((button.element as HTMLButtonElement).disabled).toBe(true)
    expect(button.text()).toContain('处理中')

    resolvers[0]?.(
      new Response(JSON.stringify({ user: { id: 'u1', email: 'a@b.c', displayName: 'A' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await flushPromises()
  })

  it('网络错误时给出可读提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('#email').setValue('alice@example.com')
    await wrapper.find('#password').setValue('correct horse battery staple')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('无法连接服务器')
  })
})

/**
 * S2 验收：会话过期被 401 送到 /login?redirect=... 后，
 * 登录成功要回跳 redirect 指向的页面；无 redirect 时回首页。
 * 开放重定向（外站 URL）不跟随，仍回首页。
 */
describe('登录后按 redirect 回跳', () => {
  const mountWithRouter = async (initialUrl: string) => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: { template: '<div />' } },
        { path: '/login', name: 'login', component: LoginPage },
        { path: '/w/:workspaceId', name: 'workspace', component: { template: '<div />' } },
      ],
    })
    await router.push(initialUrl)
    const pinia = createPinia()
    const wrapper = mount(LoginPage, { global: { plugins: [pinia, router] } })
    return { wrapper, router }
  }

  const fillAndSubmit = async (wrapper: Awaited<ReturnType<typeof mountWithRouter>>['wrapper']) => {
    await wrapper.find('#email').setValue('alice@example.com')
    await wrapper.find('#password').setValue('correct horse battery staple')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
  }

  it('带 redirect 时登录成功跳回原页面', async () => {
    mockFetch(() => ({
      status: 200,
      body: { user: { id: 'u1', email: 'alice@example.com', displayName: 'A' } },
    }))
    const { wrapper, router } = await mountWithRouter('/login?redirect=/w/w1')
    await flushPromises()

    await fillAndSubmit(wrapper)

    expect(router.currentRoute.value.fullPath).toBe('/w/w1')
  })

  it('无 redirect 时登录成功回首页', async () => {
    mockFetch(() => ({
      status: 200,
      body: { user: { id: 'u1', email: 'alice@example.com', displayName: 'A' } },
    }))
    const { wrapper, router } = await mountWithRouter('/login')
    await flushPromises()

    await fillAndSubmit(wrapper)

    expect(router.currentRoute.value.name).toBe('home')
  })

  it('外站 URL 的 redirect 不跟随（防开放重定向）', async () => {
    mockFetch(() => ({
      status: 200,
      body: { user: { id: 'u1', email: 'alice@example.com', displayName: 'A' } },
    }))
    const { wrapper, router } = await mountWithRouter('/login?redirect=https://evil.example.com')
    await flushPromises()

    await fillAndSubmit(wrapper)

    expect(router.currentRoute.value.name).toBe('home')
  })

  it('协议相对路径 //evil 的 redirect 不跟随', async () => {
    mockFetch(() => ({
      status: 200,
      body: { user: { id: 'u1', email: 'alice@example.com', displayName: 'A' } },
    }))
    const { wrapper, router } = await mountWithRouter('/login?redirect=//evil.example.com')
    await flushPromises()

    await fillAndSubmit(wrapper)

    expect(router.currentRoute.value.name).toBe('home')
  })
})
