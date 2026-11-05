<script setup lang="ts">
/**
 * 行内提示条。
 *
 * 四个语气对应四种需要用户做的事：error 要修、warning 要注意、
 * success 已生效、info 只是告知。图标与配色一起变化——只靠颜色区分
 * 对色觉障碍用户无效。
 */
import AppIcon from '../icons/AppIcon.vue'
import type { IconName } from '../icons/index.js'

const props = withDefaults(defineProps<{ tone?: 'error' | 'warning' | 'success' | 'info' }>(), {
  tone: 'info',
})

const MAP: Record<string, { icon: IconName; cls: string }> = {
  error: { icon: 'alert-circle', cls: 'bg-danger-soft text-danger border-danger/20' },
  warning: { icon: 'alert', cls: 'bg-warning-soft text-warning border-warning/20' },
  success: { icon: 'check', cls: 'bg-success-soft text-success border-success/20' },
  info: { icon: 'info', cls: 'bg-brand-50 text-brand-700 border-brand-500/20' },
}
</script>

<template>
  <div
    :class="['flex items-start gap-2 rounded border px-3 py-2 text-[12.5px] leading-relaxed', MAP[props.tone]!.cls]"
    :role="tone === 'error' ? 'alert' : 'status'"
  >
    <AppIcon :name="MAP[props.tone]!.icon" :size="14" class="mt-px shrink-0" />
    <div class="min-w-0 flex-1">
      <slot />
    </div>
  </div>
</template>
