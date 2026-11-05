<script setup lang="ts">
/**
 * 健康检查页。
 *
 * 保留它是为了运维：部署后用浏览器打开 /healthz 就能判断
 * "前端有没有起来、API 通不通"，不需要 curl 命令。
 */
import { onMounted, ref } from 'vue'
import { api } from '@/api/client.js'
import { AppAlert, AppButton, AppSpinner } from '@/components/ui/index.js'
import BrandMark from '@/components/layout/BrandMark.vue'

const state = ref<'loading' | 'ok' | 'fail'>('loading')
const detail = ref('')

async function check(): Promise<void> {
  state.value = 'loading'
  detail.value = ''
  try {
    const res = await api.get<{ status?: string }>('/health')
    state.value = 'ok'
    detail.value = JSON.stringify(res)
  } catch {
    // 前端与 API 不同源时健康检查也可能失败，但页面本身是活的
    state.value = 'fail'
    detail.value = '无法访问 /api/v1/health'
  }
}

onMounted(check)
</script>

<template>
  <div class="flex min-h-screen flex-col bg-canvas">
    <header class="flex h-11 items-center border-b border-line bg-surface px-3">
      <BrandMark size="sm" />
    </header>
    <main class="mx-auto w-full max-w-md px-5 py-12">
      <h1 class="mb-4 text-[17px] font-semibold text-ink">服务状态</h1>

      <div class="rounded-lg border border-line bg-surface p-4">
        <div class="flex items-center gap-2 text-[13px]">
          <AppSpinner v-if="state === 'loading'" :size="12" />
          <span
            v-else
            :class="['h-2 w-2 rounded-full', state === 'ok' ? 'bg-success' : 'bg-danger']"
          />
          <span class="text-ink">
            {{ state === 'loading' ? '检查中…' : state === 'ok' ? 'API 正常' : 'API 不可达' }}
          </span>
          <AppButton class="ml-auto" size="sm" @click="check">重新检查</AppButton>
        </div>
        <p class="mt-2 break-all font-mono text-[11.5px] text-faint">{{ detail || '—' }}</p>
      </div>

      <AppAlert v-if="state === 'fail'" tone="warning" class="mt-3">
        页面已加载说明静态资源正常。请检查 API 进程是否启动、Vite 代理目标是否正确。
      </AppAlert>
    </main>
  </div>
</template>
