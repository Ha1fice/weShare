<script setup lang="ts">
import IconBase from './IconBase.vue'
import { ICONS, type IconName } from './index.js'

defineProps<{ name: IconName; size?: number; filled?: boolean }>()
</script>

<template>
  <IconBase :paths="ICONS[name]" :size="size" :filled="filled" />
</template>
