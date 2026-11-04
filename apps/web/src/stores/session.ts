/**
 * 会话状态（Pinia）。
 *
 * 状态机很简单：unknown（尚未检查）→ authenticated / anonymous。
 * `unknown` 单独存在是必要的——首屏渲染前必须先问服务端"我是谁"，
 * 否则会闪一下登录页再跳回主页。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AuthResponse, CurrentUser, MeResponse } from '@weshare/shared'
import { api, ApiError, setUnauthorizedHandler } from '../api/client.js'

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous'

export const useSessionStore = defineStore('session', () => {
  const status = ref<SessionStatus>('unknown')
  const user = ref<CurrentUser | null>(null)
  const workspaces = ref<MeResponse['workspaces']>([])
  /** 正在与服务器通信（首屏检查、登录中）。 */
  const loading = ref(false)

  /** 是否已登录。 */
  function isAuthenticated(): boolean {
    return status.value === 'authenticated'
  }

  /**
   * 拉取当前用户。
   *
   * 未登录时不是错误——把状态置为 anonymous 即可。
   * 其他错误（网络故障等）向上抛，由调用方决定如何提示。
   */
  async function fetchMe(): Promise<void> {
    loading.value = true
    try {
      const me = await api.get<MeResponse>('/me')
      user.value = me.user
      workspaces.value = me.workspaces
      status.value = 'authenticated'
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clear()
      } else {
        throw err
      }
    } finally {
      loading.value = false
    }
  }

  /** 登录。成功后状态直接变为 authenticated。 */
  async function login(email: string, password: string): Promise<void> {
    const res = await api.post<AuthResponse>('/auth/login', { email, password })
    user.value = res.user
    status.value = 'authenticated'
    // 登录后拉一次空间列表
    await fetchMe()
  }

  /** 注册。注册接口已自动登录。 */
  async function register(email: string, password: string, displayName: string): Promise<void> {
    const res = await api.post<AuthResponse>('/auth/register', { email, password, displayName })
    user.value = res.user
    status.value = 'authenticated'
    await fetchMe()
  }

  /** 登出。服务端会话立即失效，本地状态清空。 */
  async function logout(): Promise<void> {
    try {
      await api.post('/auth/logout')
    } finally {
      // 即使服务端请求失败也要清本地状态
      clear()
    }
  }

  /** 修改显示名。 */
  async function updateDisplayName(displayName: string): Promise<void> {
    const res = await api.patch<AuthResponse>('/me', { displayName })
    user.value = res.user
  }

  /** 清空本地会话状态。 */
  function clear(): void {
    status.value = 'anonymous'
    user.value = null
    workspaces.value = []
  }

  // 后端返回 401 时自动清状态——会话在别处过期的情况
  setUnauthorizedHandler(() => {
    if (status.value === 'authenticated') {
      clear()
    }
  })

  return {
    status,
    user,
    workspaces,
    loading,
    isAuthenticated,
    fetchMe,
    login,
    register,
    logout,
    updateDisplayName,
    clear,
  }
})
