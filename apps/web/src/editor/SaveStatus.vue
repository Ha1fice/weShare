<script setup lang="ts">
/**
 * 保存状态指示器。
 *
 * 五种状态对应五种用户要理解的事，文案必须说清"现在能不能关页面"：
 *   - 未保存改动 / 保存中 → 还不能
 *   - 已保存 → 可以
 *   - 保存失败 → 内容还在本地，但要重试
 *   - 冲突 → 需要用户做选择
 *   - 只读 → 本来就不会保存，不该让人以为是自己没保存
 *
 * 用 aria-live="polite"：状态变化要能被读屏播报，但不要打断输入。
 */
import { computed } from 'vue'
import type { AutosaveState } from './autosave.js'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps<{ state: AutosaveState }>()

const view = computed(() => {
  switch (props.state.kind) {
    case 'saving':
      return { icon: 'cloud' as const, text: '保存中…', cls: 'text-muted', spin: true }
    case 'dirty':
      return { icon: 'cloud' as const, text: '未保存的改动', cls: 'text-warning', spin: false }
    case 'saved':
      return { icon: 'check' as const, text: '已保存', cls: 'text-success', spin: false }
    case 'failed':
      return { icon: 'cloud-off' as const, text: '保存失败', cls: 'text-danger', spin: false }
    case 'conflict':
      return { icon: 'alert' as const, text: '版本冲突', cls: 'text-danger', spin: false }
    case 'readonly':
      return { icon: 'user' as const, text: '只读', cls: 'text-muted', spin: false }
    default:
      return { icon: 'check' as const, text: '已保存', cls: 'text-faint', spin: false }
  }
})
</script>

<template>
  <span
    :class="['flex items-center gap-1 text-[11.5px] transition-colors', view.cls]"
    role="status"
    aria-live="polite"
  >
    <AppIcon :name="view.icon" :size="12" :class="view.spin ? 'animate-pulse' : ''" />
    <span>{{ view.text }}</span>
    <slot />
  </span>
</template>
