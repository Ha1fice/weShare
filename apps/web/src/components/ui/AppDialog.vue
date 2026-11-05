<script setup lang="ts">
/**
 * 对话框。
 *
 * 用 reka-ui 的 DialogRoot：焦点陷阱、Esc 关闭、点击遮罩关闭、滚动锁定、
 * aria-modal 都由它处理——这些自己写十次有九次漏。
 *
 * 约定：
 *   - 危险操作的确认框用 `tone="danger"`，确认按钮换成红色且**不默认聚焦**
 *     （避免用户习惯性回车就删了东西）；
 *   - 关闭后由父组件决定是否清理状态（`@update:open`）。
 */
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import AppButton from './AppButton.vue'
import AppIcon from '../icons/AppIcon.vue'
import type { IconName } from '../icons/index.js'

withDefaults(
  defineProps<{
    title: string
    description?: string | undefined
    confirmText?: string
    cancelText?: string
    tone?: 'default' | 'danger'
    /** 确认按钮禁用（例如"输入标题确认"还没输对）。 */
    confirmDisabled?: boolean
    loading?: boolean
    /** 弹窗右上角的图标类别，纯视觉提示。 */
    icon?: IconName | undefined
    width?: string
  }>(),
  {
    confirmText: '确定',
    cancelText: '取消',
    tone: 'default',
    confirmDisabled: false,
    loading: false,
    width: '420px',
  },
)

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-40 bg-[#0b1220]/40 backdrop-blur-[1px] data-[state=open]:animate-fade-in"
      />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-line bg-surface p-5 shadow-modal outline-none"
        :style="{ maxWidth: width }"
        @open-auto-focus="(e: Event) => (tone === 'danger' ? e.preventDefault() : undefined)"
      >
        <div class="flex items-start gap-3">
          <span
            v-if="icon"
            :class="[
              'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-brand-50 text-brand-600',
            ]"
          >
            <AppIcon :name="icon" :size="16" />
          </span>
          <div class="min-w-0 flex-1">
            <DialogTitle class="text-[15px] font-semibold text-ink">{{ title }}</DialogTitle>
            <DialogDescription v-if="description || $slots.description" class="mt-1 text-[12.5px] leading-relaxed text-muted">
              <slot name="description">{{ description }}</slot>
            </DialogDescription>
          </div>
        </div>

        <div v-if="$slots.default" class="mt-4">
          <slot />
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <DialogClose as-child>
            <AppButton size="md" :disabled="loading" @click="emit('cancel')">{{ cancelText }}</AppButton>
          </DialogClose>
          <AppButton
            size="md"
            :variant="tone === 'danger' ? 'danger' : 'primary'"
            :loading="loading"
            :disabled="confirmDisabled"
            @click="emit('confirm')"
          >
            {{ confirmText }}
          </AppButton>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
