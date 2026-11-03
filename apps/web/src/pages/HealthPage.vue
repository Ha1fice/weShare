/** * 后端健康状态页。 * * Phase 1 T0.5 的验收判据："页面能显示后端健康状态"。 */

<script setup lang="ts">
import { onMounted, ref } from 'vue'

type HealthState = 'loading' | 'ok' | 'error'

const state = ref<HealthState>('loading')
const message = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/api/v1/healthz')
    const body = (await res.json()) as { ok?: boolean }
    if (res.ok && body.ok === true) {
      state.value = 'ok'
      message.value = '后端正常'
    } else {
      state.value = 'error'
      message.value = `后端返回异常（HTTP ${res.status}）`
    }
  } catch (err) {
    state.value = 'error'
    message.value = err instanceof Error ? err.message : '无法连接后端'
  }
})
</script>

<template>
  <main class="flex h-full flex-col items-center justify-center gap-4 p-8">
    <h1 class="text-2xl font-600">weShare</h1>
    <p class="text-sm text-gray-500">企业私有化协同在线文档平台</p>

    <div
      class="rounded-lg border border-gray-200 bg-white px-6 py-4 shadow-sm"
      data-testid="health-status"
    >
      <div class="flex items-center gap-3">
        <span
          class="inline-block h-2.5 w-2.5 rounded-full"
          :class="{
            'bg-gray-400': state === 'loading',
            'bg-green-500': state === 'ok',
            'bg-red-500': state === 'error',
          }"
        />
        <span class="text-sm">
          {{ state === 'loading' ? '检查中…' : message }}
        </span>
      </div>
    </div>
  </main>
</template>
