<script setup lang="ts">
/**
 * 首页 = 空间列表。
 *
 * 之前是"有空间就直接跳进第一个"——那样用户永远看不到自己有哪几个空间，
 * 也没法在有多个空间时选择。现在做成一次显式的选择，只有恰好一个空间
 * 且只属于一种情况时才自动进入。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session.js'
import BrandMark from '@/components/layout/BrandMark.vue'
import UserMenu from '@/components/layout/UserMenu.vue'
import { AppButton, AppEmpty } from '@/components/ui/index.js'
import AppIcon from '@/components/icons/AppIcon.vue'

const session = useSessionStore()
const router = useRouter()

const ROLE_LABEL: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读成员',
}

const spaces = computed(() => session.workspaces)

function enter(id: string): void {
  void router.push({ name: 'workspace', params: { workspaceId: id } })
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-canvas">
    <header class="flex h-11 shrink-0 items-center border-b border-line bg-surface px-3">
      <BrandMark size="sm" />
      <div class="ml-auto"><UserMenu /></div>
    </header>

    <main class="mx-auto w-full max-w-3xl px-5 py-10">
      <div class="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 class="text-[19px] font-semibold tracking-tight text-ink">工作空间</h1>
          <p class="mt-1 text-[12.5px] text-muted">
            你好，{{ session.user?.displayName }}。选择一个空间继续。
          </p>
        </div>
        <AppButton
          variant="primary"
          icon="plus"
          @click="router.push({ name: 'new-workspace' })"
        >
          新建空间
        </AppButton>
      </div>

      <div v-if="spaces.length > 0" class="grid gap-2 sm:grid-cols-2">
        <button
          v-for="w in spaces"
          :key="w.id"
          type="button"
          class="group flex items-center gap-3 rounded-lg border border-line bg-surface p-3.5 text-left transition hover:border-brand-300 hover:shadow-sm focus-ring"
          @click="enter(w.id)"
        >
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-[13px] font-semibold text-brand-700"
          >
            {{ w.name.trim().slice(0, 1).toUpperCase() }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13.5px] font-medium text-ink">{{ w.name }}</span>
            <span class="mt-0.5 block text-[11.5px] text-faint">{{ ROLE_LABEL[w.role] ?? w.role }}</span>
          </span>
          <AppIcon name="chevron-right" :size="14" class="shrink-0 text-faint transition group-hover:text-brand-600" />
        </button>
      </div>

      <div v-else class="rounded-lg border border-dashed border-line-strong bg-surface">
        <AppEmpty
          icon="users"
          title="还没有工作空间"
          description="空间是文档的容器，成员按空间授权。创建后你会成为该空间的所有者，可以邀请同事加入。"
        >
          <AppButton variant="primary" icon="plus" @click="router.push({ name: 'new-workspace' })">
            创建第一个空间
          </AppButton>
        </AppEmpty>
      </div>
    </main>
  </div>
</template>
