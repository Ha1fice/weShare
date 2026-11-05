<script setup lang="ts">
withDefaults(defineProps<{ size?: number; label?: string }>(), { size: 14, label: '加载中' })
</script>

<template>
  <span
    class="inline-block animate-spin rounded-full border-[1.5px] border-line-strong border-t-brand-600"
    :style="{ width: `${size}px`, height: `${size}px` }"
    role="status"
    :aria-label="label"
  />
</template>
