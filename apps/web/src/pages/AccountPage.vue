<script setup lang="ts">
/**
 * 账号设置：改显示名、看邮箱、登出。
 *
 * 1.0 不做改密码/改邮箱——那需要验证流程，属于安全加固而不是产品主线。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/client.js'
import { useSessionStore } from '@/stores/session.js'
import { AppAlert, AppButton, AppField, AppInput } from '@/components/ui/index.js'
import { toast } from '@/components/ui/toast.js'
import BrandMark from '@/components/layout/BrandMark.vue'

const session = useSessionStore()
const router = useRouter()

const displayName = ref(session.user?.displayName ?? '')
const saving = ref(false)
const errorMessage = ref('')

const dirty = computed(() => displayName.value.trim() !== (session.user?.displayName ?? ''))
const invalid = computed(() => !displayName.value.trim())

async function save(): Promise<void> {
  if (!dirty.value || invalid.value || saving.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    await session.updateDisplayName(displayName.value.trim())
    toast('显示名已更新')
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function logout(): Promise<void> {
  await session.logout()
  await router.push({ name: 'login' })
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-canvas">
    <header class="flex h-11 shrink-0 items-center border-b border-line bg-surface px-3">
      <RouterLink to="/" class="rounded px-1 focus-ring" aria-label="回到首页">
        <BrandMark size="sm" />
      </RouterLink>
    </header>

    <main class="mx-auto w-full max-w-[440px] px-5 py-10">
      <h1 class="mb-6 text-[19px] font-semibold tracking-tight text-ink">账号设置</h1>

      <section class="rounded-lg border border-line bg-surface p-4">
        <form class="space-y-4" novalidate @submit.prevent="save">
          <AppField label="显示名" html-for="displayName" hint="同事在成员列表和在线状态里看到的名字">
            <AppInput id="displayName" v-model="displayName" :disabled="saving" :invalid="invalid" />
          </AppField>

          <AppField label="邮箱" html-for="email" hint="登录凭据，1.0 暂不支持修改">
            <AppInput id="email" :model-value="session.user?.email ?? ''" disabled />
          </AppField>

          <AppAlert v-if="errorMessage" tone="error">{{ errorMessage }}</AppAlert>

          <div class="flex justify-end">
            <AppButton type="submit" variant="primary" :loading="saving" :disabled="!dirty || invalid">
              保存
            </AppButton>
          </div>
        </form>
      </section>

      <section class="mt-4 rounded-lg border border-line bg-surface p-4">
        <p class="text-[13px] font-medium text-ink">退出登录</p>
        <p class="mt-1 text-[11.5px] text-muted">会立即清除服务端会话，之后需要重新输入密码。</p>
        <div class="mt-3">
          <AppButton variant="danger" icon="logout" @click="logout">退出登录</AppButton>
        </div>
      </section>
    </main>
  </div>
</template>
