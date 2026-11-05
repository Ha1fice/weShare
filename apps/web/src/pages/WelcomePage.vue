<script setup lang="ts">
/**
 * 首屏：输个名字就进（免密模式）。
 *
 * 这是"简版"的入口页——没有邮箱、没有密码、没有注册按钮。
 * 用户输入名字 → 客户端把设备指纹哈希成 identity key → 服务端由它派生账号
 * → 首次进入自动建好默认空间与一篇欢迎文档。
 *
 * 同一台设备再次打开会自动回落到同一身份，所以这一页通常只在第一次出现；
 * 它也可以被当成"改名"入口：重新输一个名字，身份不变、显示名更新。
 *
 * 密码登录仍然保留在 `/login`，用于同事之间互相访问对方的空间（邀请是按邮箱走的）。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/client.js'
import { useSessionStore } from '@/stores/session.js'

const session = useSessionStore()
const router = useRouter()

const displayName = ref('')
const submitting = ref(false)
const errorMessage = ref('')

const localError = computed(() => (displayName.value.trim() ? '' : '先给自己起个名字'))
const canSubmit = computed(() => localError.value === '' && !submitting.value)

/** 名字里允许的表情/组合字符按"人眼看到的一个字"计数，与后端上限一致。 */
const NAME_MAX = 64

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return

  submitting.value = true
  errorMessage.value = ''

  try {
    await session.establishIdentity(displayName.value.trim())
    const redirect = router.currentRoute.value.query.redirect
    await router.push(typeof redirect === 'string' ? redirect : '/')
  } catch (err) {
    errorMessage.value =
      err instanceof ApiError
        ? err.network
          ? '连不上服务器，请检查网络后重试'
          : err.message
        : '发生未知错误，请重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-slate-50 p-4">
    <div class="w-full max-w-md">
      <div class="mb-8 text-center">
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">weShare</h1>
        <p class="mt-2 text-sm text-slate-500">团队文档，打开就能写</p>
      </div>

      <form
        class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        novalidate
        @submit.prevent="onSubmit"
      >
        <label for="display-name" class="block text-sm font-medium text-slate-700">
          你叫什么名字
        </label>
        <input
          id="display-name"
          v-model="displayName"
          type="text"
          name="displayName"
          :maxlength="NAME_MAX"
          autocomplete="nickname"
          autofocus
          class="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          placeholder="例如：张三"
          @keydown.enter.prevent="onSubmit"
        />
        <p class="mt-2 text-xs text-slate-400">
          名字会显示给协作的同事。这台设备会记住你，下次打开直接进。
        </p>

        <p
          v-if="errorMessage"
          role="alert"
          class="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {{ errorMessage }}
        </p>

        <button
          type="submit"
          :disabled="!canSubmit"
          class="mt-6 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {{ submitting ? '正在进入…' : '进入' }}
        </button>
      </form>

      <p class="mt-6 text-center text-xs text-slate-400">
        同事邀请你用邮箱开通了账号？
        <RouterLink to="/login" class="text-blue-600 hover:underline">用账号登录</RouterLink>
      </p>
    </div>
  </div>
</template>
