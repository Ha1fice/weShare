<script setup lang="ts">
/**
 * 首页：空间入口。
 *
 * 有空间 → 自动进入第一个；没有 → 引导创建。
 * Phase 1 不做"最近访问"这类聚合视图。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError, api } from '@/api/client.js'
import type { WorkspaceView } from '@weshare/shared'
import { useSessionStore } from '@/stores/session.js'

const session = useSessionStore()
const router = useRouter()

const newName = ref('')
const errorMessage = ref('')
const creating = ref(false)

onMounted(async () => {
  // 已有空间直接进第一个
  const first = session.workspaces[0]
  if (first) {
    await router.replace({ name: 'workspace', params: { workspaceId: first.id } })
  }
})

async function createWorkspace(): Promise<void> {
  const name = newName.value.trim()
  if (!name || creating.value) return

  creating.value = true
  errorMessage.value = ''
  try {
    const res = await api.post<{ workspace: WorkspaceView }>('/workspaces', { name })
    await session.fetchMe()
    await router.push({ name: 'workspace', params: { workspaceId: res.workspace.id } })
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '创建失败'
  } finally {
    creating.value = false
  }
}

async function onLogout(): Promise<void> {
  await session.logout()
  await router.push({ name: 'login' })
}
</script>

<template>
  <main class="mx-auto max-w-md p-8">
    <header class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-900">weShare</h1>
        <p class="mt-1 text-sm text-gray-500">{{ session.user?.displayName }}</p>
      </div>
      <button
        type="button"
        class="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        @click="onLogout"
      >
        登出
      </button>
    </header>

    <p
      v-if="errorMessage"
      role="alert"
      class="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {{ errorMessage }}
    </p>

    <!-- 有空间时 onMounted 会立刻跳转，这里只是过渡态 -->
    <section v-if="session.workspaces.length > 0" class="text-sm text-gray-500">
      正在进入空间…
    </section>

    <section v-else class="rounded-lg border border-gray-200 bg-white p-6">
      <h2 class="mb-1 text-sm font-medium text-gray-900">创建你的第一个空间</h2>
      <p class="mb-4 text-xs text-gray-500">
        空间是文档的容器，成员按空间授权。创建后你将成为该空间的所有者。
      </p>

      <form class="flex gap-2" @submit.prevent="createWorkspace">
        <input
          v-model="newName"
          type="text"
          placeholder="空间名称"
          class="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          :disabled="creating || !newName.trim()"
          class="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300"
        >
          {{ creating ? '创建中…' : '创建' }}
        </button>
      </form>
    </section>
  </main>
</template>
