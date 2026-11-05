<script setup lang="ts">
/**
 * 登录 / 注册。
 *
 * 一页两模式：注册时多一个显示名字段。切模式不清空已填内容。
 *
 * 两件事是刻意的：
 *   1. **不区分"邮箱不存在"与"密码错误"**——后端已统一文案，前端原样展示，
 *      不做自己的推断（否则等于把账号枚举能力搬到了客户端）；
 *   2. 错误就地显示在按钮上方，不用 toast 飘走——用户需要看着它改。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client.js'
import { useSessionStore } from '@/stores/session.js'
import { PASSWORD_MIN_LENGTH, checkPasswordPolicy } from '@weshare/shared'
import { AppAlert, AppButton, AppField, AppInput } from '@/components/ui/index.js'
import AppIcon from '@/components/icons/AppIcon.vue'

const session = useSessionStore()
const route = useRoute()
const router = useRouter()

const mode = ref<'login' | 'register'>('login')
const email = ref('')
const password = ref('')
const displayName = ref('')
const submitting = ref(false)
const errorMessage = ref('')
/** 提交过一次之后才显示"请输入…"这类本地校验，否则一进页面就满屏红字。 */
const touched = ref(false)

const localError = computed(() => {
  if (!email.value.trim()) return '请输入邮箱'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) return '邮箱格式不正确'
  if (mode.value === 'register' && !displayName.value.trim()) return '请输入显示名'
  if (!password.value) return '请输入密码'
  if (mode.value === 'register') {
    const policy = checkPasswordPolicy(password.value)
    if (!policy.ok) {
      return policy.reason === 'too_short'
        ? `密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符`
        : '密码过长'
    }
  }
  return ''
})

const canSubmit = computed(() => !submitting.value)

async function onSubmit(): Promise<void> {
  touched.value = true
  if (localError.value || submitting.value) return

  submitting.value = true
  errorMessage.value = ''
  try {
    if (mode.value === 'login') {
      await session.login(email.value.trim(), password.value)
    } else {
      await session.register(email.value.trim(), password.value, displayName.value.trim())
    }
    // 会话过期被 401 送来这里时带 redirect，登录后回跳原页面。
    // 只接受站内路径（以 / 开头且不是 //），防开放重定向。
    const redirect = route.query.redirect
    const target =
      typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')
        ? redirect
        : '/'
    await router.replace(target)
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '发生未知错误，请重试'
  } finally {
    submitting.value = false
  }
}

function switchMode(): void {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  errorMessage.value = ''
  touched.value = false
}
</script>

<template>
  <div class="flex min-h-screen bg-canvas">
    <!-- 左：品牌与说明。窄屏隐藏，避免把表单挤没 -->
    <aside class="relative hidden w-[46%] max-w-[560px] shrink-0 flex-col justify-between overflow-hidden bg-[#101728] p-10 text-white lg:flex">
      <div class="absolute -right-24 -top-24 h-[320px] w-[320px] rounded-full bg-brand-500/20 blur-3xl" />
      <div class="absolute -bottom-32 -left-16 h-[280px] w-[280px] rounded-full bg-brand-400/10 blur-3xl" />

      <div class="relative flex items-center gap-2">
        <span class="flex h-7 w-7 items-center justify-center rounded-md bg-white/10">
          <AppIcon name="file" :size="15" />
        </span>
        <span class="text-[15px] font-semibold tracking-tight">weShare</span>
      </div>

      <div class="relative max-w-[380px]">
        <h1 class="text-[26px] font-semibold leading-snug tracking-tight">
          文档在团队里<br />长出来，而不是发来发去
        </h1>
        <p class="mt-3 text-[13px] leading-relaxed text-white/60">
          平台原生的富文本文档，服务端强制权限，多人实时协作。可私有化部署，
          数据在自己手里。
        </p>
        <ul class="mt-7 space-y-2.5 text-[12.5px] text-white/70">
          <li v-for="line in ['空间隔离，成员按角色授权', '正文唯一事实源，刷新与断线后仍可恢复', '目录、回收站、权限都可用键盘操作']" :key="line" class="flex items-start gap-2">
            <AppIcon name="check" :size="13" class="mt-0.5 shrink-0 text-brand-300" />
            <span>{{ line }}</span>
          </li>
        </ul>
      </div>

      <p class="relative text-[11.5px] text-white/35">
        Apache-2.0 · 部署在你自己的服务器上
      </p>
    </aside>

    <!-- 右：表单 -->
    <main class="flex flex-1 items-center justify-center px-5 py-10">
      <div class="w-full max-w-[352px]">
        <div class="mb-7">
          <div class="mb-6 flex items-center gap-2 lg:hidden">
            <span class="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-white">
              <AppIcon name="file" :size="15" />
            </span>
            <span class="text-[15px] font-semibold tracking-tight text-ink">weShare</span>
          </div>
          <h2 class="text-[20px] font-semibold tracking-tight text-ink">
            {{ mode === 'login' ? '登录' : '创建账号' }}
          </h2>
          <p class="mt-1 text-[12.5px] text-muted">
            {{ mode === 'login' ? '使用你的工作邮箱继续' : '注册后即可创建工作空间并邀请同事' }}
          </p>
        </div>

        <form class="space-y-3.5" novalidate @submit.prevent="onSubmit">
          <AppField
            v-if="mode === 'register'"
            label="显示名"
            html-for="displayName"
            :error="touched && !displayName.trim() ? '请输入显示名' : ''"
          >
            <AppInput
              id="displayName"
              v-model="displayName"
              autocomplete="nickname"
              placeholder="同事会看到这个名字"
              :disabled="submitting"
              :invalid="touched && !displayName.trim()"
            />
          </AppField>

          <AppField label="邮箱" html-for="email" :error="touched && !email.trim() ? '请输入邮箱' : ''">
            <AppInput
              id="email"
              v-model="email"
              type="email"
              autocomplete="email"
              placeholder="you@company.com"
              :disabled="submitting"
              :invalid="touched && !email.trim()"
            />
          </AppField>

          <AppField
            label="密码"
            html-for="password"
            :hint="mode === 'register' ? `至少 ${PASSWORD_MIN_LENGTH} 个字符，建议用一句好记的长短语` : undefined"
          >
            <AppInput
              id="password"
              v-model="password"
              type="password"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              :placeholder="mode === 'login' ? '输入密码' : '设置密码'"
              :disabled="submitting"
            />
          </AppField>

          <!-- 本地校验提示：只在提交过后出现，且不与服务端错误叠加 -->
          <AppAlert v-if="touched && localError && !errorMessage" tone="error">{{ localError }}</AppAlert>
          <AppAlert v-if="errorMessage" tone="error">{{ errorMessage }}</AppAlert>

          <AppButton
            type="submit"
            variant="primary"
            size="lg"
            class="w-full"
            :loading="submitting"
            :disabled="!canSubmit"
          >
            {{ submitting ? '处理中…' : mode === 'login' ? '登录' : '注册并继续' }}
          </AppButton>
        </form>

        <p class="mt-5 text-center text-[12.5px] text-muted">
          {{ mode === 'login' ? '还没有账号？' : '已有账号？' }}
          <button
            type="button"
            class="rounded font-medium text-brand-600 hover:text-brand-700 focus-ring"
            :disabled="submitting"
            @click="switchMode"
          >
            {{ mode === 'login' ? '创建一个' : '去登录' }}
          </button>
        </p>
      </div>
    </main>
  </div>
</template>
