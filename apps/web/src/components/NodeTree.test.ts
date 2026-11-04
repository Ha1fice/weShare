import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NodeTree from '@/components/NodeTree.vue'
import type { TreeNodeItem } from '@/api/nodes.js'

/** 造一个节点（默认是 owner 的可编辑文档）。 */
function node(over: Partial<TreeNodeItem> & { id: string; title: string }): TreeNodeItem {
  return {
    workspaceId: 'w1',
    parentId: null,
    type: 'doc',
    ownerId: 'u1',
    visibility: 'workspace',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
    role: 'manage',
    hasChildren: false,
    ...over,
  }
}

const mountTree = (nodes: TreeNodeItem[], props: Record<string, unknown> = {}) =>
  mount(NodeTree, {
    props: { nodes, selected: [], expanded: [], ...props },
  })

describe('NodeTree', () => {
  it('渲染根级节点', () => {
    const wrapper = mountTree([node({ id: 'n1', title: '需求文档' })])

    expect(wrapper.text()).toContain('需求文档')
  })

  it('嵌套节点在展开后可见', async () => {
    const nodes = [
      node({ id: 'f1', title: '设计稿', type: 'folder', hasChildren: true }),
      node({ id: 'd1', title: '子文档', parentId: 'f1' }),
    ]

    // 未展开：只有文件夹可见
    const collapsed = mountTree(nodes)
    expect(collapsed.text()).toContain('设计稿')
    expect(collapsed.text()).not.toContain('子文档')

    // 展开后子节点出现
    const expanded = mountTree(nodes, { expanded: ['f1'] })
    expect(expanded.text()).toContain('子文档')
  })

  it('只读节点带"只读"标记', () => {
    const wrapper = mountTree([node({ id: 'n1', title: '公开文档', role: 'view' })])
    expect(wrapper.text()).toContain('只读')
  })

  it('空列表显示空态', () => {
    const wrapper = mountTree([])
    expect(wrapper.text()).toContain('还没有内容')
  })

  it('点击节点触发选择更新', async () => {
    const wrapper = mountTree([node({ id: 'n1', title: '文档 A' })], { multiple: true })

    const items = wrapper.findAll('[role="treeitem"]')
    expect(items.length).toBe(1)

    await items[0]!.trigger('click')

    const emitted = wrapper.emitted('update:selected')
    expect(emitted).toBeTruthy()
    // 选中结果是 id 列表，不是节点对象
    expect(emitted?.at(-1)?.[0]).toEqual(['n1'])
  })

  it('拖放到文件夹上触发 move 事件', async () => {
    const wrapper = mount(NodeTree, {
      props: {
        nodes: [
          node({ id: 'f1', title: '目标目录', type: 'folder' }),
          node({ id: 'd1', title: '被拖的文档' }),
        ],
        selected: [],
        expanded: [],
        draggingId: 'd1',
      },
    })

    const items = wrapper.findAll('[role="treeitem"]')
    // 第一个是文件夹（目标）
    await items[0]!.trigger('drop')

    const emitted = wrapper.emitted('move')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toEqual({ nodeId: 'd1', newParentId: 'f1' })
  })

  it('不能把节点拖到自己身上', async () => {
    const wrapper = mount(NodeTree, {
      props: {
        nodes: [node({ id: 'f1', title: '目录', type: 'folder' })],
        selected: [],
        expanded: [],
        draggingId: 'f1',
      },
    })

    await wrapper.findAll('[role="treeitem"]')[0]!.trigger('drop')

    expect(wrapper.emitted('move')).toBeFalsy()
  })

  it('拖放到空白处 = 移到根级', async () => {
    const wrapper = mount(NodeTree, {
      props: {
        nodes: [node({ id: 'd1', title: '文档', parentId: 'f9' })],
        selected: [],
        expanded: [],
        draggingId: 'd1',
      },
    })

    // 最外层 div 接受 drop
    await wrapper.element.dispatchEvent(new Event('drop'))

    expect(wrapper.emitted('move')?.[0]?.[0]).toEqual({ nodeId: 'd1', newParentId: null })
  })

  it('只读节点不可拖动', () => {
    const wrapper = mountTree([node({ id: 'n1', title: '只读文档', role: 'view' })])
    const el = wrapper.find('[role="treeitem"]')
    expect(el.attributes('draggable')).toBe('false')
  })
})
