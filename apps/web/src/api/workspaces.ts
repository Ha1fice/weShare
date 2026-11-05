/**
 * 空间与成员 API 封装。
 */

import { api } from './client.js'

export interface WorkspaceDetail {
  id: string
  name: string
  ownerId: string
  defaultRole: 'view' | 'comment' | 'edit'
  role: 'owner' | 'admin' | 'member' | 'viewer'
  createdAt: string
  updatedAt: string
}

export interface MemberView {
  userId: string
  email: string
  displayName: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  joinedAt: string
}

export const workspacesApi = {
  detail: (id: string) => api.get<{ workspace: WorkspaceDetail }>(`/workspaces/${id}`),

  create: (input: { name: string; defaultRole?: 'view' | 'comment' | 'edit' }) =>
    api.post<{ workspace: WorkspaceDetail }>('/workspaces', input),

  update: (id: string, input: { name?: string; defaultRole?: 'view' | 'comment' | 'edit' }) =>
    api.patch<{ workspace: WorkspaceDetail }>(`/workspaces/${id}`, input),

  members: (id: string) => api.get<{ members: MemberView[] }>(`/workspaces/${id}/members`),

  addMember: (id: string, input: { email: string; role: 'admin' | 'member' | 'viewer' }) =>
    api.post<{ member: MemberView }>(`/workspaces/${id}/members`, input),

  updateMember: (id: string, userId: string, role: 'admin' | 'member' | 'viewer') =>
    api.patch<{ member: MemberView }>(`/workspaces/${id}/members/${userId}`, { role }),

  removeMember: (id: string, userId: string) =>
    api.delete<{ ok: true }>(`/workspaces/${id}/members/${userId}`),
}
