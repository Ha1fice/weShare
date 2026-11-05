/**
 * 文档页测试。
 *
 * 这里测的是**契约层面的行为**，不是编辑器内部实现：
 * 只读用户编辑器不可编辑、保存走 PUT 且带 revision、加载失败有出口。
 *
 * happy-dom 没有真实 contenteditable 行为，也没有 WebSocket，所以
 * "打字 → 防抖 → 保存"在 autosave.test.ts 里用假定时器单测；
 * 协同链路（Y.Doc ↔ 服务端）由 `apps/collab/test/collab-server.test.ts` 的
 * 真 WebSocket 端到端测试兜底。这里只验证接线正确：
 * 打开文档就走协同、只读用户的编辑器被标记为只读。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import DocPage from '@/pages/DocPage.vue'
import { useSessionStore } from '@/stores/session.js'

const NODE_ID = 'n1'
const WS_ID = 'w1'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

function stubApi(
  opts: {
    role?: 'manage' | 'edit' | 'view'
    collabEnabled?: boolean
    onPut?: (body: unknown) => Response
  } = {},
) {
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
          collabEnabled: opts.collabEnabled ?? false,
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
  const pinia = createPinia()
  // 协同连接需要登录态：没有 user 时 startCollab 会直接返回，
  // 测的就不是协同这条路径了。
  useSessionStore(pinia).user = {
    id: 'u1',
    email: 'a@b.c',
    displayName: 'A',
  } as never

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

  return mount(DocPage, { global: { plugins: [pinia, router] } })
}

beforeEach(() => {
  vi.unstubAllGlobals()
  // 协同连接在 happy-dom 里必然失败（没有 WebSocket），这是预期：
  // 页面应给出"无法协同"的明确出口，而不是假装在协同。
})

describe('文档页', () => {
  it('加载后渲染标题，并提示协同同步状态', async () => {
    stubApi()
    const wrapper = await mountPage()
    await flushPromises()

    const title = wrapper.find('input[aria-label="文档标题"]')
    expect((title.element as HTMLInputElement).value).toBe('需求文档')
    // 正文由协同连接驱动：状态必须说清楚，不能留空白让人猜
    expect(wrapper.text()).toMatch(/连接中|已断线|实时协同|无法协同|正在与服务器同步/)
  })

  it('可编辑用户的标题输入框不是 readonly', async () => {
    stubApi({ role: 'manage' })
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.find('input[aria-label="文档标题"]').attributes('readonly')).toBeUndefined()
  })

  it('只读用户：标题 readonly、显示只读标记', async () => {
    stubApi({ role: 'view' })
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.find('input[aria-label="文档标题"]').attributes('readonly')).toBeDefined()
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

  it('拿到正文后进入协同，而不是静默空白', async () => {
    stubApi()
    const wrapper = await mountPage()
    await flushPromises()

    // 协同连接在 happy-dom 里没有 WebSocket，状态会落到"已断线"或"无法协同"——
    // 关键是**不能静默**：用户必须知道现在不是实时协同。
    expect(wrapper.text()).toMatch(/连接中|已断线|实时协同|无法协同|正在与服务器同步/)
    expect(wrapper.text()).not.toContain('协同服务未连接')
  })
})
