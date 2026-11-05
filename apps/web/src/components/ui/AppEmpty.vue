<script setup lang="ts">
/**
 * 空状态。
 *
 * 空态不是"没数据"的一句灰字——它同时要回答"这里是什么"和
 * "我下一步能做什么"。所以 action 插槽是常规项，不是例外。
 */
import AppIcon from '../icons/AppIcon.vue'
import type { IconName } from '../icons/index.js'

defineProps<{ icon?: IconName; title: string; description?: string | undefined }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center px-6 py-12 text-center">
    <span class="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-subtle text-faint">
      <AppIcon :name="icon ?? 'file'" :size="20" />
    </span>
    <p class="text-[13px] font-medium text-ink">{{ title }}</p>
    <p v-if="description" class="mt-1 max-w-[36ch] text-[12px] leading-relaxed text-muted">
      {{ description }}
    </p>
    <div v-if="$slots.default" class="mt-4">
      <slot />
    </div>
  </div>
</template>
