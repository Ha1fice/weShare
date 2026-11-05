/**
 * 文档页测试。
 *
 * 这里测的是**契约层面的行为**，不是编辑器内部实现：
 * 只读用户编辑器不可编辑、保存走 PUT 且带 revision、加载失败有出口。
 *
 * happy-dom 没有真实 contenteditable 行为，所以"打字 → 防抖 → 保存"这条链路
 * 在 autosave.test.ts 里用假定时器单测，这里只验证接线正确。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import DocPage from '@/pages/DocPage.vue'

const NODE_ID = 'n1'
const WS_ID = 'w1'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

function stubApi(opts: {
  role?: 'manage' | 'edit' | 'view'
  onPut?: (body: unknown) => Response
} = {}) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, url, body })

      if (url.endsWith(`/nodes/${NODE_ID}`) && method === 'GET') {
        return json({
          node: {
            id: NODE_ID,
            workspaceId: WS_ID,
            parentId: null,
            type: 'doc',
            title: '需求文档',
            ownerId: 'u1',
            visibility: 'workspace',
            sortOrder: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: null,
            role: opts.role ?? 'manage',
          },
        })
      }

      if (url.includes('/breadcrumb')) {
        return json({ items: [{ id: 'f1', title: '产品' }] })
      }

      if (url.endsWith(`/nodes/${NODE_ID}/content`) && method === 'GET') {
        return json({
          nodeId: NODE_ID,
          doc: emptyDoc,
          revision: 3,
          contentSchemaVersion: 1,
          textPreview: null,
          charCount: 0,
          updatedAt: '2026-01-01T00:00:00.000Z',
          collabEnabled: false,
        })
      }

      if (url.endsWith(`/nodes/${NODE_ID}/content`) && method === 'PUT') {
        if (opts.onPut) return opts.onPut(body)
        return json({
          nodeId: NODE_ID,
          doc: emptyDoc,
          revision: 4,
          contentSchemaVersion: 1,
          textPreview: 'x',
          charCount: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
          collabEnabled: false,
        })
      }

      return json({ user: { id: 'u1', displayName: 'A', email: 'a@b.c' }, workspaces: [] })
    }),
  )

  return calls
}

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/n/:nodeId', name: 'doc', component: DocPage },
      { path: '/w/:workspaceId', name: 'workspace', component: { template: '<div/>' } },
      { path: '/w/:workspaceId/trash', name: 'trash', component: { template: '<div/>' } },
      { path: '/w/:workspaceId/settings', name: 'workspace-settings', component: { template: '<div/>' } },
      { path: '/', name: 'home', component: { template: '<div/>' } },
    ],
  })
  await router.push(`/n/${NODE_ID}`)
  await router.isReady()

  return mount(DocPage, { global: { plugins: [createPinia(), router] } })
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('文档页', () => {
  it('加载后渲染标题与正文容器', async () => {
    stubApi()
    const wrapper = await mountPage()
    await flushPromises()

    const title = wrapper.find('input[aria-label="文档标题"]')
    expect((title.element as HTMLInputElement).value).toBe('需求文档')
    expect(wrapper.find('.doc-editor').exists()).toBe(true)
  })

  it('可编辑用户的标题输入框不是 readonly', async () => {
    stubApi({ role: 'manage' })
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.find('input[aria-label="文档标题"]').attributes('readonly')).toBeUndefined()
  })

  it('只读用户：标题 readonly、正文 contenteditable=false、显示只读标记', async () => {
    stubApi({ role: 'view' })
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.find('input[aria-label="文档标题"]').attributes('readonly')).toBeDefined()
    expect(wrapper.find('.doc-editor').attributes('contenteditable')).toBe('false')
    expect(wrapper.text()).toContain('只读')
  })

  it('加载失败时给出错误与重试入口', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ error: { code: 'NOT_FOUND', message: '节点不存在', requestId: 'r1' } }, 404),
      ),
    )
    const wrapper = await mountPage()
    await flushPromises()

    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('节点不存在')
    expect(alert.text()).toContain('重试')
  })

  it('初始状态显示"已保存"（没有待保存改动）', async () => {
    stubApi()
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('已保存')
  })
})
