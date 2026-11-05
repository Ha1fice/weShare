import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useSessionStore } from '@/stores/session.js'
import LoginPage from '@/pages/LoginPage.vue'
import WorkspacePage from '@/pages/WorkspacePage.vue'
import DocPage from '@/pages/DocPage.vue'
import WorkspaceSettingsPage from '@/pages/WorkspaceSettingsPage.vue'
import NewWorkspacePage from '@/pages/NewWorkspacePage.vue'
import AccountPage from '@/pages/AccountPage.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/welcome',
    name: 'welcome',
    component: () => import('@/pages/WelcomePage.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/',
    name: 'home',
    component: () => import('@/pages/HomePage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/login',
    name: 'login',
    component: LoginPage,
    meta: { requiresAuth: false },
  },
  {
    path: '/healthz',
    name: 'healthz',
    component: () => import('@/pages/HealthPage.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/w/:workspaceId',
    name: 'workspace',
    component: WorkspacePage,
    meta: { requiresAuth: true },
  },
  {
    path: '/new',
    name: 'new-workspace',
    component: NewWorkspacePage,
    meta: { requiresAuth: true },
  },
  {
    path: '/account',
    name: 'account',
    component: AccountPage,
    meta: { requiresAuth: true },
  },
  {
    path: '/w/:workspaceId/trash',
    name: 'trash',
    component: () => import('@/pages/TrashPage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/w/:workspaceId/settings',
    name: 'workspace-settings',
    component: WorkspaceSettingsPage,
    meta: { requiresAuth: true },
  },
  {
    path: '/n/:nodeId',
    name: 'doc',
    component: DocPage,
    meta: { requiresAuth: true },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

/**
 * 路由守卫：未登录访问受保护页面 → 跳登录页。
 *
 * 关键点：**首次进入时先问一次服务端**。会话存在 HttpOnly Cookie 里，
 * 前端读不到，只能问后端。若不先问，未登录用户会先看到首页骨架再被踢回登录页。
 */
router.beforeEach(async (to) => {
  const session = useSessionStore()

  // 状态未知说明还没问过服务端
  if (session.status === 'unknown') {
    try {
      await session.fetchMe()
    } catch {
      // 网络错误等异常情况：保持 unknown，交给页面处理，
      // 不要在这里把用户踢到登录页（可能只是网络抖动）
      session.clear()
    }
  }

  if (to.meta.requiresAuth && !session.isAuthenticated()) {
    // 免密模式下没有"登录"这回事，直接去输名字的首屏
    return {
      name: session.deviceMode ? 'welcome' : 'login',
      query: { redirect: to.fullPath },
    }
  }

  // 已登录时访问登录页 → 送回首页
  if (to.name === 'login' && session.isAuthenticated()) {
    return { name: 'home' }
  }

  // 免密模式下的首屏：已登录再去就没意义了（带 redirect 的除外——
  // 那是从受保护页面被踢过来的，说明本次会话真的失效了）
  if (to.name === 'welcome' && session.isAuthenticated() && !to.query.redirect) {
    return { name: 'home' }
  }

  return true
})
