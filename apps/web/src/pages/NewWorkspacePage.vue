<script setup lang="ts">
/**
 * 创建空间。
 *
 * 单独一页而不是弹窗：这是新用户的第一个关键动作，值得占满屏幕、
 * 把"默认权限是什么意思"讲清楚。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/client.js'
import { workspacesApi } from '@/api/workspaces.js'
import { useSessionStore } from '@/stores/session.js'
import { AppAlert, AppButton, AppField, AppInput } from '@/components/ui/index.js'
import BrandMark from '@/components/layout/BrandMark.vue'

const router = useRouter()
const session = useSessionStore()

const name = ref('')
const defaultRole = ref<'view' | 'comment' | 'edit'>('edit')
const submitting = ref(false)
const errorMessage = ref('')
const touched = ref(false)

const nameError = computed(() => {
  const v = name.value.trim()
  if (!v) return '请输入空间名称'
  if (v.length > 64) return '名称不能超过 64 个字符'
  return ''
})

const OPTIONS = [
  { value: 'edit', label: '可编辑', desc: '空间成员默认可编辑彼此创建的文档' },
  { value: 'comment', label: '可评论', desc: '默认可读并评论，不能直接改正文' },
  { value: 'view', label: '只读', desc: '默认可读，修改需要单独授权' },
] as const

async function onSubmit(): Promise<void> {
  touched.value = true
  if (nameError.value || submitting.value) return

  submitting.value = true
  errorMessage.value = ''
  try {
    const res = await workspacesApi.create({ name: name.value.trim(), defaultRole: defaultRole.value })
    await session.fetchMe()
    await router.replace({ name: 'workspace', params: { workspaceId: res.workspace.id } })
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '创建失败，请重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-canvas">
    <header class="flex h-11 shrink-0 items-center border-b border-line bg-surface px-3">
      <RouterLink to="/" class="rounded px-1 focus-ring" aria-label="回到首页">
        <BrandMark size="sm" />
      </RouterLink>
    </header>

    <main class="mx-auto w-full max-w-[440px] px-5 py-12">
      <h1 class="text-[19px] font-semibold tracking-tight text-ink">新建工作空间</h1>
      <p class="mt-1 text-[12.5px] leading-relaxed text-muted">
        空间之间数据完全隔离。你在别的空间里的文档，这里看不到。
      </p>

      <form class="mt-7 space-y-5" novalidate @submit.prevent="onSubmit">
        <AppField label="空间名称" html-for="ws-name" required :error="touched ? nameError : ''">
          <AppInput
            id="ws-name"
            v-model="name"
            placeholder="例如：产品设计组"
            :disabled="submitting"
            :invalid="touched && Boolean(nameError)"
          />
        </AppField>

        <div>
          <p class="mb-1.5 text-[12.5px] font-medium text-ink">默认权限</p>
          <p class="mb-2.5 text-[11.5px] leading-relaxed text-faint">
            新成员加入后，对空间内「工作区可见」文档的默认角色。之后仍可对单个文档单独授权。
          </p>
          <div class="space-y-1.5">
            <label
              v-for="opt in OPTIONS"
              :key="opt.value"
              :class="[
                'flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition',
                defaultRole === opt.value
                  ? 'border-brand-400 bg-brand-50/60'
                  : 'border-line bg-surface hover:border-line-strong',
              ]"
            >
              <input
                v-model="defaultRole"
                type="radio"
                :value="opt.value"
                :disabled="submitting"
                class="mt-0.5 accent-brand-600"
              />
              <span class="min-w-0">
                <span class="block text-[12.5px] font-medium text-ink">{{ opt.label }}</span>
                <span class="mt-0.5 block text-[11.5px] leading-relaxed text-muted">{{ opt.desc }}</span>
              </span>
            </label>
          </div>
        </div>

        <AppAlert v-if="errorMessage" tone="error">{{ errorMessage }}</AppAlert>

        <div class="flex gap-2 pt-1">
          <AppButton size="lg" :to="{ name: 'home' }">取消</AppButton>
          <AppButton
            type="submit"
            variant="primary"
            size="lg"
            class="flex-1"
            :loading="submitting"
            :disabled="submitting"
          >
            {{ submitting ? '创建中…' : '创建空间' }}
          </AppButton>
        </div>
      </form>
    </main>
  </div>
</template>
