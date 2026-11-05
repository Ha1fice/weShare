/**
 * 协同连接的鉴权与授权。
 *
 * 与 api 侧共用同一份判定算法（`@weshare/authz` 的 `effectiveRole`）——
 * 这是"REST 判得对、WS 判得错"不会发生的根本原因。任何"这次先放开"
 * 的临时判断都会让两侧漂移，所以这里**不做**任何 authz 之外的特判。
 *
 * 判定结果落成两种角色：
 *   - `edit` 及以上 → 可写连接
 *   - `view`       → 只读连接（服务端拒收 update 帧）
 *   - 其余（null） → 握手失败 4403
 */

import type { Repositories } from '@weshare/db'
import {
  effectiveRole,
  type AuthzAclEntry,
  type AuthzContext,
  type AuthzNode,
} from '@weshare/authz'
import { ROLES, type Role, type WorkspaceRole } from '@weshare/shared'

/** 参与权限判定的角色集合（用于过滤脏枚举值）。 */
const REQUIRED_ROLES = ROLES
import { readSessionToken } from './cookie.js'

export type CollabDenialReason =
  | 'unauthenticated'
  | 'forbidden'
  | 'not-found'
  | 'invalid-document-name'

export interface CollabAllowance {
  ok: true
  userId: string
  displayName: string
  nodeId: string
  workspaceId: string
  role: Role
  /** 可写 = 角色 ≥ edit。只读连接由 Hocuspocus 拒收 update 帧。 */
  canWrite: boolean
  canManage: boolean
}

export interface CollabDenial {
  ok: false
  reason: CollabDenialReason
  message: string
}

export type CollabAuthResult = CollabAllowance | CollabDenial

export interface CollabAuthOptions {
  repos: Repositories
  /** 复用 api 的 SessionService 逻辑；这里只依赖它的 resolve 能力。 */
  resolveSession: (token: string) => Promise<{ userId: string } | null>
}

/** 角色是否足以写入。 */
function roleAllowsEdit(role: Role | null): boolean {
  return role === 'edit' || role === 'manage'
}

function roleAllowsManage(role: Role | null): boolean {
  return role === 'manage'
}

export class CollabAuth {
  private readonly repos: Repositories
  private readonly resolveSession: CollabAuthOptions['resolveSession']

  constructor(options: CollabAuthOptions) {
    this.repos = options.repos
    this.resolveSession = options.resolveSession
  }

  /**
   * 鉴权 + 授权。
   *
   * @param nodeId 已从 documentName 解析出的节点 id
   * @param cookieHeader 握手的 Cookie 头
   */
  async authorize(nodeId: string, cookieHeader: string | undefined): Promise<CollabAuthResult> {
    const token = readSessionToken(cookieHeader)
    if (!token) {
      return { ok: false, reason: 'unauthenticated', message: '未登录' }
    }

    const session = await this.resolveSession(token)
    if (!session) {
      return { ok: false, reason: 'unauthenticated', message: '会话已失效' }
    }

    const node = await this.repos.nodes.findById(nodeId)
    // 不存在一律 404 语义——不区分"没有"与"无权"，避免探测（与 REST 侧一致）
    if (!node) {
      return { ok: false, reason: 'not-found', message: '文档不存在' }
    }

    const workspaceRole = (await this.repos.workspaces.findMemberRole(
      node.workspaceId,
      session.userId,
    )) as WorkspaceRole | null
    if (workspaceRole === null) {
      return { ok: false, reason: 'not-found', message: '文档不存在' }
    }

    const workspace = await this.repos.workspaces.findById(node.workspaceId)
    if (!workspace) {
      return { ok: false, reason: 'not-found', message: '文档不存在' }
    }

    const aclRows = await this.repos.acl.listForSubjects(node.id, session.userId, node.workspaceId)
    // 数据库里 role/effect 是字符串列（SQLite 没有枚举约束，见架构文档 R19）。
    // 只有能映射到已知角色的条目才参与判定——脏值一律忽略而不是猜。
    const aclEntries: AuthzAclEntry[] = []
    for (const row of aclRows) {
      const role = row.role as Role
      if (!(REQUIRED_ROLES as readonly string[]).includes(role)) continue
      aclEntries.push({
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        role,
        effect: row.effect,
      })
    }

    const ctx: AuthzContext = {
      userId: session.userId,
      workspaceRole,
      workspaceDefaultRole: workspace.defaultRole,
      aclEntries,
    }

    const authzNode: AuthzNode = {
      id: node.id,
      workspaceId: node.workspaceId,
      ownerId: node.ownerId,
      visibility: node.visibility,
      deletedAt: node.deletedAt,
    }

    const role = effectiveRole(ctx, authzNode)
    if (role === null) {
      return { ok: false, reason: 'not-found', message: '文档不存在' }
    }

    // 已删除的文档：回收站里的内容不该被协同编辑。
    //
    // 注意 `effectiveRole` 对已删除节点的语义是"**能否管理**它"（返回 manage
    // 或 null），不是"能否编辑正文"。如果直接拿它算 canWrite，空间所有者
    // 会拿到一个可写连接——而实际上它已经在回收站里了。
    // 所以这里显式拦一道，把"能管理回收站条目"与"能协同编辑"分开。
    if (authzNode.deletedAt !== null) {
      return { ok: false, reason: 'not-found', message: '文档不存在' }
    }

    const user = await this.repos.users.findById(session.userId)
    if (!user) {
      return { ok: false, reason: 'unauthenticated', message: '会话已失效' }
    }

    return {
      ok: true,
      userId: session.userId,
      displayName: user.displayName,
      nodeId: node.id,
      workspaceId: node.workspaceId,
      role,
      canWrite: roleAllowsEdit(role),
      canManage: roleAllowsManage(role),
    }
  }
}
