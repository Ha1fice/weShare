<script setup lang="ts">
/**
 * 工作区页面：左侧目录树 + 右侧列表。
 *
 * 数据全部来自真实 API（`/workspaces/:id/tree` 等），没有模拟数据。
 * 权限相关的按钮显隐只是体验优化——服务端仍然每次复核（架构文档 §8.4）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client.js'
import { nodesApi, type TreeNodeItem } from '@/api/nodes.js'
import { useSessionStore } from '@/stores/session.js'
import NodeTree from '@/components/NodeTree.vue'
import NodeList from '@/components/NodeList.vue'

const session = useSessionStore()
const route = useRoute()
const router = useRouter()

const workspaceId = computed(() => String(route.params.workspaceId ?? ''))

const nodes = ref<TreeNodeItem[]>([])
const loading = ref(false)
const errorMessage = ref('')

const selected = ref<string[]>([])
const expanded = ref<string[]>([])
const draggingId = ref<string | null>(null)

/** 右侧列表的当前目录。 */
const currentParentId = computed<string | null>(() => {
  const id = selected.value[0]
  if (!id) return null
  const node = nodes.value.find((n) => n.id === id)
  // 选中文档时，列表显示它所在的目录
  return node?.type === 'folder' ? node.id : (node?.parentId ?? null)
})

/** 面包屑：从根到当前目录。 */
const breadcrumb = computed<Array<{ id: string | null; title: string }>>(() => {
  const crumbs: Array<{ id: string | null; title: string }> = [
    { id: null, title: workspaceName.value },
  ]

  const chain: TreeNodeItem[] = []
  let cursor: string | null = currentParentId.value
  let guard = 0
  while (cursor && guard < 32) {
    const n = nodes.value.find((x) => x.id === cursor)
    if (!n) break
    chain.unshift(n)
    cursor = n.parentId
    guard += 1
  }

  for (const n of chain) crumbs.push({ id: n.id, title: n.title || '未命名' })
  return crumbs
})

const workspaceName = computed(
  () => session.workspaces.find((w) => w.id === workspaceId.value)?.name ?? '空间',
)

/** 当前目录能否新建（只读不行）。 */
const canWrite = computed(() => {
  const id = currentParentId.value
  if (id === null) return true
  const node = nodes.value.find((n) => n.id === id)
  return node ? node.role !== 'view' : true
})

