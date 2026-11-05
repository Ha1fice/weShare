<script setup lang="ts">
/**
 * 品牌标识。
 *
 * 一个几何图形 + 文字，不引外部资源——避免 404、避免额外请求、
 * 也避免"深色背景上需要另一份图"这类维护成本。
 */
withDefaults(defineProps<{ size?: 'sm' | 'md'; onDark?: boolean }>(), { size: 'md', onDark: false })
</script>

<template>
  <div class="flex items-center gap-2">
    <span
      :class="[
        'flex items-center justify-center rounded-[6px]',
        onDark ? 'bg-white/12 text-white' : 'bg-brand-600 text-white',
        size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
      ]"
    >
      <svg :width="size === 'sm' ? 13 : 15" :height="size === 'sm' ? 13 : 15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2.2" y="1.8" width="8.6" height="11.2" rx="1.4" stroke="currentColor" stroke-width="1.4" />
        <path d="M11.2 5.2h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6.6a1 1 0 0 1-1-1v-.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </span>
    <span
      :class="[
        'font-semibold tracking-tight',
        size === 'sm' ? 'text-[13px]' : 'text-[14px]',
        onDark ? 'text-white' : 'text-ink',
      ]"
      >weShare</span
    >
  </div>
</template>
