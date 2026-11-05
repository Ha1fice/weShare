/**
 * 登录页测试。
 *
 * 用真实组件渲染（happy-dom），只 mock 网络层——
 * 表单校验、模式切换、错误展示都是组件自己的逻辑，必须真跑。
 *
 * 关于"按钮是否禁用"：这里断言的是 `aria-disabled` 而不是 HTML 的
 * `disabled`。原因是我们**故意不禁用**提交按钮——禁用的按钮点下去毫无反馈，
 * 用户不知道差了什么。现在的做法是：按钮可点，点击后把缺失项标红。
 * 无障碍语义上仍要通过 aria-disabled 告知辅助技术。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import LoginPage from '@/pages/LoginPage.vue'

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
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

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', name: 'home', component: { template: '<div />' } },
    { path: '/login', name: 'login', component: LoginPage },
  ],
})

const mountPage = () =>
  mount(LoginPage, { global: { plugins: [createPinia(), router] } })

/** 切到注册模式：页脚那个"创建一个 / 去登录"按钮是最后一个 type=button。 */
async function switchToRegister(wrapper: ReturnType<typeof mountPage>): Promise<void> {
  const buttons = wrapper.findAll('button[type="button"]')
  await buttons[buttons.length - 1]?.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('登录页', () => {
  it('渲染邮箱与密码输入框', () => {
    const wrapper = mountPage()
    expect(wrapper.find('#email').exists()).toBe(true)
    expect(wrapper.find('#password').exists()).toBe(true)
    expect(wrapper.find('#displayName').exists()).toBe(false)
  })

  it('什么都没填时点提交：不请求、标红必要项', async () => {
    const { calls } = mockFetch(() => ({ status: 200, body: {} }))
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(calls).toHaveLength(0)
    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('请输入邮箱')
  })

  it('邮箱与密码都填了可提交', async () => {
    mockFetch(() => ({ status: 200, body: { user: {} } }))
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('#email').setValue('alice@example.com')
    await wrapper.find('#password').setValue('correct horse battery staple')
    await flushPromises()

    const button = wrapper.find('button[type="submit"]')
    expect(button.attributes('disabled')).toBeUndefined()
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
      body: { error: { code: 'UNAUTHENTICATED', message: '邮箱或密码错误', requestId: 'r1' } },
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
    await switchToRegister(wrapper)
    expect(wrapper.find('#displayName').exists()).toBe(true)
  })

  it('注册模式下密码太短时不发请求', async () => {
    const { calls } = mockFetch(() => ({ status: 201, body: { user: {} } }))
    const wrapper = mountPage()
    await flushPromises()
    await switchToRegister(wrapper)

    await wrapper.find('#email').setValue('alice@example.com')
    await wrapper.find('#displayName').setValue('爱丽丝')
    await wrapper.find('#password').setValue('short')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(calls).toHaveLength(0)
    expect(wrapper.find('[role="alert"]').text()).toContain('密码至少需要')
  })

  it('注册模式发出 register 请求', async () => {
    const { calls } = mockFetch(() => ({
      status: 201,
      body: { user: { id: 'u1', email: 'alice@example.com', displayName: '爱丽丝' } },
    }))
    const wrapper = mountPage()
    await flushPromises()
    await switchToRegister(wrapper)

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
    expect(button.attributes('disabled')).toBeDefined()
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
