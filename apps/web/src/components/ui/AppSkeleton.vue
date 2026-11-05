<script setup lang="ts">
withDefaults(defineProps<{ width?: string; height?: string; rounded?: string }>(), {
  width: '100%',
  height: '12px',
  rounded: '4px',
})
</script>

<template>
  <span
    class="block animate-pulse bg-subtle"
    :style="{ width, height, borderRadius: rounded }"
    aria-hidden="true"
  />
</template>
