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
import BrandMark from '@/components/layout/BrandMark.vue'
import { AppAlert, AppButton, AppField, AppInput } from '@/components/ui/index.js'

const session = useSessionStore()
const router = useRouter()

/** 是否免密模式——决定页脚那条入口是「用账号登录」还是模式说明。 */
const deviceMode = session.deviceMode

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
  <div class="flex min-h-screen flex-col bg-canvas">
    <header class="flex h-11 shrink-0 items-center border-b border-line bg-surface px-3">
      <BrandMark size="sm" />
      <span v-if="deviceMode" class="ml-2 rounded-full border border-line bg-subtle px-2 py-0.5 text-[11px] text-muted">
        免密模式
      </span>
    </header>

    <main class="flex flex-1 items-start justify-center px-5 pb-16 pt-[12vh]">
      <div class="w-full max-w-[380px]">
        <h1 class="text-[22px] font-semibold tracking-tight text-ink">进来就能写</h1>
        <p class="mt-1.5 text-[13px] leading-relaxed text-muted">
          输一个名字，马上进入你的空间。这台设备会记住你，下次打开直接进去。
        </p>

        <form class="mt-7" novalidate @submit.prevent="onSubmit">
          <AppField label="你的名字" html-for="display-name" :error="localError || ''">
            <AppInput
              id="display-name"
              v-model="displayName"
              :maxlength="NAME_MAX"
              autocomplete="nickname"
              autofocus
              :invalid="localError !== ''"
              placeholder="例如：张三"
              @keydown.enter.prevent="onSubmit"
            />
          </AppField>

          <p class="mt-1.5 text-[11.5px] text-faint">
            名字会显示给协作的同事。
          </p>

          <AppAlert v-if="errorMessage" tone="error" class="mt-4">{{ errorMessage }}</AppAlert>

          <AppButton
            type="submit"
            variant="primary"
            size="lg"
            class="mt-6 w-full"
            :disabled="submitting"
            :loading="submitting"
          >
            {{ submitting ? '正在进入…' : '进入' }}
          </AppButton>
        </form>

        <!--
          免密模式下这条入口必须藏起来：守卫会把已登录用户从 /login 送回首页，
          而没有密码账号的人点进去只会看到一张登录表单。
          要回到密码登录，先「换一个身份」——见下方说明。
        -->
        <p v-if="!deviceMode" class="mt-6 text-center text-[12px] text-muted">
          同事邀请你用邮箱开通了账号？
          <RouterLink to="/login" class="text-brand-600 hover:underline focus-ring">用账号登录</RouterLink>
        </p>
      </div>
    </main>

    <footer class="mx-auto w-full max-w-[380px] space-y-3 pb-8 text-[11.5px] leading-relaxed text-faint">
      <!--
        身份提示这句是产品定稿文案，逐字保留：
        身份记在这台机器上，换设备或清缓存会看到一个全新的空空间（旧内容没丢，在原身份下）。
      -->
      <p v-if="deviceMode">
        身份记在这台机器上，换设备或清缓存会看到一个全新的空空间（旧内容没丢，在原身份下）。
      </p>
      <p v-if="deviceMode">试用机 · 免密模式 — 请勿在本机存放真实或敏感资料。</p>
      <p v-else>密码模式下身份跟随账号，换设备登录即可找回。</p>
    </footer>
  </div>
</template>
