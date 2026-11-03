/**
 * 权限判定纯函数（架构文档 §8.2）。
 *
 * api 与 collab 共用这一份实现，避免"REST 判得对、WS 判得错"——
 * 这是 T4.1 的交付物，也是 §12 Phase 1 验收第 4 条的落点。
 *
 * 算法顺序不可交换：先算 base 与 acl，再按空间角色截断（cap）。
 */

import {
  maxRole,
  minRole,
  roleAtLeast,
  type AclEffect,
  type Role,
  type Visibility,
  type WorkspaceRole,
} from '@weshare/shared'

/** 节点元数据中参与权限判定的部分。 */
export interface AuthzNode {
  id: string
  workspaceId: string
  ownerId: string
  visibility: Visibility
  /** 软删除标记。非 null 表示在回收站。 */
  deletedAt: Date | null
}

/** 一条 ACL 记录。 */
export interface AuthzAclEntry {
  subjectType: 'user' | 'workspace'
  subjectId: string
  role: Role
  effect: AclEffect
}

/** 判定所需的空间上下文。 */
export interface AuthzContext {
  userId: string
  /** 用户在节点所属空间的角色。不在空间内则为 null。 */
  workspaceRole: WorkspaceRole | null
  /** 空间默认角色。 */
  workspaceDefaultRole: Role
  /** 命中的 ACL 条目（已按 subject 过滤）。 */
  aclEntries: AuthzAclEntry[]
}

/** 节点操作类型。回收站分支需要区分。 */
export type AuthzAction = 'read' | 'comment' | 'edit' | 'manage' | 'restore' | 'purge'

/**
 * 空间角色封顶。
 * owner/admin 不封顶；viewer 恒为只读；member 无上限。
 */
function capFor(workspaceRole: WorkspaceRole | null): Role | null {
  if (workspaceRole === 'owner' || workspaceRole === 'admin') return 'manage'
  if (workspaceRole === 'viewer') return 'view'
  return null
}

/**
 * 计算用户对节点的有效角色。
 *
 * 返回 null 表示拒绝。
 */
export function effectiveRole(
  ctx: AuthzContext,
  node: AuthzNode,
  action: AuthzAction = 'read',
): Role | null {
  // 0. 无成员关系一律拒绝
  if (ctx.workspaceRole === null) return null

  // 1. 空间角色封顶（先取权限，再按空间角色截断）
  const cap = capFor(ctx.workspaceRole)

  // 2. 基础权限
  let base: Role | null
  if (node.ownerId === ctx.userId) {
    base = 'manage'
  } else if (node.visibility === 'workspace') {
    base = ctx.workspaceDefaultRole
  } else {
    // private 且非 owner
    base = null
  }

  // 3. ACL：allow 抬升，deny 压低
  let aclAllow: Role | null = null
  let aclDeny: Role | null = null
  for (const entry of ctx.aclEntries) {
    if (entry.effect === 'allow') {
      aclAllow = maxRole(aclAllow, entry.role)
    } else {
      aclDeny = minRole(aclDeny, entry.role)
    }
  }

  // 4. 合成：allow 抬升，deny 压低，deny 优先
  let role = maxRole(base, aclAllow)
  if (aclDeny !== null) role = minRole(role, aclDeny)
  if (role === null) return null
  if (cap !== null) role = minRole(role, cap)

  // 5. 回收站：已删除节点仅 manage 可查看与还原；purge 仅 owner/admin
  if (node.deletedAt !== null) {
    if (action === 'purge') {
      return ctx.workspaceRole === 'owner' || ctx.workspaceRole === 'admin' ? 'manage' : null
    }
    if (action === 'restore') {
      return roleAtLeast(role, 'manage') ? 'manage' : null
    }
    return roleAtLeast(role, 'manage') ? 'manage' : null
  }

  return role
}

/** 判定用户是否具备某能力。 */
export function can(
  ctx: AuthzContext,
  node: AuthzNode,
  required: Role,
  action: AuthzAction = 'read',
): boolean {
  return roleAtLeast(effectiveRole(ctx, node, action), required)
}
