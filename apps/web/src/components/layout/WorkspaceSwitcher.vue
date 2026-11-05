<script setup lang="ts">
/**
 * 空间切换器。
 *
 * 替代原先的原生 <select>：原生 select 的弹出层在跨平台上样式不可控，
 * 且无法承载"每个空间的角色"这类附加信息。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session.js'
import { AppMenu, type MenuItem } from '@/components/ui/index.js'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{ currentId: string }>()

const session = useSessionStore()
const router = useRouter()

const current = computed(() => session.workspaces.find((w) => w.id === props.currentId))

const ROLE_LABEL: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读',
}

const items = computed<MenuItem[]>(() => [
  ...session.workspaces.map((w) => ({
    key: w.id,
    label: w.id === props.currentId ? `${w.name}（当前）` : `${w.name} · ${ROLE_LABEL[w.role] ?? w.role}`,
  })),
  { key: '__create', label: '新建空间', icon: 'plus' as const, separated: true },
])

async function onSelect(key: string): Promise<void> {
  if (key === '__create') {
    await router.push({ name: 'new-workspace' })
    return
  }
  if (key === props.currentId) return
  await router.push({ name: 'workspace', params: { workspaceId: key } })
}
</script>

<template>
  <AppMenu :items="items" @select="onSelect">
    <template #trigger>
      <button
        type="button"
        class="flex h-7 items-center gap-1.5 rounded border border-transparent px-1.5 text-[13px] font-medium text-ink transition-colors hover:border-line hover:bg-subtle focus-ring"
        :aria-label="`当前空间：${current?.name ?? '未选择'}，点击切换`"
      >
        <span class="max-w-[160px] truncate">{{ current?.name ?? '选择空间' }}</span>
        <AppIcon name="chevron-down" :size="12" class="text-faint" />
      </button>
    </template>
  </AppMenu>
</template>