async function load(): Promise<void> {
  if (!workspaceId.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await nodesApi.tree(workspaceId.value)
    nodes.value = res.nodes
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// 切换空间时重新加载并清空选中
watch(workspaceId, () => {
  selected.value = []
  expanded.value = []
  void load()
})

async function onCreate(type: 'doc' | 'folder'): Promise<void> {
  const title = window.prompt(type === 'doc' ? '文档名称' : '文件夹名称', '')
  if (title === null) return

  try {
    const res = await nodesApi.create({
      workspaceId: workspaceId.value,
      parentId: currentParentId.value,
      type,
      title: title.trim(),
    })
    await load()
    selected.value = [res.node.id]
    // 新建文档直接进入编辑页
    if (type === 'doc') await router.push({ name: 'doc', params: { nodeId: res.node.id } })
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '创建失败'
  }
}

async function onRename(node: TreeNodeItem): Promise<void> {
  const title = window.prompt('新的名称', node.title)
  if (title === null || title.trim() === node.title) return

  try {
    await nodesApi.update(node.id, { title: title.trim() })
    await load()
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '改名失败'
  }
}

async function onRemove(node: TreeNodeItem): Promise<void> {
  if (!window.confirm(`删除「${node.title || '未命名'}」及其全部子项？可在回收站还原。`)) return

  try {
    await nodesApi.remove(node.id)
    selected.value = []
    await load()
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '删除失败'
  }
}

async function onMove(payload: { nodeId: string; newParentId: string | null }): Promise<void> {
  try {
    await nodesApi.update(payload.nodeId, { parentId: payload.newParentId })
    await load()
    // 展开目标目录，让用户看到结果
    if (payload.newParentId && !expanded.value.includes(payload.newParentId)) {
      expanded.value = [...expanded.value, payload.newParentId]
    }
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '移动失败'
  } finally {
    draggingId.value = null
  }
}

async function onOpen(node: TreeNodeItem): Promise<void> {
  if (node.type === 'folder') {
    selected.value = [node.id]
    if (!expanded.value.includes(node.id)) expanded.value = [...expanded.value, node.id]
    return
  }
  await router.push({ name: 'doc', params: { nodeId: node.id } })
}

async function switchWorkspace(id: string): Promise<void> {
  await router.push({ name: 'workspace', params: { workspaceId: id } })
}

async function onLogout(): Promise<void> {
  await session.logout()
  await router.push({ name: 'login' })
}
</script>

<template>
  <div class="flex h-screen flex-col">
    <!-- 顶栏 -->
    <header class="flex items-center gap-3 border-b border-gray-200 px-4 py-2.5">
      <span class="text-sm font-semibold text-gray-900">weShare</span>

      <select
        class="rounded border border-gray-300 px-2 py-1 text-sm"
        :value="workspaceId"
        @change="switchWorkspace(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="w in session.workspaces" :key="w.id" :value="w.id">
          {{ w.name }}
        </option>
      </select>

      <router-link
        v-if="workspaceId"
        :to="{ name: 'workspace-settings', params: { workspaceId } }"
        class="text-sm text-gray-600 hover:text-blue-600"
      >
        成员与设置
      </router-link>

      <span class="ml-auto text-sm text-gray-500">{{ session.user?.displayName }}</span>
      <button
        type="button"
        class="rounded border border-gray-300 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"
        @click="onLogout"
      >
        登出
      </button>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- 左：目录树 -->
      <aside class="w-64 shrink-0 overflow-auto border-r border-gray-200 bg-gray-50/60 p-2">
        <div class="mb-2 flex gap-1 px-1">
          <button
            type="button"
            class="flex-1 rounded bg-white px-2 py-1 text-xs text-gray-700 shadow-sm hover:bg-gray-100 disabled:opacity-40"
            :disabled="!canWrite"
            @click="onCreate('doc')"
          >
            + 文档
          </button>
          <button
            type="button"
            class="flex-1 rounded bg-white px-2 py-1 text-xs text-gray-700 shadow-sm hover:bg-gray-100 disabled:opacity-40"
            :disabled="!canWrite"
            @click="onCreate('folder')"
          >
            + 文件夹
          </button>
        </div>

        <NodeTree
          v-model:selected="selected"
          v-model:expanded="expanded"
          :nodes="nodes"
          :dragging-id="draggingId"
          multiple
          @move="onMove"
          @drag-start="(id) => (draggingId = id)"
          @drag-end="draggingId = null"
        />
      </aside>

      <!-- 右：面包屑 + 列表 -->
      <main class="min-w-0 flex-1 overflow-auto">
        <nav class="flex items-center gap-1 border-b border-gray-100 px-4 py-2 text-sm text-gray-500">
          <template v-for="(c, i) in breadcrumb" :key="c.id ?? 'root'">
            <span v-if="i > 0" class="text-gray-300">/</span>
            <button
              type="button"
              class="rounded px-1 hover:text-blue-600"
              @click="selected = c.id ? [c.id] : []"
            >
              {{ c.title }}
            </button>
          </template>
        </nav>

        <p
          v-if="errorMessage"
          role="alert"
          class="mx-4 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {{ errorMessage }}
        </p>

        <NodeList
          :parent-id="currentParentId"
          :nodes="nodes"
          :loading="loading"
          @open="onOpen"
          @rename="onRename"
          @remove="onRemove"
        />
      </main>
    </div>
  </div>
</template>
