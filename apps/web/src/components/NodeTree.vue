<script setup lang="ts">
/**
 * 目录树。
 *
 * 用 reka-ui 的 TreeRoot / TreeItem（headless）：
 *   - 展开收起、选择/多选、键盘导航（roving tabindex、方向键、type-ahead）
 *     都由组件提供，ARIA 属性也是它写的；
 *   - 我们只负责数据整形、样式与拖放。
 *
 * 拖放用 HTML5 原生 DnD：本场景只需"拖到某个文件夹上 = 移动"，
 * 不涉及自由排序，没必要为此引入拖拽库。
 */
import { computed } from 'vue'
import { TreeItem, TreeRoot } from 'reka-ui'
import type { TreeNodeItem } from '@/api/nodes.js'

/** 树上的节点（带子节点，供 reka-ui 递归）。 */
export interface UiTreeNode {
  id: string
  title: string
  type: 'folder' | 'doc' | 'sheet'
  role: string
  hasChildren: boolean
  children: UiTreeNode[]
}

const props = defineProps<{
  /** 扁平的节点列表（来自 API）。 */
  nodes: TreeNodeItem[]
  /** 选中的节点 id。 */
  selected: string[]
  /** 展开的节点 id。 */
  expanded: string[]
  /** 是否多选。 */
  multiple?: boolean
  /** 正在拖动的节点 id（由父组件持有，跨组件共享）。 */
  draggingId?: string | null
}>()

const emit = defineEmits<{
  'update:selected': [ids: string[]]
  'update:expanded': [ids: string[]]
  /** 把 nodeId 移动到 newParentId（null = 根级）。 */
  move: [payload: { nodeId: string; newParentId: string | null }]
  'drag-start': [nodeId: string]
  'drag-end': []
}>()

/** 扁平列表 → 嵌套树。父节点不可读的节点会被服务端挂到根级，这里自然落为根。 */
const tree = computed<UiTreeNode[]>(() => {
  const byId = new Map<string, UiTreeNode>()

  for (const n of props.nodes) {
    byId.set(n.id, {
      id: n.id,
      title: n.title,
      type: n.type,
      role: n.role,
      hasChildren: Boolean(n.hasChildren),
      children: [],
    })
  }

  const roots: UiTreeNode[] = []
  for (const n of props.nodes) {
    const node = byId.get(n.id)
    if (!node) continue

    if (n.parentId !== null && byId.has(n.parentId)) {
      byId.get(n.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
})

const getKey = (n: UiTreeNode) => n.id
const getChildren = (n: UiTreeNode) => (n.children.length > 0 ? n.children : undefined)

/**
 * reka-ui 的 Tree 用**节点对象**做 modelValue，不是 id。
 * 我们对外只暴露 id 列表（store 与 API 都用 id），所以在这里双向转换。
 */
const flatById = computed(() => {
  const map = new Map<string, UiTreeNode>()
  const walk = (list: UiTreeNode[]) => {
    for (const n of list) {
      map.set(n.id, n)
      walk(n.children)
    }
  }
  walk(tree.value)
  return map
})

const selectedItems = computed<UiTreeNode[]>(() =>
  props.selected.map((id) => flatById.value.get(id)).filter((n): n is UiTreeNode => Boolean(n)),
)

function onSelectionChange(value: unknown): void {
  const items = Array.isArray(value) ? (value as UiTreeNode[]) : value ? [value as UiTreeNode] : []
  emit(
    'update:selected',
    items.map((n) => n.id),
  )
}

/** 只有文件夹能作为放置目标。 */
function canDrop(target: UiTreeNode): boolean {
  return target.type === 'folder' && props.draggingId !== null && props.draggingId !== target.id
}

function onDragStart(node: UiTreeNode, ev: DragEvent): void {
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'move'
    // 必须 setData 才能在 Firefox 里触发拖拽
    ev.dataTransfer.setData('text/plain', node.id)
  }
  emit('drag-start', node.id)
}

function onDragOver(target: UiTreeNode, ev: DragEvent): void {
  if (!canDrop(target)) return
  // preventDefault 才允许 drop
  ev.preventDefault()
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
}

function onDrop(target: UiTreeNode, ev: DragEvent): void {
  ev.preventDefault()
  const nodeId = props.draggingId ?? ev.dataTransfer?.getData('text/plain')
  if (!nodeId || nodeId === target.id) return
  emit('move', { nodeId, newParentId: target.id })
  emit('drag-end')
}

/** 拖到树的空白处 = 移到根级。 */
function onDropToRoot(ev: DragEvent): void {
  ev.preventDefault()
  const nodeId = props.draggingId ?? ev.dataTransfer?.getData('text/plain')
  if (!nodeId) return
  emit('move', { nodeId, newParentId: null })
  emit('drag-end')
}

/** 图标：文件夹 / 文档。 */
function iconOf(node: UiTreeNode): string {
  return node.type === 'folder' ? '📁' : '📄'
}

/** 只读用户不能拖也不能被放入。 */
function draggableOf(node: UiTreeNode): boolean {
  return node.role !== 'view'
}
</script>

<template>
  <div class="min-h-full" @dragover.prevent @drop="onDropToRoot">
    <!-- 空白区域也接受 drop（移到根级）。外层容器设 min-h 保证有可放置空间。 -->
    <TreeRoot
      :model-value="multiple ? selectedItems : selectedItems[0]"
      :items="tree"
      :get-key="getKey"
      :get-children="getChildren"
      :expanded="expanded"
      :multiple="multiple"
      selection-behavior="toggle"
      class="select-none text-sm"
      @update:model-value="onSelectionChange"
      @update:expanded="(v: string[]) => emit('update:expanded', v)"
    >
      <template #default="{ flattenItems }">
        <TreeItem
          v-for="item in flattenItems"
          :key="getKey(item.value)"
          :value="item.value"
          :level="item.level"
          :style="{ paddingLeft: `${8 + item.level * 16}px` }"
          class="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 outline-none hover:bg-gray-100 data-[selected]:bg-blue-50 data-[selected]:text-blue-700 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
          :draggable="draggableOf(item.value)"
          @dragstart="onDragStart(item.value, $event)"
          @dragend="emit('drag-end')"
          @dragover="onDragOver(item.value, $event)"
          @drop.stop="onDrop(item.value, $event)"
        >
          <template #default="{ isExpanded }">
            <!-- 展开箭头：有子节点才显示 -->
            <span
              v-if="item.value.hasChildren"
              class="inline-flex h-4 w-4 shrink-0 items-center justify-center text-xs text-gray-400"
            >
              {{ isExpanded ? '▾' : '▸' }}
            </span>
            <span v-else class="inline-block h-4 w-4 shrink-0" />

            <span class="shrink-0">{{ iconOf(item.value) }}</span>
            <span class="truncate">{{ item.value.title || '未命名' }}</span>

            <!-- 只读标记：让用户知道为什么不能拖 -->
            <span v-if="item.value.role === 'view'" class="ml-auto shrink-0 text-xs text-gray-400">
              只读
            </span>
          </template>
        </TreeItem>
      </template>
    </TreeRoot>

    <!-- 空态 -->
    <p v-if="tree.length === 0" class="px-4 py-8 text-center text-sm text-gray-400">
      还没有内容。右键或点击上方按钮新建。
    </p>
  </div>
</template>
