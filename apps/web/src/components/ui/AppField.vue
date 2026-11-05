<script setup lang="ts">
/**
 * 表单字段容器：标签 + 控件 + 提示/错误。
 *
 * 抽出来是为了让"标签与控件的间距、错误文案的位置"在所有表单里一致——
 * 这些细节一旦各页各写，看起来就像不同人做的。
 */
defineProps<{
  label?: string
  htmlFor?: string
  hint?: string
  error?: string
  required?: boolean
}>()
</script>

<template>
  <div class="min-w-0">
    <div v-if="label" class="mb-1.5 flex items-baseline gap-1">
      <label :for="htmlFor" class="text-[12.5px] font-medium text-ink">{{ label }}</label>
      <span v-if="required" class="text-danger" aria-hidden="true">*</span>
    </div>
    <slot />
    <p v-if="error" class="mt-1 text-[11.5px] text-danger" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="mt-1 text-[11.5px] text-faint">{{ hint }}</p>
  </div>
</template>
