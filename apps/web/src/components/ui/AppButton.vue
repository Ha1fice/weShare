<script setup lang="ts">
/**
 * 按钮。
 *
 * 全站唯一的按钮视觉来源——页面里不再手拼 `class`。
 * variant 表达**意图**（primary 主动作、danger 破坏性），不是表达颜色；
 * size 只有三档，够用且不会漂移。
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import AppIcon from '../icons/AppIcon.vue'
import type { IconName } from '../icons/index.js'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'
    size?: 'sm' | 'md' | 'lg'
    /** 左侧图标。 */
    icon?: IconName | undefined
    /** 仅图标（用于工具栏、行内操作）。此时必须给 aria-label。 */
    square?: boolean
    loading?: boolean
    disabled?: boolean
    type?: 'button' | 'submit'
    /** 传了就渲染成 RouterLink（跳转类操作语义上不该是 button）。 */
    to?: string | { name: string; params?: Record<string, string> } | undefined
  }>(),
  { variant: 'secondary', size: 'md', square: false, loading: false, disabled: false, type: 'button' },
)

const variantClass = computed(() => {
  switch (props.variant) {
    case 'primary':
      return 'bg-brand-600 text-white border-transparent hover:bg-brand-700 active:bg-brand-800 shadow-sm'
    case 'danger':
      return 'bg-danger text-white border-transparent hover:bg-[#b91c1c] active:bg-[#991b1b] shadow-sm'
    case 'ghost':
      return 'bg-transparent text-muted border-transparent hover:bg-subtle hover:text-ink'
    case 'danger-ghost':
      return 'bg-transparent text-danger border-transparent hover:bg-danger-soft'
    default:
      return 'bg-surface text-ink border-line-strong hover:bg-subtle active:bg-[#e9ebef]'
  }
})

const sizeClass = computed(() => {
  if (props.square) {
    return props.size === 'sm' ? 'h-6 w-6' : props.size === 'lg' ? 'h-9 w-9' : 'h-7 w-7'
  }
  switch (props.size) {
    case 'sm':
      return 'h-6 px-2 text-[11px] gap-1'
    case 'lg':
      return 'h-9 px-4 text-sm gap-2'
    default:
      return 'h-7 px-2.5 text-[12.5px] gap-1.5'
  }
})

const isDisabled = computed(() => props.disabled || props.loading)
const iconSize = computed(() => (props.size === 'sm' ? 12 : props.size === 'lg' ? 16 : 14))
</script>

<template>
  <component
    :is="to ? RouterLink : 'button'"
    :to="to"
    :type="to ? undefined : type"
    :disabled="to ? undefined : isDisabled"
    :aria-disabled="to && isDisabled ? 'true' : undefined"
    :aria-busy="loading ? 'true' : undefined"
    :class="[
      'inline-flex shrink-0 select-none items-center justify-center rounded border font-medium',
      'transition-colors duration-100 focus-ring',
      variantClass,
      sizeClass,
      isDisabled ? 'pointer-events-none opacity-50' : '',
    ]"
  >
    <span
      v-if="loading"
      class="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
      aria-hidden="true"
    />
    <AppIcon v-else-if="icon" :name="icon" :size="iconSize" />
    <slot v-if="!square" />
  </component>
</template>
