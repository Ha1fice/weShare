<script setup lang="ts">
/**
 * 单行输入框。
 *
 * 用 `defineModel` 做双向绑定：调用方写 `v-model`，不需要自己接
 * value/input 两个事件——少一层样板就少一处忘记同步的机会。
 */
defineProps<{
  id?: string
  type?: string
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  autocomplete?: string
}>()

const model = defineModel<string>({ default: '' })
</script>

<template>
  <input
    :id="id"
    v-model="model"
    :type="type ?? 'text'"
    :placeholder="placeholder"
    :disabled="disabled"
    :autocomplete="autocomplete"
    :aria-invalid="invalid ? 'true' : undefined"
    :class="['field', invalid ? 'field-invalid' : '']"
  />
</template>
