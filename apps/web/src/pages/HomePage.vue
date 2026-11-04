<script setup lang="ts">
/**
 * 首页（Phase 1 的工作台占位）。
 *
 * Phase 1 只做到"登录 + 看到自己的空间"，目录树与文档列表在 T4 实现。
 * 这一页先验证会话链路通了：显示当前用户与空间列表，并提供登出。
 */
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session.js'

const session = useSessionStore()
const router = useRouter()

async function onLogout(): Promise<void> {
  await session.logout()
  await router.push({ name: 'login' })
}
</script>

<template>
  <main class="mx-auto max-w-3xl p-8">
    <header class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-900">weShare</h1>
        <p class="mt-1 text-sm text-gray-500">
          {{ session.user?.displayName }}（{{ session.user?.email }}）
        </p>
      </div>
      <button
        type="button"
        class="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        @click="onLogout"
      >
        登出
      </button>
    </header>

    <section>
      <h2 class="mb-3 text-sm font-medium text-gray-700">我的空间</h2>

      <div
        v-if="session.workspaces.length === 0"
        class="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500"
      >
        还没有空间。创建空间的功能在 Phase 1 的 T3 实现。
      </div>

      <ul v-else class="space-y-2">
        <li
          v-for="ws in session.workspaces"
          :key="ws.id"
          class="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
        >
          <span class="text-sm font-medium text-gray-900">{{ ws.name }}</span>
          <span class="text-xs text-gray-500">{{ ws.role }}</span>
        </li>
      </ul>
    </section>
  </main>
</template>
