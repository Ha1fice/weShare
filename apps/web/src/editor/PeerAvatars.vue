<script setup lang="ts">
/**
 * 在线成员头像组。
 *
 * 只显示"有几个人、是谁"，超过三个折叠成 +N。
 * 头像是首字母 + 稳定色相，与空间设置页里的成员头像同一套规则——
 * 同一个同事在哪儿看都是同一个颜色，这是"统一"最容易被忽略的一半。
 */
import { computed } from 'vue'
import { colorForUser } from './collab.js'

const props = withDefaults(
  defineProps<{ peers: Array<{ clientId: number; name: string }>; max?: number }>(),
  { max: 3 },
)

const shown = computed(() => props.peers.slice(0, props.max))
const overflow = computed(() => Math.max(0, props.peers.length - props.max))
</script>

<template>
  <div v-if="peers.length > 0" class="flex items-center" :aria-label="`${peers.length} 人在线`">
    <span
      v-for="(p, i) in shown"
      :key="p.clientId"
      :title="p.name"
      class="flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface text-[10px] font-semibold text-white"
      :style="{ backgroundColor: colorForUser(String(p.clientId)), marginLeft: i === 0 ? '0' : '-6px' }"
    >
      {{ p.name.trim().slice(0, 1).toUpperCase() }}
    </span>
    <span
      v-if="overflow > 0"
      class="flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-surface bg-subtle px-1 text-[10px] font-medium text-muted"
      style="margin-left: -6px"
    >
      +{{ overflow }}
    </span>
  </div>
</template>
