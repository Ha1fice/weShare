import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import TrashPage from '@/pages/TrashPage.vue'
import { useSessionStore } from '@/stores/session.js'

/**
 * 回收站页测试（S3 骨架 + S4 操作）。
 *
 * 重点验证：
 * - 聚批：同一 trashRootId 的多条记录在页面上呈现为一个批次
 * - 三态：加载中 / 空态 / 列表
 * - 权限显隐：非 manage 角色（服务端直接不返回数据）没有操作入口
 * - 还原：调 restore 接口；422 时原样提示错误信息
 * - 彻底删除：二次确认（需输入批次根标题精确匹配）；仅 owner/admin 可见
 */

const WS_ID = 'w1'

interface TrashItem {
  id: string
  workspaceId: string
  parentId: string | null
  type: 'folder' | 'doc'
  title: string
  ownerId: string
  visibility: 'private' | 'workspace'
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  trashRootId: string | null
  role?: string
}

function item(partial: Partial<TrashItem> & { id: string; title: string }): TrashItem {
  return {
    workspaceId: WS_ID,
    parentId: null,
    type: 'doc',
    ownerId: 'u1',
    visibility: 'workspace',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: '2026-01-02T00:00:00.000Z',
    trashRootId: null,
    role: 'manage',
    ...partial,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type Handler = (method: string, url: string, body?: unknown) => Response | undefined

function stubApi(handler: Handler): Array<{ method: string; url: string; body?: unknown }> {
  const calls: Array<{ method: string; url: string; body?: unknown }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, url, body })
      if (url.endsWith('/me')) {
        return json({
          user: { id: 'u1', email: 'a@b.c', displayName: 'A', status: 'active' },
          workspaces: [{ id: WS_ID, name: '研发空间', ownerId: 'u1', defaultRole: 'edit', role: 'owner' }],
        })
      }
      const res = handler(method, url, body)
      return res ?? json({ error: { code: 'INTERNAL_ERROR', message: `未处理请求 ${method} ${url}` } }, 500)
    }),
  )
  return calls
}

function trashHandler(nodes: TrashItem[]) {
  return (method: string, url: string): Response | undefined => {
    if (method === 'GET' && url.endsWith(`/workspaces/${WS_ID}/trash`)) {
      return json({ nodes })
    }
    return undefined
  }
}

