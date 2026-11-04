<script setup lang="ts">
/**
 * 树的一行。
 *
 * 抽成独立组件是为了让 NodeTree 能在"虚拟滚动"与"直接渲染"两条分支里
 * 复用同一份行结构——否则两份模板会漂移。
 */
import { TreeItem } from 'reka-ui'
import type { UiTreeNode } from './NodeTree.vue'

defineProps<{
  node: UiTreeNode
  level: number
  draggable: boolean
}>()

const emit = defineEmits<{
  dragstart: [node: UiTreeNode, ev: DragEvent]
  dragend: []
  dragover: [node: UiTreeNode, ev: DragEvent]
  drop: [node: UiTreeNode, ev: DragEvent]
}>()

const iconOf = (n: UiTreeNode) => (n.type === 'folder' ? '📁' : '📄')
</script>

<template>
  <TreeItem
    :value="node"
    :level="level"
    :draggable="draggable"
    :style="{ paddingLeft: `${8 + level * 16}px` }"
    class="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 outline-none hover:bg-gray-100 data-[selected]:bg-blue-50 data-[selected]:text-blue-700"
    @dragstart="emit('dragstart', node, $event)"
    @dragend="emit('dragend')"
    @dragover="emit('dragover', node, $event)"
    @drop.stop="emit('drop', node, $event)"
  >
    <template #default="{ isExpanded }">
      <span
        v-if="node.hasChildren"
        class="inline-flex h-4 w-4 shrink-0 items-center justify-center text-xs text-gray-400"
      >
        {{ isExpanded ? '▾' : '▸' }}
      </span>
      <span v-else class="inline-block h-4 w-4 shrink-0" />

      <span class="shrink-0">{{ iconOf(node) }}</span>
      <span class="truncate">{{ node.title || '未命名' }}</span>

      <span v-if="node.role === 'view'" class="ml-auto shrink-0 text-xs text-gray-400">只读</span>
    </template>
  </TreeItem>
</template>
