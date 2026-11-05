<script setup lang="ts">
/**
 * 工作区：左侧目录树 + 右侧当前目录列表。
 *
 * 信息组织参照腾讯文档：左树定位、右列表看内容、顶部面包屑说明"我在哪"。
 *
 * 数据全部来自真实 API（`/workspaces/:id/tree`），没有模拟数据。
 * 权限相关的按钮显隐只是体验优化——服务端每次复核（架构文档 §8.4）。
 *
 * 所有改名/删除/新建都走 Dialog，不用 window.prompt/confirm：
 * 原生弹窗无法承载"输入标题确认"这类风险匹配，也无法统一视觉。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client.js'
import { nodesApi, type TreeNodeItem } from '@/api/nodes.js'
import { useSessionStore } from '@/stores/session.js'
import AppShell from '@/components/layout/AppShell.vue'
import NodeTree, { type UiTreeNode } from '@/components/NodeTree.vue'
import { AppAlert, AppButton, AppDialog, AppEmpty, AppField, AppInput, AppSkeleton } from '@/components/ui/index.js'
import { toast } from '@/components/ui/toast.js'
import AppIcon from '@/components/icons/AppIcon.vue'

const session = useSessionStore()
const route = useRoute()
const router = useRouter()

const workspaceId = computed(() => String(route.params.workspaceId ?? ''))
const workspace = computed(() => session.workspaces.find((w) => w.id === workspaceId.value))

const nodes = ref<TreeNodeItem[]>([])
const loading = ref(true)
const errorMessage = ref('')

const selected = ref<string[]>([])
const expanded = ref<string[]>([])
const draggingId = ref<string | null>(null)

/** 右侧列表的当前目录；null = 根级。 */
const currentParentId = computed<string | null>(() => {
  const id = selected.value[0]
  if (!id) return null
  const node = nodes.value.find((n) => n.id === id)
  return node?.type === 'folder' ? node.id : (node?.parentId ?? null)
})

