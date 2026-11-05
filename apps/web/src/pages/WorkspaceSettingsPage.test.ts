import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import WorkspaceSettingsPage from '@/pages/WorkspaceSettingsPage.vue'

/**
 * 空间设置页测试。
 *
 * 重点验证**页面级权限**：owner 看到编辑控件，viewer 看不到。
 * 注意这只是体验层——服务端每次都会复核（架构文档 §8.4），
 * 所以这里的断言不是安全测试，而是"别把不该点的按钮显示出来"。
 */

const WS_ID = 'w1'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 按 URL 分发响应。 */
function stubApi(opts: {
  role: 'owner' | 'admin' | 'member' | 'viewer'
  onPost?: (url: string, body: unknown) => Response
  onPatch?: (url: string, body: unknown) => Response
  onDelete?: (url: string) => Response
}) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, url, body })

      if (method === 'GET' && url.endsWith(`/workspaces/${WS_ID}`)) {
        return json({
          workspace: {
            id: WS_ID,
            name: '研发空间',
            ownerId: 'u-owner',
            defaultRole: 'edit',
            role: opts.role,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        })
      }

      if (method === 'GET' && url.endsWith(`/workspaces/${WS_ID}/members`)) {
        return json({
          members: [
            {
              userId: 'u-owner',
              email: 'owner@example.com',
              displayName: '所有者',
              role: 'owner',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              userId: 'u-viewer',
              email: 'viewer@example.com',
              displayName: '只读用户',
              role: 'viewer',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        })
      }

      if (method === 'POST' && opts.onPost) return opts.onPost(url, body)
      if (method === 'PATCH' && opts.onPatch) return opts.onPatch(url, body)
      if (method === 'DELETE' && opts.onDelete) return opts.onDelete(url)

      // 兜底：session.fetchMe 相关的 /me 请求
      return json({ user: { id: 'u1' }, workspaces: [] })
    }),
  )

  return calls
}

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/w/:workspaceId/settings', name: 'workspace-settings', component: WorkspaceSettingsPage },
      { path: '/w/:workspaceId', name: 'workspace', component: { template: '<div/>' } },
      { path: '/w/:workspaceId/trash', name: 'trash', component: { template: '<div/>' } },
      { path: '/w/:workspaceId/settings', name: 'settings', component: { template: '<div/>' } },
    ],
  })
  await router.push(`/w/${WS_ID}/settings`)
  await router.isReady()

  return mount(WorkspaceSettingsPage, {
    global: { plugins: [createPinia(), router] },
  })
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('空间设置页', () => {
  it('owner 能看到编辑控件与添加成员表单', async () => {
    stubApi({ role: 'owner' })
    const wrapper = await mountPage()
    await flushPromises()

    // 空间名在输入框里（不在文本节点）
    expect((wrapper.find('#ws-name').element as HTMLInputElement).value).toBe('研发空间')
    // 基本信息可编辑
    expect(wrapper.find('#ws-name').attributes('disabled')).toBeUndefined()
    // 有"添加成员"按钮
    expect(wrapper.text()).toContain('添加成员')
    // 有保存按钮
    expect(wrapper.text()).toContain('保存')
  })

  it('viewer 看不到编辑控件，看到"仅所有者可修改"提示', async () => {
    stubApi({ role: 'viewer' })
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.find('#ws-name').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#ws-name').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('仅空间所有者或管理员可管理成员')
  })

  it('member 也不能管理成员（403 语义在服务端，前端只是不显示）', async () => {
    stubApi({ role: 'member' })
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('仅空间所有者或管理员可管理成员')
  })

  it('添加成员发出正确的 POST', async () => {
    const calls = stubApi({
      role: 'owner',
      onPost: (_url, body) => json({ member: { userId: 'u2', role: (body as { role: string }).role } }, 201),
    })
    const wrapper = await mountPage()
    await flushPromises()

    // 打开"添加成员"对话框，填邮箱后在对话框里确认
    const inviteBtn = wrapper.findAll('button').find((b) => b.text().includes('添加成员'))
    expect(inviteBtn).toBeTruthy()
    await inviteBtn!.trigger('click')
    await flushPromises()

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    const emailInput = dialog!.querySelector('#invite-email') as HTMLInputElement
    emailInput.value = 'new@example.com'
    emailInput.dispatchEvent(new Event('input'))
    await flushPromises()

    const confirmBtn = Array.from(dialog!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('添加'),
    ) as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    const post = calls.find((c) => c.method === 'POST')
    expect(post?.url).toContain(`/workspaces/${WS_ID}/members`)
    expect(post?.body).toEqual({ email: 'new@example.com', role: 'member' })
  })

  it('已有成员的角色不允许在本页修改（owner 除外）', async () => {
    stubApi({ role: 'owner' })
    const wrapper = await mountPage()
    await flushPromises()

    // owner 那一行应显示"所有者"文本而不是下拉
    const ownerRow = wrapper.find('[data-member-id="u-owner"]')
    expect(ownerRow.exists()).toBe(true)
    expect(ownerRow.find('select').exists()).toBe(false)
    expect(ownerRow.text()).toContain('所有者')

    // viewer 那一行有角色切换按钮（下拉已换成自定义菜单）
    const viewerRow = wrapper.find('[data-member-id="u-viewer"]')
    expect(viewerRow.text()).toContain('只读')
    expect(viewerRow.findAll('button').length).toBeGreaterThan(0)
  })

  it('改角色发出 PATCH 到正确路径', async () => {
    const calls = stubApi({ role: 'owner', onPatch: () => json({ member: {} }) })
    const wrapper = await mountPage()
    await flushPromises()

    const viewerRow = wrapper.find('[data-member-id="u-viewer"]')
    // 点开角色菜单，选"成员"
    const roleBtn = viewerRow.findAll('button')[0]!
    await roleBtn.trigger('click')
    await flushPromises()

    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) =>
      el.textContent?.includes('成员 · 可创建与编辑'),
    ) as HTMLElement
    expect(item).toBeTruthy()
    item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    item.click()
    await flushPromises()

    const patch = calls.find((c) => c.method === 'PATCH')
    expect(patch?.url).toContain(`/workspaces/${WS_ID}/members/u-viewer`)
    expect(patch?.body).toEqual({ role: 'member' })
  })

  it('保存基本信息发出 PATCH 到空间路径', async () => {
    const calls = stubApi({
      role: 'owner',
      onPatch: () =>
        json({
          workspace: {
            id: WS_ID,
            name: '新名字',
            ownerId: 'u-owner',
            defaultRole: 'view',
            role: 'owner',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
    })
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.find('#ws-name').setValue('新名字')
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存')
    await saveBtn!.trigger('click')
    await flushPromises()

    const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith(`/workspaces/${WS_ID}`))
    expect(patch?.body).toMatchObject({ name: '新名字' })
  })

  it('接口报错时展示错误信息', async () => {
    stubApi({
      role: 'owner',
      onPost: () =>
        json({ error: { code: 'NOT_FOUND', message: '该邮箱对应的用户不存在', requestId: 'r1' } }, 404),
    })
    const wrapper = await mountPage()
    await flushPromises()

    const inviteBtn = wrapper.findAll('button').find((b) => b.text().includes('添加成员'))
    await inviteBtn!.trigger('click')
    await flushPromises()

    const dialog = document.querySelector('[role="dialog"]')!
    const emailInput = dialog.querySelector('#invite-email') as HTMLInputElement
    emailInput.value = 'nobody@example.com'
    emailInput.dispatchEvent(new Event('input'))
    await flushPromises()

    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('添加'),
    ) as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toContain('该邮箱对应的用户不存在')
  })
})