async function mountPage() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/w/:workspaceId/trash', name: 'trash', component: TrashPage },
      { path: '/w/:workspaceId', name: 'workspace', component: { template: '<div/>' } },
      // AppShell 顶栏会渲染这两个入口的链接，路由表里缺失会直接抛错
      { path: '/w/:workspaceId/settings', name: 'workspace-settings', component: { template: '<div/>' } },
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/account', name: 'account', component: { template: '<div/>' } },
    ],
  })
  await router.push(`/w/${WS_ID}/trash`)
  await router.isReady()

  // 会话已在守卫拉取过（fetchMe）——组件的 canPurge 依赖 session.workspaces
  const wrapper = mount(TrashPage, {
    global: { plugins: [pinia, router] },
  })
  await useSessionStore().fetchMe()
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('回收站页面', () => {
  it('加载中显示 loading 态', async () => {
    // 只挂起 trash 请求，/me 正常返回（否则 fetchMe 也会卡住）
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith('/me')) {
          return json({
            user: { id: 'u1', email: 'a@b.c', displayName: 'A', status: 'active' },
            workspaces: [{ id: WS_ID, name: '研发空间', ownerId: 'u1', defaultRole: 'edit', role: 'owner' }],
          })
        }
        return new Promise<Response>(() => {})
      }),
    )
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="trash-loading"]').exists()).toBe(true)
  })

  it('空回收站显示空态提示', async () => {
    stubApi(trashHandler([]))
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.find('[data-testid="trash-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="trash-list"]').exists()).toBe(false)
  })

  it('按 trashRootId 聚批：目录连同子树显示为一个批次', async () => {
    stubApi(
      trashHandler([
        item({ id: 'f1', title: '目录', type: 'folder', trashRootId: 'f1' }),
        item({ id: 'd1', title: '子文档', parentId: 'f1', trashRootId: 'f1' }),
        item({ id: 'd2', title: '单独文档', trashRootId: 'd2' }),
      ]),
    )
    const wrapper = await mountPage()
    await flushPromises()

    const batches = wrapper.findAll('[data-testid="trash-batch"]')
    expect(batches).toHaveLength(2)
    // 批次标题为批次根标题；空标题显示「未命名」
    const first = batches[0]!
    const second = batches[1]!
    expect(first.text()).toContain('目录')
    expect(first.text()).toContain('2') // 批内 2 项
    expect(second.text()).toContain('单独文档')
  })

  it('批次根标题为空时显示「未命名」', async () => {
    stubApi(trashHandler([item({ id: 'd1', title: '', trashRootId: 'd1' })]))
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.find('[data-testid="trash-list"]').text()).toContain('未命名')
  })

  it('还原：点击批次还原按钮调 restore 接口（按批次根 id）并刷新列表', async () => {
    const calls = stubApi((method, url) => {
      if (method === 'GET' && url.endsWith(`/workspaces/${WS_ID}/trash`)) {
        return json({ nodes: [item({ id: 'f1', title: '目录', type: 'folder', trashRootId: 'f1' })] })
      }
      if (method === 'POST' && url.endsWith('/nodes/f1/restore')) {
        return json({ ok: true, affected: 2 })
      }
      return undefined
    })
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.find('[data-testid="restore-btn"]').trigger('click')
    await flushPromises()

    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/nodes/f1/restore'))).toBe(true)
  })

  it('还原失败（422）时原样展示服务端错误信息', async () => {
    stubApi((method, url) => {
      if (method === 'GET' && url.endsWith(`/workspaces/${WS_ID}/trash`)) {
        return json({ nodes: [item({ id: 'f1', title: '目录', type: 'folder', trashRootId: 'f1' })] })
      }
      if (method === 'POST' && url.endsWith('/nodes/f1/restore')) {
        return json({ error: { code: 'VALIDATION_FAILED', message: '上级目录已被删除，请先还原上级目录', requestId: 'r' } }, 422)
      }
      return undefined
    })
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.find('[data-testid="restore-btn"]').trigger('click')
    await flushPromises()

    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('上级目录已被删除，请先还原上级目录')
  })

  it('彻底删除：owner 输入精确标题后确认，调 purge 接口', async () => {
    const calls = stubApi((method, url) => {
      if (method === 'GET' && url.endsWith(`/workspaces/${WS_ID}/trash`)) {
        return json({ nodes: [item({ id: 'f1', title: '目录', type: 'folder', trashRootId: 'f1' })] })
      }
      if (method === 'DELETE' && url.endsWith('/nodes/f1/purge')) {
        return json({ ok: true })
      }
      return undefined
    })
    const wrapper = await mountPage()
    await flushPromises()

    // 打开确认弹窗（AppDialog 用 DialogPortal 渲染，内容不在 wrapper 的 DOM 子树里）
    await wrapper.find('[data-testid="purge-btn"]').trigger('click')
    await flushPromises()

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    const input = dialog!.querySelector('#purge-confirm') as HTMLInputElement
    expect(input).toBeTruthy()
    const confirmBtn = Array.from(dialog!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('彻底删除'),
    ) as HTMLButtonElement

    // 标题不匹配时确认按钮不可用
    input.value = '错的标题'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(confirmBtn.disabled).toBe(true)

    // 输入精确标题后确认
    input.value = '目录'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(confirmBtn.disabled).toBe(false)
    confirmBtn.click()
    await flushPromises()

    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/nodes/f1/purge'))).toBe(true)
  })

  it('purge 失败（403）时原样展示错误信息', async () => {
    stubApi((method, url) => {
      if (method === 'GET' && url.endsWith(`/workspaces/${WS_ID}/trash`)) {
        return json({ nodes: [item({ id: 'f1', title: '目录', type: 'folder', trashRootId: 'f1' })] })
      }
      if (method === 'DELETE' && url.endsWith('/nodes/f1/purge')) {
        return json({ error: { code: 'FORBIDDEN', message: '仅空间所有者或管理员可彻底删除', requestId: 'r' } }, 403)
      }
      return undefined
    })
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.find('[data-testid="purge-btn"]').trigger('click')
    await flushPromises()

    const dialog = document.querySelector('[role="dialog"]')!
    const input = dialog.querySelector('#purge-confirm') as HTMLInputElement
    input.value = '目录'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('彻底删除'),
    ) as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toContain('仅空间所有者或管理员可彻底删除')
  })

  it('member 角色没有 purge 入口（仅 owner/admin）', async () => {
    stubApi(
      trashHandler([item({ id: 'f1', title: '目录', type: 'folder', trashRootId: 'f1', role: 'manage' })]),
    )
    // me 接口返回 member 角色
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url.endsWith('/me')) {
          return json({
            user: { id: 'u1', email: 'a@b.c', displayName: 'A', status: 'active' },
            workspaces: [{ id: WS_ID, name: '研发空间', ownerId: 'u2', defaultRole: 'edit', role: 'member' }],
          })
        }
        if (method === 'GET' && url.endsWith(`/workspaces/${WS_ID}/trash`)) {
          return json({ nodes: [item({ id: 'f1', title: '目录', type: 'folder', trashRootId: 'f1', role: 'manage' })] })
        }
        return json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, 500)
      }),
    )
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.find('[data-testid="purge-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="restore-btn"]').exists()).toBe(true)
  })

  it('viewer 角色服务端不返回回收站数据 → 空态', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/me')) {
          return json({
            user: { id: 'u1', email: 'a@b.c', displayName: 'A', status: 'active' },
            workspaces: [{ id: WS_ID, name: '研发空间', ownerId: 'u2', defaultRole: 'view', role: 'viewer' }],
          })
        }
        if (url.endsWith(`/workspaces/${WS_ID}/trash`)) {
          return json({ nodes: [] })
        }
        return json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, 500)
      }),
    )
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.find('[data-testid="trash-empty"]').exists()).toBe(true)
  })

  it('跨空间隔离：只加载当前 workspaceId 的回收站', async () => {
    const calls = stubApi(trashHandler([]))
    await mountPage()
    await flushPromises()

    expect(calls.some((c) => c.url.endsWith(`/workspaces/${WS_ID}/trash`))).toBe(true)
    expect(calls.some((c) => c.url.includes('/workspaces/w2/'))).toBe(false)
  })
})
