<script setup lang="ts">
/**
 * 应用外壳：唯一的顶栏。
 *
 * 顶栏只放"全局"的东西：品牌、空间切换、搜索、账号。
 * 页面级的操作（新建、筛选、排序）在页面自己的头部，不往顶栏塞——
 * 混在一起会让用户分不清"这按钮影响当前页还是整个空间"。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useSessionStore } from '@/stores/session.js'
import BrandMark from './BrandMark.vue'
import WorkspaceSwitcher from './WorkspaceSwitcher.vue'
import UserMenu from './UserMenu.vue'
import AppIcon from '../icons/AppIcon.vue'

const route = useRoute()
const session = useSessionStore()

const workspaceId = computed(() => String(route.params.workspaceId ?? ''))
const inWorkspace = computed(() => Boolean(workspaceId.value))
</script>

<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-ink">
    <header
      class="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3"
    >
      <RouterLink to="/" class="rounded px-1 focus-ring" aria-label="回到首页">
        <BrandMark size="sm" />
      </RouterLink>

      <span class="mx-0.5 h-4 w-px bg-line" aria-hidden="true" />

      <WorkspaceSwitcher v-if="inWorkspace" :current-id="workspaceId" />

      <div class="ml-auto flex items-center gap-1">
        <RouterLink
          v-if="inWorkspace"
          :to="{ name: 'trash', params: { workspaceId } }"
          class="flex h-7 items-center gap-1.5 rounded px-2 text-[12.5px] text-muted transition-colors hover:bg-subtle hover:text-ink focus-ring"
        >
          <AppIcon name="trash" :size="13" />
          <span class="hidden sm:inline">回收站</span>
        </RouterLink>

        <RouterLink
          v-if="inWorkspace"
          :to="{ name: 'workspace-settings', params: { workspaceId } }"
          class="flex h-7 items-center gap-1.5 rounded px-2 text-[12.5px] text-muted transition-colors hover:bg-subtle hover:text-ink focus-ring"
          :aria-label="`${session.workspaces.find((w) => w.id === workspaceId)?.name ?? '空间'}设置`"
        >
          <AppIcon name="users" :size="13" />
          <span class="hidden sm:inline">成员</span>
        </RouterLink>

        <span class="mx-0.5 h-4 w-px bg-line" aria-hidden="true" />
        <UserMenu />
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <slot />
    </div>
  </div>
</template>
