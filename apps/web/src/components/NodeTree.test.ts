/**
 * 目录树组件测试。
 *
 * happy-dom 没有布局，虚拟滚动的实际裁切行为**无法在这里验证**——
 * 断言只覆盖：容器出现与否、行渲染、只读标记、拖放事件、空态。
 * 真实滚动需要在浏览器里人工验收（已记入 CODEX_GUIDANCE 的验证边界）。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NodeTree from './NodeTree.vue'
import type { TreeNodeItem } from '@/api/nodes.js'

function node(partial: Partial<TreeNodeItem> & { id: string; title: string }): TreeNodeItem {
  return {
    workspaceId: 'ws1',
    parentId: null,
    type: 'doc',
    ownerId: 'u1',
    visibility: 'workspace',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    trashRootId: null,
    role: 'manage',
    hasChildren: false,
    ...partial,
  }
}

function mountTree(nodes: TreeNodeItem[], selected: string[] = [], props: Record<string, unknown> = {}) {
  return mount(NodeTree, {
    props: { nodes, selected, expanded: [], ...props },
    attachTo: document.body,
  })
}

describe('NodeTree', () => {
  it('渲染根级节点标题', () => {
    const wrapper = mountTree([
      node({ id: 'n1', title: '设计稿' }),
      node({ id: 'n2', title: '需求池' }),
    ])
    expect(wrapper.text()).toContain('设计稿')
    expect(wrapper.text()).toContain('需求池')
  })

  it('子节点在父级未展开时不渲染', () => {
    const wrapper = mountTree([
      node({ id: 'f1', title: '文件夹', type: 'folder', hasChildren: true }),
      node({ id: 'n1', title: '子文档', parentId: 'f1' }),
    ])
    expect(wrapper.text()).toContain('文件夹')
    expect(wrapper.text()).not.toContain('子文档')
  })

  it('展开后渲染子节点', () => {
    const wrapper = mountTree(
      [
        node({ id: 'f1', title: '文件夹', type: 'folder', hasChildren: true }),
        node({ id: 'n1', title: '子文档', parentId: 'f1' }),
      ],
      [],
      { expanded: ['f1'] },
    )
    expect(wrapper.text()).toContain('子文档')
  })

  it('只读节点带只读标记且不可拖动', () => {
    const wrapper = mountTree([node({ id: 'n1', title: '别人写的', role: 'view' })])
    const row = wrapper.find('[draggable]')
    expect(row.exists()).toBe(true)
    expect(row.attributes('draggable')).toBe('false')
  })

  it('可编辑节点可拖动', () => {
    const wrapper = mountTree([node({ id: 'n1', title: '我的文档' })])
    expect(wrapper.find('[draggable]').attributes('draggable')).toBe('true')
  })

  it('点击行发出选中变更', async () => {
    const wrapper = mountTree([node({ id: 'n1', title: '甲' }), node({ id: 'n2', title: '乙' })])
    const rows = wrapper.findAll('[role="treeitem"]')
    await rows[1]!.trigger('click')
    const events = wrapper.emitted('update:selected')
    expect(events).toBeTruthy()
    expect(events!.at(-1)![0]).toEqual(['n2'])
  })

  it('多选时选中结果包含两项', async () => {
    const wrapper = mountTree([node({ id: 'n1', title: '甲' }), node({ id: 'n2', title: '乙' })], [], {
      multiple: true,
    })
    const rows = wrapper.findAll('[role="treeitem"]')
    await rows[0]!.trigger('click')
    await rows[1]!.trigger('click')
    const last = wrapper.emitted('update:selected')!.at(-1)![0] as string[]
    expect(last.sort()).toEqual(['n1', 'n2'])
  })

  it('节点超过阈值时启用虚拟滚动容器', () => {
    const nodes = Array.from({ length: 201 }, (_, i) => node({ id: `n${i}`, title: `节点 ${i}` }))
    const wrapper = mountTree(nodes)
    expect(wrapper.find('[data-reka-virtualizer]').exists()).toBe(true)
  })

  it('节点不超过阈值时不启用虚拟滚动', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => node({ id: `n${i}`, title: `节点 ${i}` }))
    const wrapper = mountTree(nodes)
    expect(wrapper.find('[data-reka-virtualizer]').exists()).toBe(false)
  })

  it('500 个节点挂载不报错', () => {
    const nodes = Array.from({ length: 500 }, (_, i) => node({ id: `n${i}`, title: `节点 ${i}` }))
    expect(() => mountTree(nodes)).not.toThrow()
  })

  it('拖到文件夹上发出 move 事件', async () => {
    const wrapper = mountTree(
      [
        node({ id: 'f1', title: '文件夹', type: 'folder', hasChildren: true }),
        node({ id: 'n1', title: '文档' }),
      ],
      [],
      { draggingId: 'n1' },
    )
    const target = wrapper.findAll('[role="treeitem"]')[0]!
    await target.trigger('drop')
    const moves = wrapper.emitted('move')
    expect(moves).toBeTruthy()
    expect(moves!.at(-1)![0]).toEqual({ nodeId: 'n1', newParentId: 'f1' })
  })

  it('不允许拖到自己身上', async () => {
    const wrapper = mountTree([node({ id: 'f1', title: '文件夹', type: 'folder' })], [], {
      draggingId: 'f1',
    })
    await wrapper.findAll('[role="treeitem"]')[0]!.trigger('drop')
    expect(wrapper.emitted('move')).toBeFalsy()
  })

  it('空列表不渲染任何行', () => {
    const wrapper = mountTree([])
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(0)
  })
})
