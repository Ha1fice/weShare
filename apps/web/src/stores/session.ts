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
import { router } from '../app/router.js'
import { resolveDeviceKey } from '../lib/device-key.js'

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous'

export const useSessionStore = defineStore('session', () => {
  const status = ref<SessionStatus>('unknown')
  const user = ref<CurrentUser | null>(null)
  const workspaces = ref<MeResponse['workspaces']>([])
  /** 正在与服务器通信（首屏检查、登录中）。 */
  const loading = ref(false)
  /**
   * 是否处在免密身份模式（设备指纹）。
   *
   * 由 `VITE_DEVICE_IDENTITY` 决定，服务端要同时打开 `DEVICE_IDENTITY`，
   * 否则身份接口 404 —— 前端会自然回落到登录页。
   */
  const deviceMode = import.meta.env.VITE_DEVICE_IDENTITY === 'true'

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

  /**
   * 用设备指纹建立身份（免密模式）。
   *
   * 幂等：同一设备重复调用回到同一账号；名字被当作显示名提交，
   * 用户改主意重新输名字就等于改名。
   */
  async function establishIdentity(displayName: string): Promise<void> {
    const deviceKey = await resolveDeviceKey()
    const res = await api.post<AuthResponse>('/auth/device', { deviceKey, displayName })
    user.value = res.user
    status.value = 'authenticated'
    await fetchMe()
  }

  /**
   * 把当前设备绑到已登录的账号。
   *
   * 用在"免密模式打开、但已经有密码账号"的场景：一次绑定之后，
   * 这台设备下次打开直接落到这个账号。
   */
  async function bindDevice(): Promise<void> {
    const deviceKey = await resolveDeviceKey()
    await api.post('/auth/device/bind', { deviceKey, displayName: user.value?.displayName ?? '' })
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

  // 后端返回 401 时自动清状态并送回登录页——会话在别处过期的情况。
  // 用户停在业务页面时会话过期，若只清状态不跳转，页面会停在无响应状态
  // （路由守卫只在导航时检查）。带 redirect 让登录后回跳原页面；
  // 已在登录页时不跳（登录失败也是 401，重复 push 会冲掉 redirect query，
  // 且避免与守卫互相触发循环）。
  setUnauthorizedHandler(() => {
    if (status.value !== 'authenticated') return
    clear()
    if (router.currentRoute.value.name !== 'login') {
      void router.push({
        name: 'login',
        query: { redirect: router.currentRoute.value.fullPath },
      })
    }
  })

  return {
    status,
    user,
    workspaces,
    loading,
    isAuthenticated,
    fetchMe,
    deviceMode,
    login,
    register,
    establishIdentity,
    bindDevice,
    logout,
    updateDisplayName,
    clear,
  }
})