/** 面包屑：从根到当前目录。 */
const breadcrumb = computed<Array<{ id: string | null; title: string }>>(() => {
  const crumbs: Array<{ id: string | null; title: string }> = [
    { id: null, title: workspace.value?.name ?? '空间' },
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

/** 当前目录能否写入。根级默认允许（服务端仍会复核空间默认角色）。 */
const canWrite = computed(() => {
  const id = currentParentId.value
  if (id === null) {
    const role = workspace.value?.role
    return role === 'owner' || role === 'admin' || role === 'member'
  }
  const node = nodes.value.find((n) => n.id === id)
  return node ? node.role !== 'view' : false
})

async function load(): Promise<void> {
  if (!workspaceId.value) return
  errorMessage.value = ''
  try {
    const res = await nodesApi.tree(workspaceId.value)
    nodes.value = res.nodes
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '加载失败，请刷新重试'
  } finally {
    loading.value = false
  }
}

onMounted(load)

watch(workspaceId, () => {
  selected.value = []
  expanded.value = []
  loading.value = true
  void load()
})

// ------------------------------------------------------------------ 新建
const createDialog = ref<{ open: boolean; type: 'doc' | 'folder'; title: string; busy: boolean }>({
  open: false,
  type: 'doc',
  title: '',
  busy: false,
})

function openCreate(type: 'doc' | 'folder'): void {
  createDialog.value = { open: true, type, title: '', busy: false }
}

async function submitCreate(): Promise<void> {
  const d = createDialog.value
  const title = d.title.trim()
  if (!title) return
  d.busy = true
  try {
    const res = await nodesApi.create({
      workspaceId: workspaceId.value,
      parentId: currentParentId.value,
      type: d.type,
      title,
    })
    d.open = false
    await load()
    selected.value = [res.node.id]
    if (d.type === 'doc') await router.push({ name: 'doc', params: { nodeId: res.node.id } })
    else toast(`文件夹「${title}」已创建`)
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '创建失败'
    d.busy = false
  }
}

// ------------------------------------------------------------------ 改名
const renameDialog = ref<{ open: boolean; node: TreeNodeItem | null; title: string; busy: boolean }>({
  open: false,
  node: null,
  title: '',
  busy: false,
})

function openRename(node: TreeNodeItem | UiTreeNode): void {
  const full = nodes.value.find((n) => n.id === node.id) ?? null
  if (!full) return
  renameDialog.value = { open: true, node: full, title: full.title, busy: false }
}

const renameInvalid = computed(() => {
  const v = renameDialog.value.title.trim()
  return !v || v.length > 128
})

async function submitRename(): Promise<void> {
  const d = renameDialog.value
  if (!d.node || renameInvalid.value) return
  d.busy = true
  try {
    await nodesApi.update(d.node.id, { title: d.title.trim() })
    d.open = false
    await load()
    toast('已重命名')
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '重命名失败'
    d.busy = false
  }
}

// ------------------------------------------------------------------ 删除
const deleteDialog = ref<{ open: boolean; node: TreeNodeItem | null; busy: boolean }>({
  open: false,
  node: null,
  busy: false,
})

function openDelete(node: TreeNodeItem | UiTreeNode): void {
  const full = nodes.value.find((n) => n.id === node.id) ?? null
  if (!full) return
  deleteDialog.value = { open: true, node: full, busy: false }
}

async function submitDelete(): Promise<void> {
  const d = deleteDialog.value
  if (!d.node) return
  d.busy = true
  try {
    const res = await nodesApi.remove(d.node.id)
    d.open = false
    selected.value = selected.value.filter((id) => id !== d.node!.id)
    await load()
    toast(res.affected > 1 ? `已删除 ${res.affected} 项，可在回收站还原` : '已移入回收站')
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '删除失败'
    d.busy = false
  }
}

// ------------------------------------------------------------------ 移动
async function onMove(payload: { nodeId: string; newParentId: string | null }): Promise<void> {
  try {
    await nodesApi.update(payload.nodeId, { parentId: payload.newParentId })
    await load()
    if (payload.newParentId && !expanded.value.includes(payload.newParentId)) {
      expanded.value = [...expanded.value, payload.newParentId]
    }
    toast('已移动')
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '移动失败'
  } finally {
    draggingId.value = null
  }
}

// ------------------------------------------------------------------ 行内操作
function openNode(node: TreeNodeItem | UiTreeNode): void {
  if (node.type === 'folder') {
    selected.value = [node.id]
    if (!expanded.value.includes(node.id)) expanded.value = [...expanded.value, node.id]
    return
  }
  void router.push({ name: 'doc', params: { nodeId: node.id } })
}

/** 右键菜单用原生 contextmenu 定位，简单且不引额外依赖。 */
const ctx = ref<{ open: boolean; node: TreeNodeItem | null; x: number; y: number }>({
  open: false,
  node: null,
  x: 0,
  y: 0,
})

function openContextMenu(node: UiTreeNode, event: MouseEvent): void {
  const full = nodes.value.find((n) => n.id === node.id) ?? null
  if (!full) return
  ctx.value = { open: true, node: full, x: event.clientX, y: event.clientY }
}

function closeContextMenu(): void {
  ctx.value = { ...ctx.value, open: false }
}

/** 列表区数据：当前目录的直接子项。 */
const rows = computed(() =>
  nodes.value
    .filter((n) => (n.parentId ?? null) === currentParentId.value)
    .sort((a, b) => {
      // 文件夹在前，同类按更新时间倒序——和多数文档工具一致
      if (a.type === 'folder' && b.type !== 'folder') return -1
      if (a.type !== 'folder' && b.type === 'folder') return 1
      return b.updatedAt.localeCompare(a.updatedAt)
    }),
)

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
</script>

<template>
  <AppShell>
    <!-- 左：目录树 -->
    <aside class="flex w-[248px] shrink-0 flex-col border-r border-line bg-[#fbfcfd]">
      <div class="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        <AppButton size="sm" icon="plus" variant="secondary" :disabled="!canWrite" @click="openCreate('doc')">
          文档
        </AppButton>
        <AppButton size="sm" icon="folder" variant="ghost" :disabled="!canWrite" @click="openCreate('folder')">
          文件夹
        </AppButton>
      </div>

      <div class="min-h-0 flex-1 overflow-hidden px-1.5 py-1.5">
        <div v-if="loading" class="space-y-1.5 px-1">
          <AppSkeleton v-for="i in 6" :key="i" :width="`${60 + ((i * 13) % 35)}%`" height="11px" />
        </div>
        <NodeTree
          v-else
          v-model:selected="selected"
          v-model:expanded="expanded"
          :nodes="nodes"
          :dragging-id="draggingId"
          multiple
          @move="onMove"
          @drag-start="(id) => (draggingId = id)"
          @drag-end="draggingId = null"
          @contextmenu="(p) => openContextMenu(p.node, p.event)"
        />
      </div>

      <div class="shrink-0 border-t border-line px-2 py-1.5 text-[11px] text-faint">
        {{ nodes.length }} 个条目
      </div>
    </aside>

    <!-- 右：面包屑 + 列表 -->
    <main class="flex min-w-0 flex-1 flex-col">
      <div class="flex h-10 shrink-0 items-center gap-1 border-b border-line px-3">
        <nav class="flex min-w-0 items-center gap-0.5 text-[12.5px] text-muted" aria-label="当前位置">
          <template v-for="(c, i) in breadcrumb" :key="c.id ?? 'root'">
            <AppIcon v-if="i > 0" name="chevron-right" :size="12" class="shrink-0 text-faint" />
            <button
              type="button"
              :class="[
                'max-w-[180px] truncate rounded px-1.5 py-0.5 transition-colors hover:bg-subtle focus-ring',
                i === breadcrumb.length - 1 ? 'font-medium text-ink' : '',
              ]"
              @click="selected = c.id ? [c.id] : []"
            >
              {{ c.title }}
            </button>
          </template>
        </nav>

        <div class="ml-auto flex items-center gap-1">
          <AppButton size="sm" icon="plus" variant="primary" :disabled="!canWrite" @click="openCreate('doc')">
            新建
          </AppButton>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        <div v-if="errorMessage" class="p-3">
          <AppAlert tone="error">
            {{ errorMessage }}
            <button type="button" class="ml-2 underline" @click="load">重试</button>
          </AppAlert>
        </div>

        <div v-if="loading" class="space-y-2 p-4">
          <AppSkeleton v-for="i in 5" :key="i" height="34px" rounded="6px" />
        </div>

        <AppEmpty
          v-else-if="rows.length === 0"
          icon="folder"
          title="这个目录还是空的"
          description="新建一篇文档或一个文件夹开始。也可以把左侧的节点拖到这里所在的文件夹上移动它。"
        >
          <AppButton v-if="canWrite" variant="primary" icon="plus" @click="openCreate('doc')">
            新建文档
          </AppButton>
        </AppEmpty>

        <table v-else class="w-full border-collapse text-[13px]">
          <thead>
            <tr class="border-b border-line text-left text-[11.5px] font-normal text-faint">
              <th class="px-4 py-2 font-normal">名称</th>
              <th class="w-[88px] px-3 py-2 font-normal">类型</th>
              <th class="w-[140px] px-3 py-2 font-normal">更新时间</th>
              <th class="w-[104px] px-3 py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.id"
              class="group cursor-pointer border-b border-line/70 transition-colors hover:bg-subtle/70 focus-within:bg-subtle/70"
              :data-node-id="row.id"
              @click="openNode(row)"
              @contextmenu.prevent="openContextMenu(row as unknown as UiTreeNode, $event)"
            >
              <td class="px-4 py-2">
                <div class="flex items-center gap-2">
                  <AppIcon
                    :name="row.type === 'folder' ? 'folder' : 'file'"
                    :size="14"
                    :class="row.type === 'folder' ? 'text-[#c9a24a]' : 'text-faint'"
                  />
                  <span class="truncate text-ink">{{ row.title || '未命名' }}</span>
                  <span
                    v-if="row.role === 'view'"
                    class="rounded bg-subtle px-1 py-px text-[10.5px] text-faint"
                  >只读</span>
                </div>
              </td>
              <td class="px-3 py-2 text-[12px] text-muted">{{ row.type === 'folder' ? '文件夹' : '文档' }}</td>
              <td class="px-3 py-2 text-[12px] text-faint">{{ fmtTime(row.updatedAt) }}</td>
              <td class="px-3 py-2">
                <div class="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <template v-if="row.role !== 'view'">
                    <AppButton
                      size="sm"
                      variant="ghost"
                      square
                      icon="pencil"
                      aria-label="重命名"
                      @click.stop="openRename(row)"
                    />
                    <AppButton
                      size="sm"
                      variant="danger-ghost"
                      square
                      icon="trash"
                      aria-label="删除"
                      @click.stop="openDelete(row)"
                    />
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="ctx.open" class="fixed inset-0 z-40" @click="closeContextMenu" @contextmenu.prevent="closeContextMenu" />
      <div
        v-if="ctx.open && ctx.node"
        class="fixed z-50 min-w-[152px] rounded-md border border-line bg-surface p-1 shadow-pop"
        :style="{ left: `${ctx.x}px`, top: `${ctx.y}px` }"
      >
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded px-2 py-[5px] text-left text-[12.5px] text-ink hover:bg-subtle"
          @click="closeContextMenu(); openNode(ctx.node!)"
        >
          <AppIcon name="corner-down-left" :size="13" />打开
        </button>
        <template v-if="ctx.node.role !== 'view'">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-[5px] text-left text-[12.5px] text-ink hover:bg-subtle"
            @click="closeContextMenu(); openRename(ctx.node!)"
          >
            <AppIcon name="pencil" :size="13" />重命名
          </button>
          <div class="my-1 h-px bg-line" />
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-[5px] text-left text-[12.5px] text-danger hover:bg-danger-soft"
            @click="closeContextMenu(); openDelete(ctx.node!)"
          >
            <AppIcon name="trash" :size="13" />删除
          </button>
        </template>
      </div>
    </Teleport>

    <!-- 新建 -->
    <AppDialog
      v-model:open="createDialog.open"
      :title="createDialog.type === 'doc' ? '新建文档' : '新建文件夹'"
      :description="`将创建在「${breadcrumb.at(-1)?.title ?? '空间'}」下`"
      confirm-text="创建"
      :loading="createDialog.busy"
      :confirm-disabled="!createDialog.title.trim() || createDialog.busy"
      @confirm="submitCreate"
    >
      <AppField :label="createDialog.type === 'doc' ? '文档标题' : '文件夹名称'" html-for="create-title">
        <AppInput
          id="create-title"
          v-model="createDialog.title"
          :placeholder="createDialog.type === 'doc' ? '未命名文档' : '新建文件夹'"
          @keyup.enter="submitCreate"
        />
      </AppField>
    </AppDialog>

    <!-- 重命名 -->
    <AppDialog
      v-model:open="renameDialog.open"
      title="重命名"
      confirm-text="保存"
      :loading="renameDialog.busy"
      :confirm-disabled="renameInvalid || renameDialog.busy"
      @confirm="submitRename"
    >
      <AppField label="名称" html-for="rename-title" :error="renameInvalid ? '名称不能为空，且不超过 128 个字符' : ''">
        <AppInput id="rename-title" v-model="renameDialog.title" @keyup.enter="submitRename" />
      </AppField>
    </AppDialog>

    <!-- 删除确认 -->
    <AppDialog
      v-model:open="deleteDialog.open"
      title="移入回收站"
      tone="danger"
      icon="trash"
      confirm-text="移入回收站"
      :loading="deleteDialog.busy"
      @confirm="submitDelete"
    >
      <template #description>
        「{{ deleteDialog.node?.title || '未命名' }}」
        <template v-if="deleteDialog.node?.type === 'folder'">及其所有子项</template>
        将被移入回收站。之后可以在回收站还原，或在那里永久删除。
      </template>
    </AppDialog>
  </AppShell>
</template>
