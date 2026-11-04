<script setup lang="ts">
/**
 * 登录 / 注册页。
 *
 * 两个模式合一页——注册时多一个显示名字段。切换模式不清空已填内容，
 * 避免用户来回切换时重新输入。
 *
 * 错误处理原则：
 *   - **不区分"邮箱不存在"与"密码错误"**——后端已统一返回"邮箱或密码错误"，
 *     前端原样展示，不做自己的推断；
 *   - 网络错误与业务错误分开提示（ApiError.network）。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/client.js'
import { useSessionStore } from '@/stores/session.js'
import { PASSWORD_MIN_LENGTH, checkPasswordPolicy } from '@weshare/shared'

const session = useSessionStore()
const router = useRouter()

const mode = ref<'login' | 'register'>('login')

const email = ref('')
const password = ref('')
const displayName = ref('')

const submitting = ref(false)
const errorMessage = ref('')

/** 本地校验的错误（不发请求就能发现的）。 */
const localError = computed(() => {
  if (mode.value === 'login') {
    if (!email.value.trim()) return '请输入邮箱'
    if (!password.value) return '请输入密码'
    return ''
  }

  if (!email.value.trim()) return '请输入邮箱'
  if (!displayName.value.trim()) return '请输入显示名'
  if (!password.value) return '请输入密码'

  const policy = checkPasswordPolicy(password.value)
  if (!policy.ok) {
    return policy.reason === 'too_short'
      ? `密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符`
      : '密码过长'
  }
  return ''
})

const canSubmit = computed(() => localError.value === '' && !submitting.value)

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return

  submitting.value = true
  errorMessage.value = ''

  try {
    if (mode.value === 'login') {
      await session.login(email.value.trim(), password.value)
    } else {
      await session.register(email.value.trim(), password.value, displayName.value.trim())
    }
    await router.push('/')
  } catch (err) {
    if (err instanceof ApiError) {
      errorMessage.value = err.message
    } else {
      errorMessage.value = '发生未知错误，请重试'
    }
  } finally {
    submitting.value = false
  }
}

function switchMode(): void {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  errorMessage.value = ''
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 p-4">
    <div class="w-full max-w-sm">
      <div class="mb-8 text-center">
        <h1 class="text-2xl font-semibold text-gray-900">weShare</h1>
        <p class="mt-2 text-sm text-gray-500">
          {{ mode === 'login' ? '登录你的账号' : '创建一个新账号' }}
        </p>
      </div>

      <form
        class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        novalidate
        @submit.prevent="onSubmit"
      >
        <div class="space-y-4">
          <div v-if="mode === 'register'">
            <label for="displayName" class="mb-1 block text-sm font-medium text-gray-700">
              显示名
            </label>
            <input
              id="displayName"
              v-model="displayName"
              type="text"
              autocomplete="nickname"
              :disabled="submitting"
              class="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>

          <div>
            <label for="email" class="mb-1 block text-sm font-medium text-gray-700">邮箱</label>
            <input
              id="email"
              v-model="email"
              type="email"
              autocomplete="email"
              :disabled="submitting"
              class="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>

          <div>
            <label for="password" class="mb-1 block text-sm font-medium text-gray-700">密码</label>
            <input
              id="password"
              v-model="password"
              type="password"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              :disabled="submitting"
              class="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
            />
            <p v-if="mode === 'register'" class="mt-1 text-xs text-gray-500">
              至少 {{ PASSWORD_MIN_LENGTH }} 个字符，建议用一句好记的长短语
            </p>
          </div>
        </div>

        <p
          v-if="errorMessage"
          role="alert"
          class="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {{ errorMessage }}
        </p>

        <p v-if="localError && !errorMessage" class="mt-4 text-xs text-gray-500">
          {{ localError }}
        </p>

        <button
          type="submit"
          :disabled="!canSubmit"
          class="mt-6 w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {{ submitting ? '处理中…' : mode === 'login' ? '登录' : '注册' }}
        </button>

        <button
          type="button"
          :disabled="submitting"
          class="mt-3 w-full text-center text-sm text-blue-600 hover:underline disabled:text-gray-400"
          @click="switchMode"
        >
          {{ mode === 'login' ? '还没有账号？去注册' : '已有账号？去登录' }}
        </button>
      </form>
    </div>
  </div>
</template>
