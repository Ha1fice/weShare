<script setup lang="ts">
defineProps<{ id?: string; placeholder?: string; rows?: number; invalid?: boolean; disabled?: boolean }>()
const model = defineModel<string>({ default: '' })
</script>

<template>
  <textarea
    :id="id"
    v-model="model"
    :rows="rows ?? 3"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-invalid="invalid ? 'true' : undefined"
    :class="['field resize-none leading-relaxed', invalid ? 'field-invalid' : '']"
  />
</template>
