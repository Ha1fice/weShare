<script setup lang="ts">
/**
 * 轻提示。用于"改好了"这类不需要用户决策的反馈。
 *
 * 刻意不做成队列式通知中心：1.0 里值得留痕的事（保存失败、权限不足）
 * 应该在页面里就地显示，而不是飘一下就没。Toast 只负责"刚才那下生效了"。
 */
import { toasts, dismissToast } from './toast.js'
import AppIcon from '../icons/AppIcon.vue'

const TONE = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-brand-600',
} as const
const ICON = { success: 'check', error: 'alert-circle', info: 'info' } as const
</script>

<template>
  <div class="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
    <TransitionGroup
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 translate-y-1"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-ink shadow-pop"
        role="status"
      >
        <AppIcon :name="ICON[t.tone]" :size="14" :class="TONE[t.tone]" />
        <span>{{ t.message }}</span>
        <button
          type="button"
          class="ml-1 rounded text-faint hover:text-ink focus-ring"
          aria-label="关闭提示"
          @click="dismissToast(t.id)"
        >
          <AppIcon name="x" :size="12" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
