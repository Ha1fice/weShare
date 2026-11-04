/**
 * 节点 API 封装。
 *
 * 只做 HTTP 调用与类型收窄，业务逻辑与状态在 store / 组件里。
 */

import type { NodeView, TreeNodeView, BreadcrumbItem } from '@weshare/shared'
import { api } from './client.js'

/** 树节点（含 hasChildren）。 */
export type TreeNodeItem = TreeNodeView & { role: string }

export interface TreeNodeResponse {
  nodes: TreeNodeItem[]
}

export const nodesApi = {
  /** 目录树（只含当前用户可读的节点）。 */
  tree: (workspaceId: string) =>
    api.get<TreeNodeResponse>(`/workspaces/${workspaceId}/tree`),

  /** 列表 / 搜索。不传 q 时返回全部可读节点。 */
  list: (workspaceId: string, q?: string) =>
    api.get<TreeNodeResponse>(
      `/workspaces/${workspaceId}/nodes${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    ),

  /** 回收站（只含当前用户有 manage 权限的）。 */
  trash: (workspaceId: string) =>
    api.get<TreeNodeResponse>(`/workspaces/${workspaceId}/trash`),

  detail: (nodeId: string) => api.get<{ node: NodeView }>(`/nodes/${nodeId}`),

  breadcrumb: (nodeId: string) =>
    api.get<{ items: BreadcrumbItem[] }>(`/nodes/${nodeId}/breadcrumb`),

  create: (input: {
    workspaceId: string
    parentId?: string | null
    type: 'folder' | 'doc'
    title: string
    visibility?: 'private' | 'workspace'
  }) => api.post<{ node: NodeView }>('/nodes', input),

  update: (
    nodeId: string,
    input: { title?: string; parentId?: string | null; visibility?: 'private' | 'workspace' },
  ) => api.patch<{ node: NodeView }>(`/nodes/${nodeId}`, input),

  remove: (nodeId: string) => api.delete<{ ok: true; affected: number }>(`/nodes/${nodeId}`),

  restore: (nodeId: string) =>
    api.post<{ ok: true; affected: number }>(`/nodes/${nodeId}/restore`),

  purge: (nodeId: string) => api.delete<{ ok: true }>(`/nodes/${nodeId}/purge`),
}
