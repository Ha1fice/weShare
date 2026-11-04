<script setup lang="ts">
/**
 * 右侧列表：展示当前选中目录下的子项。
 *
 * 用原生 <table>——reka-ui 没有表格组件，而这个场景不需要虚拟滚动
 * （单个目录下的直接子项数量有限），原生表格语义 + 键盘可访问性已经够用。
 */
import { computed } from 'vue'
import type { TreeNodeItem } from '@/api/nodes.js'

const props = defineProps<{
  /** 当前目录 id；null 表示根级。 */
  parentId: string | null
  /** 全部可读节点（扁平）。 */
  nodes: TreeNodeItem[]
  loading?: boolean
}>()

const emit = defineEmits<{
  open: [node: TreeNodeItem]
  rename: [node: TreeNodeItem]
  remove: [node: TreeNodeItem]
}>()

/** 当前目录的直接子项。 */
const rows = computed(() =>
  props.nodes.filter((n) => (n.parentId ?? null) === props.parentId),
)

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function typeLabel(t: string): string {
  if (t === 'folder') return '文件夹'
  if (t === 'doc') return '文档'
  return '表格'
}
</script>

<template>
  <div>
    <div v-if="loading" class="px-4 py-10 text-center text-sm text-gray-400">加载中…</div>

    <div
      v-else-if="rows.length === 0"
      class="px-4 py-10 text-center text-sm text-gray-400"
    >
      这个目录还是空的。
    </div>

    <table v-else class="w-full table-fixed text-sm">
      <thead>
        <tr class="border-b border-gray-200 text-left text-xs text-gray-500">
          <th class="w-8 px-3 py-2 font-normal" />
          <th class="px-3 py-2 font-normal">名称</th>
          <th class="w-20 px-3 py-2 font-normal">类型</th>
          <th class="w-32 px-3 py-2 font-normal">更新时间</th>
          <th class="w-16 px-3 py-2 font-normal" />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          class="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
          tabindex="0"
          :data-node-id="row.id"
          @click="emit('open', row)"
          @keydown.enter="emit('open', row)"
        >
          <td class="px-3 py-2 text-center">{{ row.type === 'folder' ? '📁' : '📄' }}</td>
          <td class="truncate px-3 py-2 text-gray-900">{{ row.title || '未命名' }}</td>
          <td class="px-3 py-2 text-gray-500">{{ typeLabel(row.type) }}</td>
          <td class="px-3 py-2 text-xs text-gray-500">{{ fmtTime(row.updatedAt) }}</td>
          <td class="px-3 py-2 text-right">
            <button
              v-if="row.role !== 'view'"
              type="button"
              class="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-200"
              title="重命名"
              @click.stop="emit('rename', row)"
            >
              改名
            </button>
            <button
              v-if="row.role !== 'view'"
              type="button"
              class="rounded px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50"
              title="删除"
              @click.stop="emit('remove', row)"
            >
              删除
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
