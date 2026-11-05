<script setup lang="ts">
/**
 * 目录树的一行。
 *
 * 抽成独立组件，让虚拟滚动与直接渲染两条分支复用同一份行结构——
 * 否则两份模板必然漂移。
 *
 * 交互细节：
 *   - 有子项时点击箭头展开/收起，点击行选中；
 *   - 只读节点显示锁标，且不可拖动；
 *   - 行内操作不进树（那会让树变成一堵按钮墙），统一走右键/更多菜单。
 */
import { TreeItem } from 'reka-ui'
import type { UiTreeNode } from './NodeTree.vue'
import AppIcon from './icons/AppIcon.vue'

defineProps<{
  node: UiTreeNode
  level: number
  draggable: boolean
  /** 处于拖放目标高亮。 */
  dropTarget?: boolean
}>()

const emit = defineEmits<{
  dragstart: [node: UiTreeNode, ev: DragEvent]
  dragend: []
  dragover: [node: UiTreeNode, ev: DragEvent]
  dragleave: []
  drop: [node: UiTreeNode, ev: DragEvent]
  contextmenu: [node: UiTreeNode, ev: MouseEvent]
}>()
</script>

<template>
  <TreeItem
    :value="node"
    :level="level"
    :draggable="draggable"
    :style="{ paddingLeft: `${6 + level * 14}px` }"
    :class="[
      'group flex h-7 cursor-pointer select-none items-center gap-1 rounded-[5px] pr-1.5 text-[13px] outline-none',
      'text-muted transition-colors hover:bg-[#eceef2] hover:text-ink',
      'data-[selected]:bg-brand-50 data-[selected]:font-medium data-[selected]:text-brand-700',
      'focus-visible:ring-2 focus-visible:ring-brand-500/40',
      dropTarget ? 'ring-1 ring-brand-400 bg-brand-50/70' : '',
    ]"
    @dragstart="emit('dragstart', node, $event)"
    @dragend="emit('dragend')"
    @dragover="emit('dragover', node, $event)"
    @dragleave="emit('dragleave')"
    @drop.stop="emit('drop', node, $event)"
    @contextmenu.prevent="emit('contextmenu', node, $event)"
  >
    <template #default="{ isExpanded }">
      <span
        :class="[
          'flex h-4 w-4 shrink-0 items-center justify-center rounded text-faint transition-transform',
          node.hasChildren ? 'hover:bg-[#dfe2e8] hover:text-ink' : 'opacity-0',
        ]"
      >
        <AppIcon v-if="node.hasChildren" :name="isExpanded ? 'chevron-down' : 'chevron-right'" :size="12" />
      </span>

      <AppIcon
        :name="node.type === 'folder' ? 'folder' : 'file'"
        :size="13"
        :class="['shrink-0', node.type === 'folder' ? 'text-[#c9a24a]' : 'text-faint']"
      />

      <span class="min-w-0 flex-1 truncate">{{ node.title || '未命名' }}</span>

      <AppIcon
        v-if="node.role === 'view'"
        name="user"
        :size="11"
        class="shrink-0 text-faint opacity-0 group-hover:opacity-100"
        aria-label="只读"
      />
    </template>
  </TreeItem>
</template>
