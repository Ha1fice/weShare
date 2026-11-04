import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useSessionStore } from '@/stores/session.js'
import LoginPage from '@/pages/LoginPage.vue'
import HomePage from '@/pages/HomePage.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomePage,
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
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  // 已登录时访问登录页 → 送回首页
  if (to.name === 'login' && session.isAuthenticated()) {
    return { name: 'home' }
  }

  return true
})
