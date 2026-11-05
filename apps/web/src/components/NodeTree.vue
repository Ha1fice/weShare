<script setup lang="ts">
/**
 * 目录树。
 *
 * 用 reka-ui 的 TreeRoot / TreeItem / TreeVirtualizer（headless）：
 *   - 展开收起、选择/多选、键盘导航（方向键、type-ahead）与 ARIA 都由它提供；
 *   - 行数超过阈值时用 TreeVirtualizer 只渲染可视区域；
 *   - 我们只负责数据整形、样式与拖放。
 *
 * 拖放用 HTML5 原生 DnD：本场景只需"拖到某个文件夹上 = 移动"，
 * 不涉及自由排序，没必要为此引入拖拽库。
 */
import { computed, ref } from 'vue'
import { TreeRoot, TreeVirtualizer } from 'reka-ui'
import type { TreeNodeItem } from '@/api/nodes.js'
import NodeTreeRow from './NodeTreeRow.vue'

/** 行高（px）。与 NodeTreeRow 的 h-7 对应；估小了滚动条会跳。 */
const ROW_HEIGHT = 28

/** 超过这个行数才启用虚拟滚动。少量节点直接渲染，无障碍树完整、也便于测试。 */
const VIRTUAL_THRESHOLD = 200

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
  multiple?: boolean
  /** 正在拖动的节点 id（由父组件持有，跨组件共享）。 */
  draggingId?: string | null
}>()

const emit = defineEmits<{
  'update:selected': [ids: string[]]
  'update:expanded': [ids: string[]]
  move: [payload: { nodeId: string; newParentId: string | null }]
  'drag-start': [nodeId: string]
  'drag-end': []
  contextmenu: [payload: { node: UiTreeNode; event: MouseEvent }]
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
    if (n.parentId !== null && byId.has(n.parentId)) byId.get(n.parentId)!.children.push(node)
    else roots.push(node)
  }

  return roots
})

const getKey = (n: UiTreeNode) => n.id
const getChildren = (n: UiTreeNode) => (n.children.length > 0 ? n.children : undefined)

/**
 * reka-ui 的 Tree 用**节点对象**做 modelValue，不是 id。
 * 对外只暴露 id 列表（store 与 API 都用 id），在这里双向转换。
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

const useVirtual = computed(() => props.nodes.length > VIRTUAL_THRESHOLD)

/** 虚拟滚动时供 type-ahead 用的文本（TreeVirtualizer 是非泛型组件）。 */
const textContentOf = (item: Record<string, unknown>) => String((item as { title?: string }).title ?? '')

/** 当前悬停的放置目标（只用于高亮，不参与逻辑）。 */
const dropTargetId = ref<string | null>(null)

function canDrop(target: UiTreeNode): boolean {
  return target.type === 'folder' && props.draggingId !== null && props.draggingId !== target.id
}

function onDragStart(node: UiTreeNode, ev: DragEvent): void {
  if (node.role === 'view') {
    ev.preventDefault()
    return
  }
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'move'
    // 必须 setData 才能在 Firefox 里触发拖拽
    ev.dataTransfer.setData('text/plain', node.id)
  }
  emit('drag-start', node.id)
}

function onDragOver(target: UiTreeNode, ev: DragEvent): void {
  if (!canDrop(target)) return
  ev.preventDefault()
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
  dropTargetId.value = target.id
}

function onDrop(target: UiTreeNode, ev: DragEvent): void {
  ev.preventDefault()
  const nodeId = props.draggingId ?? ev.dataTransfer?.getData('text/plain')
  dropTargetId.value = null
  if (!nodeId || nodeId === target.id) return
  emit('move', { nodeId, newParentId: target.id })
  emit('drag-end')
}

/** 拖到树的空白处 = 移到根级。 */
function onDropToRoot(ev: DragEvent): void {
  ev.preventDefault()
  const nodeId = props.draggingId ?? ev.dataTransfer?.getData('text/plain')
  dropTargetId.value = null
  if (!nodeId) return
  emit('move', { nodeId, newParentId: null })
  emit('drag-end')
}

const draggableOf = (node: UiTreeNode) => node.role !== 'view'
</script>

<template>
  <div class="h-full" @dragover.prevent @drop="onDropToRoot">
    <TreeRoot
      :model-value="multiple ? selectedItems : selectedItems[0]"
      :items="tree"
      :get-key="getKey"
      :get-children="getChildren"
      :expanded="expanded"
      :multiple="multiple"
      selection-behavior="toggle"
      class="h-full select-none overflow-auto pb-2 scroll-thin"
      @update:model-value="onSelectionChange"
      @update:expanded="(v: string[]) => emit('update:expanded', v)"
    >
      <template #default="{ flattenItems }">
        <!--
          虚拟滚动：TreeVirtualizer 以父元素（上面 role=tree 的元素）为滚动容器，
          所以滚动能力挂在 TreeRoot 上而不是外层 div。
        -->
        <TreeVirtualizer
          v-if="useVirtual"
          :estimate-size="ROW_HEIGHT"
          :overscan="10"
          :text-content="textContentOf"
        >
          <template #default="{ item }">
            <NodeTreeRow
              :node="item.value as UiTreeNode"
              :level="item.level"
              :draggable="draggableOf(item.value as UiTreeNode)"
              :drop-target="dropTargetId === (item.value as UiTreeNode).id"
              @dragstart="onDragStart"
              @dragend="emit('drag-end')"
              @dragover="onDragOver"
              @dragleave="dropTargetId = null"
              @drop="onDrop"
              @contextmenu="(n, e) => emit('contextmenu', { node: n, event: e })"
            />
          </template>
        </TreeVirtualizer>

        <template v-else>
          <NodeTreeRow
            v-for="item in flattenItems"
            :key="getKey(item.value)"
            :node="item.value"
            :level="item.level"
            :draggable="draggableOf(item.value)"
            :drop-target="dropTargetId === item.value.id"
            @dragstart="onDragStart"
            @dragend="emit('drag-end')"
            @dragover="onDragOver"
            @dragleave="dropTargetId = null"
            @drop="onDrop"
            @contextmenu="(n, e) => emit('contextmenu', { node: n, event: e })"
          />
        </template>
      </template>
    </TreeRoot>
  </div>
</template>
