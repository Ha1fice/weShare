/**
 * 空间与成员的领域服务。
 *
 * 权限边界（架构文档 §8.1 的空间角色语义 + 附录 A 的接口清单）：
 *
 * | 操作             | owner | admin | member | viewer |
 * |------------------|-------|-------|--------|--------|
 * | 查看空间详情     | ✅    | ✅    | ✅     | ✅     |
 * | 查看成员列表     | ✅    | ✅    | ✅     | ✅     |
 * | 添加成员         | ✅    | ✅    | ❌     | ❌     |
 * | 改成员角色       | ✅    | ✅    | ❌     | ❌     |
 * | 移除成员         | ✅    | ✅    | ❌     | ❌     |
 * | 改空间名/默认角色| ✅    | ❌    | ❌     | ❌     |
 *
 * 三条硬边界（**不得为了方便实现而放宽**）：
 *
 * 1. **不能通过接口设置 owner**。owner 由空间创建时确定；任何 admin 都能
 *    "造"一个 owner 会绕过 owner 的独占权限（改空间设置、purge 回收站）。
 *    转移所有权是独立操作，不在 MVP 范围。
 *
 * 2. **admin 不能动 owner**。包括改 owner 的角色、移除 owner。
 *    否则 admin 可以先把 owner 降级再自己升上去——实质上是提权。
 *
 * 3. **空间不能失去 owner**。移除最后一个 owner 会被拒绝。
 *    （owner 自己也不能通过"移除成员"接口离开——那要先做所有权转移。）
 *
 * 关键原则（架构文档 §8.4 反面清单）：**权限判定只在服务端**。
 * 前端隐藏按钮只是体验优化，后端每个接口都重新判定。
 */

import { randomUUID } from 'node:crypto'
import type { Repositories } from '@weshare/db'
import {
  canManageMembers,
  canManageWorkspaceSettings,
  type WorkspaceRole,
} from '@weshare/shared'
import { AppError, forbidden, notFound } from '../http/errors.js'

export interface WorkspaceServiceOptions {
  repos: Repositories
}

export class WorkspaceService {
  private readonly repos: Repositories

  constructor(options: WorkspaceServiceOptions) {
    this.repos = options.repos
  }

  /**
   * 取当前用户在空间中的角色。
   *
   * @throws 404 不是该空间成员（**统一返回 404 而不是 403**——
   *   否则可以用来探测哪些空间 id 存在。架构文档 T5.3）
   */
  async requireMembership(workspaceId: string, userId: string): Promise<WorkspaceRole> {
    const role = await this.repos.workspaces.findMemberRole(workspaceId, userId)
    if (role === null) {
      throw notFound('空间不存在')
    }
    return role
  }

  /**
   * 要求当前用户能管理成员（owner / admin）。
   *
   * @throws 404 不是空间成员
   * @throws 403 是成员但不是 owner/admin
   */
  async requireMemberManagement(workspaceId: string, userId: string): Promise<WorkspaceRole> {
    const role = await this.requireMembership(workspaceId, userId)
    if (!canManageMembers(role)) {
      throw forbidden('无权管理该空间的成员')
    }
    return role
  }

  /**
   * 要求当前用户能修改空间设置（仅 owner）。
   *
   * @throws 404 不是空间成员
   * @throws 403 是成员但不是 owner
   */
  async requireWorkspaceSettings(workspaceId: string, userId: string): Promise<WorkspaceRole> {
    const role = await this.requireMembership(workspaceId, userId)
    if (!canManageWorkspaceSettings(role)) {
      throw forbidden('仅空间所有者可修改空间设置')
    }
    return role
  }

  /** 创建空间。创建者自动成为 owner（由 Repository 原子完成）。 */
  async create(ownerId: string, input: { name: string; defaultRole?: 'view' | 'comment' | 'edit' }) {
    return this.repos.workspaces.create({
      id: randomUUID(),
      name: input.name,
      ownerId,
      defaultRole: input.defaultRole ?? 'edit',
    })
  }

  /**
   * 按邮箱添加成员。
   *
   * @throws 404 邮箱对应的用户不存在
   * @throws 409 目标已是成员（不静默改角色——那会掩盖调用方的意图）
   */
  async addMemberByEmail(
    workspaceId: string,
    actorId: string,
    input: { email: string; role: 'admin' | 'member' | 'viewer' },
  ): Promise<{ userId: string; role: WorkspaceRole }> {
    await this.requireMemberManagement(workspaceId, actorId)

    const user = await this.repos.users.findByEmail(input.email)
    if (!user) {
      throw notFound('该邮箱对应的用户不存在')
    }

    // 已在空间中 → 明确报错，不静默改角色
    const existing = await this.repos.workspaces.findMemberRole(workspaceId, user.id)
    if (existing !== null) {
      throw new AppError('CONFLICT', '该用户已是空间成员')
    }

    await this.repos.workspaces.upsertMember({
      workspaceId,
      userId: user.id,
      role: input.role,
    })

    return { userId: user.id, role: input.role }
  }

  /**
   * 修改成员角色。
   *
   * @throws 404 成员不存在
   * @throws 403 目标是 owner（任何人都不能通过接口改 owner 的角色）
   */
  async updateMemberRole(
    workspaceId: string,
    actorId: string,
    targetUserId: string,
    role: 'admin' | 'member' | 'viewer',
  ): Promise<void> {
    await this.requireMemberManagement(workspaceId, actorId)

    const targetRole = await this.repos.workspaces.findMemberRole(workspaceId, targetUserId)
    if (targetRole === null) {
      throw notFound('该用户不是空间成员')
    }

    // 硬边界：owner 的角色不可通过接口修改
    if (targetRole === 'owner') {
      throw forbidden('不能修改空间所有者的角色')
    }

    await this.repos.workspaces.upsertMember({
      workspaceId,
      userId: targetUserId,
      role,
    })
  }

  /**
   * 移除成员。
   *
   * @throws 404 不是空间成员
   * @throws 403 目标是 owner
   */
  async removeMember(
    workspaceId: string,
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.requireMemberManagement(workspaceId, actorId)

    const targetRole = await this.repos.workspaces.findMemberRole(workspaceId, targetUserId)
    if (targetRole === null) {
      throw notFound('该用户不是空间成员')
    }

    // 硬边界：owner 不可被移除（否则空间会失去所有者）
    if (targetRole === 'owner') {
      throw forbidden('不能移除空间所有者')
    }

    const removed = await this.repos.workspaces.removeMember(workspaceId, targetUserId)
    if (!removed) {
      throw notFound('该用户不是空间成员')
    }
  }

  /**
   * 修改空间设置（改名、默认角色）。
   *
   * @throws 403 仅 owner 可改
   */
  async updateSettings(
    workspaceId: string,
    actorId: string,
    input: { name?: string; defaultRole?: 'view' | 'comment' | 'edit' },
  ): Promise<void> {
    await this.requireWorkspaceSettings(workspaceId, actorId)
    await this.repos.workspaces.update(workspaceId, input)
  }
}
