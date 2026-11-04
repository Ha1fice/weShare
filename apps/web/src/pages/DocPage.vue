<script setup lang="ts">
/**
 * 文档页（Phase 1 的文档壳）。
 *
 * Phase 1 只做到"能打开、能看到标题与所属路径、能改名"——
 * 正文编辑器在 Phase 2（T5）接入 Tiptap。这里**不放假的正文**，
 * 明确显示"编辑器未接入"，避免误导。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client.js'
import { nodesApi } from '@/api/nodes.js'
import type { NodeView } from '@weshare/shared'
import { useSessionStore } from '@/stores/session.js'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()

const nodeId = computed(() => String(route.params.nodeId ?? ''))
const node = ref<NodeView | null>(null)
const crumbs = ref<Array<{ id: string; title: string }>>([])
const errorMessage = ref('')

async function load(): Promise<void> {
  errorMessage.value = ''
  try {
    const [detail, crumb] = await Promise.all([
      nodesApi.detail(nodeId.value),
      nodesApi.breadcrumb(nodeId.value),
    ])
    node.value = detail.node
    crumbs.value = crumb.items
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '加载失败'
  }
}

onMounted(load)
watch(nodeId, load)

const canEdit = computed(() => {
  const role = node.value?.role
  return role === 'edit' || role === 'manage'
})

async function onRename(): Promise<void> {
  if (!node.value) return
  const title = window.prompt('新的标题', node.value.title)
  if (title === null || title.trim() === node.value.title) return

  try {
    const res = await nodesApi.update(node.value.id, { title: title.trim() })
    node.value = { ...node.value, title: res.node.title }
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '改名失败'
  }
}

async function backToWorkspace(): Promise<void> {
  const wsId = node.value?.workspaceId ?? session.workspaces[0]?.id
  if (wsId) await router.push({ name: 'workspace', params: { workspaceId: wsId } })
  else await router.push({ name: 'home' })
}

/** 供模板用：节点类型 → 展示名。 */
const typeLabel = computed(() => (node.value?.type === 'sheet' ? '表格' : '文档'))
</script>

<template>
  <div class="mx-auto max-w-4xl p-8">
    <nav class="mb-3 flex items-center gap-1 text-sm text-gray-500">
      <button type="button" class="hover:text-blue-600" @click="backToWorkspace">← 返回</button>
      <span v-for="c in crumbs" :key="c.id" class="flex items-center gap-1">
        <span class="text-gray-300">/</span>
        <span>{{ c.title }}</span>
      </span>
    </nav>

    <p
      v-if="errorMessage"
      role="alert"
      class="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {{ errorMessage }}
    </p>

    <template v-if="node">
      <div class="mb-2 flex items-center gap-2">
        <h1 class="text-2xl font-semibold text-gray-900">{{ node.title || '未命名' }}</h1>
        <span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
          {{ node.role ?? '无权限' }}
        </span>
        <span v-if="node.visibility === 'private'" class="text-xs text-amber-600">私密</span>
        <button
          v-if="canEdit"
          type="button"
          class="ml-auto rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          @click="onRename"
        >
          改名
        </button>
      </div>

      <p class="mb-6 text-xs text-gray-400">
        {{ typeLabel }} · 更新于 {{ new Date(node.updatedAt).toLocaleString() }}
      </p>

      <div class="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
        <p class="text-sm text-gray-500">正文编辑器在 Phase 2 接入（Tiptap + Yjs）。</p>
        <p class="mt-1 text-xs text-gray-400">
          当前节点已持久化在服务端，正文行也已建立（创建文档时原子写入）。
        </p>
      </div>
    </template>
  </div>
</template>
