/**
 * 节点（目录树 / 文档）领域服务。
 *
 * 权限判定全部复用 `@weshare/authz` 的 `effectiveRole`——api 与 collab
 * 共用同一份算法，避免"REST 判得对、WS 判得错"（架构文档 §8.2、§4.2）。
 *
 * 关键校验点（架构文档 §8.3）：
 *
 * | 操作 | 要求 |
 * |---|---|
 * | 读取节点 | effectiveRole ≥ view |
 * | 创建节点 | 空间成员 + 目标父级 ≥ edit（根级创建要求空间默认角色 ≥ edit） |
 * | 移动节点 | 节点本身 ≥ edit **且** 目标父级 ≥ edit |
 * | 删除 / 还原 | effectiveRole ≥ manage |
 * | 彻底删除 | 空间 owner/admin（authz 的 purge 分支） |
 *
 * **权限不继承自父文件夹**（MVP 明确不做）——所以"能在 A 目录编辑"不等于
 * "能把文档放进 B 目录"，移动必须单独校验目标父级。
 */

import { randomUUID } from 'node:crypto'
import type { Repositories, TreeNode } from '@weshare/db'
import {
  MAX_TREE_DEPTH,
  roleAtLeast,
  type Role,
  type Visibility,
  type WorkspaceRole,
} from '@weshare/shared'
import {
  effectiveRole,
  type AuthzAclEntry,
  type AuthzContext,
  type AuthzNode,
} from '@weshare/authz'
import { forbidden, notFound, validationFailed } from '../http/errors.js'

/** 新文档的初始正文（空段落）。 */
const EMPTY_DOC_JSON = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

export interface NodeServiceOptions {
  repos: Repositories
}

/** 判定上下文里与空间相关的部分（同一空间内所有节点共用）。 */
interface WorkspaceAuthzBase {
  workspaceRole: WorkspaceRole
  workspaceDefaultRole: Role
}

/** 节点的 API 视图所需字段。 */
export interface NodeAccess {
  node: TreeNode
  role: Role
}

export class NodeService {
  private readonly repos: Repositories

  constructor(options: NodeServiceOptions) {
    this.repos = options.repos
  }

  // ---------------------------------------------------------------- 内部：权限

  /**
   * 载入节点并确认当前用户是**该节点所属空间**的成员。
   *
   * @throws 404 节点不存在 / 已彻底删除 / 用户不是空间成员
   *   （统一 404 —— 403 会泄露"节点存在但无权"）
   */
  private async loadNodeForUser(nodeId: string, userId: string): Promise<TreeNode> {
    const node = await this.repos.nodes.findById(nodeId)
    if (!node) throw notFound('节点不存在')

    const workspaceRole = await this.repos.workspaces.findMemberRole(node.workspaceId, userId)
    if (workspaceRole === null) throw notFound('节点不存在')

    return node
  }

  /** 取空间级判定上下文。 */
  private async workspaceBase(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceAuthzBase> {
    const workspaceRole = await this.repos.workspaces.findMemberRole(workspaceId, userId)
    if (workspaceRole === null) throw notFound('空间不存在')

    const workspace = await this.repos.workspaces.findById(workspaceId)
    if (!workspace) throw notFound('空间不存在')

    return { workspaceRole, workspaceDefaultRole: workspace.defaultRole }
  }

  /** 组装某节点的判定上下文（单节点用）。 */
  private async buildContext(
    node: TreeNode,
    userId: string,
    base?: WorkspaceAuthzBase,
  ): Promise<AuthzContext> {
    const b = base ?? (await this.workspaceBase(node.workspaceId, userId))
    const acl = await this.repos.acl.listForSubjects(node.id, userId, node.workspaceId)

    return {
      userId,
      workspaceRole: b.workspaceRole,
      workspaceDefaultRole: b.workspaceDefaultRole,
      aclEntries: acl.map(toAuthzAcl),
    }
  }

  /**
   * 计算用户对节点的有效角色。
   *
   * 返回 null 表示无权（节点可能仍存在，只是用户读不到）。
   */
  private async roleOn(
    node: TreeNode,
    userId: string,
    action: Parameters<typeof effectiveRole>[2] = 'read',
    base?: WorkspaceAuthzBase,
  ): Promise<Role | null> {
    const ctx = await this.buildContext(node, userId, base)
    return effectiveRole(ctx, toAuthzNode(node), action)
  }

  /**
   * 要求对节点具备某能力。
   *
   * @throws 404 节点不存在或用户不是空间成员
   * @throws 403 是空间成员但对该节点权限不足
   */
  /**
   * 判定用户对节点的有效角色，不足则抛错。
   *
   * 对其它领域服务（如 ContentService）公开，是为了让"能不能写正文"
   * 与"能不能改名"用**同一条判定**——两处各写一份必然出现
   * "能改名但存不进正文"这类诡异不一致。
   */
  async requireRole(
    nodeId: string,
    userId: string,
    required: Role,
    action: Parameters<typeof effectiveRole>[2] = 'read',
  ): Promise<NodeAccess> {
    const node = await this.loadNodeForUser(nodeId, userId)
    const role = await this.roleOn(node, userId, action)

    if (role === null) throw notFound('节点不存在')
    if (!roleAtLeast(role, required)) throw forbidden('无权执行该操作')

    return { node, role }
  }

  // ---------------------------------------------------------------- 读

  /** 节点详情 + 我的有效角色。 */
  async getNode(nodeId: string, userId: string): Promise<NodeAccess> {
    return this.requireRole(nodeId, userId, 'view')
  }

  /**
   * 空间目录树（只含当前用户可读的节点）。
   *
   * 过滤规则：
   *   - 不可读的节点从结果里去掉；
   *   - 若某节点可读但它的父节点不可读，把它挂到根级返回
   *     （否则整棵子树会静默消失，用户会以为数据丢了）。
   *
   * 性能说明：判定在内存里做（用与别处同一份 `effectiveRole`），
   * 不是 SQL 内联过滤。架构文档 §8.3 要求 SQL 过滤，这里是有意的 MVP 简化，
   * 已登记在 §15.3 待复核项——数据量上来后改成 SQL 侧过滤。
   */
  async listTree(
    workspaceId: string,
    userId: string,
  ): Promise<Array<TreeNode & { role: Role; hasChildren: boolean }>> {
    const base = await this.workspaceBase(workspaceId, userId)

    const all = await this.repos.nodes.listTree(workspaceId)
    if (all.length === 0) return []

    // 一次批量取 ACL（避免 N 次查询）
    const aclRows = await this.repos.acl.listForNodes(
      all.map((n) => n.id),
      userId,
      workspaceId,
    )
    const aclByNode = groupAclByNode(aclRows)

    const readable = new Map<string, Role>()
    for (const node of all) {
      const ctx: AuthzContext = {
        userId,
        workspaceRole: base.workspaceRole,
        workspaceDefaultRole: base.workspaceDefaultRole,
        aclEntries: aclByNode.get(node.id) ?? [],
      }
      const role = effectiveRole(ctx, toAuthzNode(node))
      if (role !== null) readable.set(node.id, role)
    }

    // 计算每个可读节点的子节点数（只看可读的子节点）
    const readableChildren = new Map<string | null, number>()
    for (const node of all) {
      if (!readable.has(node.id)) continue
      const parentKey = node.parentId !== null && readable.has(node.parentId) ? node.parentId : null
      readableChildren.set(parentKey, (readableChildren.get(parentKey) ?? 0) + 1)
    }

    const result: Array<TreeNode & { role: Role; hasChildren: boolean }> = []
    for (const node of all) {
      const role = readable.get(node.id)
      if (role === undefined) continue

      // 父节点不可读时挂到根级，避免整棵子树消失
      const effectiveParent =
        node.parentId !== null && readable.has(node.parentId) ? node.parentId : null

      result.push({
        ...node,
        parentId: effectiveParent,
        role,
        hasChildren: (readableChildren.get(node.id) ?? 0) > 0,
      })
    }

    return result
  }

  /** 回收站（只有对节点具备 manage 的才可见）。 */
  async listTrash(
    workspaceId: string,
    userId: string,
  ): Promise<Array<TreeNode & { role: Role }>> {
    const base = await this.workspaceBase(workspaceId, userId)

    const all = await this.repos.nodes.listTrash(workspaceId)
    if (all.length === 0) return []

    const aclRows = await this.repos.acl.listForNodes(
      all.map((n) => n.id),
      userId,
      workspaceId,
    )
    const aclByNode = groupAclByNode(aclRows)

    const result: Array<TreeNode & { role: Role }> = []
    for (const node of all) {
      const ctx: AuthzContext = {
        userId,
        workspaceRole: base.workspaceRole,
        workspaceDefaultRole: base.workspaceDefaultRole,
        aclEntries: aclByNode.get(node.id) ?? [],
      }
      // 回收站内只有 manage 可查看（架构文档 §8.2）
      const role = effectiveRole(ctx, toAuthzNode(node), 'read')
      if (role !== null) result.push({ ...node, role })
    }

    return result
  }

  /** 面包屑：从根到父级。 */
  async breadcrumb(nodeId: string, userId: string): Promise<Array<{ id: string; title: string }>> {
    const { node } = await this.requireRole(nodeId, userId, 'view')
    const ancestors = await this.repos.nodes.listAncestors(node.id)
    return ancestors.map((a) => ({ id: a.id, title: a.title }))
  }

  /** 按标题前缀搜索（只返回可读节点）。 */
  async search(
    workspaceId: string,
    userId: string,
    keyword: string,
  ): Promise<Array<TreeNode & { role: Role }>> {
    const base = await this.workspaceBase(workspaceId, userId)
    const found = await this.repos.nodes.searchByTitle(workspaceId, keyword)
    if (found.length === 0) return []

    const aclRows = await this.repos.acl.listForNodes(
      found.map((n) => n.id),
      userId,
      workspaceId,
    )
    const aclByNode = groupAclByNode(aclRows)

    const result: Array<TreeNode & { role: Role }> = []
    for (const node of found) {
      const ctx: AuthzContext = {
        userId,
        workspaceRole: base.workspaceRole,
        workspaceDefaultRole: base.workspaceDefaultRole,
        aclEntries: aclByNode.get(node.id) ?? [],
      }
      const role = effectiveRole(ctx, toAuthzNode(node))
      if (role !== null) result.push({ ...node, role })
    }

    return result
  }

  // ---------------------------------------------------------------- 写

  /**
   * 创建节点。
   *
   * @throws 422 参数不合法（如父节点类型为 doc）
   * @throws 403 无权限在目标位置创建
   */
  async createNode(
    userId: string,
    input: {
      workspaceId: string
      parentId?: string | null
      type: 'folder' | 'doc'
      title: string
      visibility?: Visibility
    },
  ): Promise<NodeAccess> {
    const base = await this.workspaceBase(input.workspaceId, userId)

    const parentId = input.parentId ?? null

    if (parentId !== null) {
      const parent = await this.repos.nodes.findById(parentId)
      if (!parent) throw notFound('父节点不存在')
      if (parent.workspaceId !== input.workspaceId) {
        // 跨空间挂载一律拒绝——否则等于把内容搬进别人的空间
        throw notFound('父节点不存在')
      }
      if (parent.deletedAt !== null) {
        throw validationFailed('父节点在回收站中，不能在其下创建')
      }
      if (parent.type !== 'folder') {
        throw validationFailed('只能在文件夹下创建节点')
      }

      const parentRole = await this.roleOn(parent, userId, 'edit', base)
      if (parentRole === null) throw notFound('父节点不存在')
      if (!roleAtLeast(parentRole, 'edit')) throw forbidden('无权在该目录下创建')

      // 深度校验：父深度 + 1 ≤ 上限
      const ancestors = await this.repos.nodes.listAncestors(parent.id)
      const parentDepth = ancestors.length + 1
      if (parentDepth + 1 > MAX_TREE_DEPTH) {
        throw validationFailed(`目录层级不能超过 ${MAX_TREE_DEPTH} 层`)
      }
    } else {
      // 根级创建：要求空间默认角色（按空间角色封顶后）达到 edit
      const effective = minWorkspaceDefault(base)
      if (!roleAtLeast(effective, 'edit')) {
        throw forbidden('无权在该空间创建内容')
      }
    }

    const id = randomUUID()
    const common = {
      id,
      workspaceId: input.workspaceId,
      parentId,
      title: input.title,
      ownerId: userId,
      visibility: input.visibility ?? 'workspace',
    }

    const node =
      input.type === 'doc'
        ? await this.repos.nodes.createDocument({ ...common, type: 'doc', contentJson: EMPTY_DOC_JSON })
        : await this.repos.nodes.create({ ...common, type: 'folder' })

    // 创建者对自己的节点恒为 manage
    return { node, role: 'manage' }
  }

  /** 改名 / 改可见性。 */
  async updateNode(
    userId: string,
    nodeId: string,
    input: { title?: string; visibility?: Visibility },
  ): Promise<NodeAccess> {
    const { node, role } = await this.requireRole(nodeId, userId, 'edit')

    const updated = await this.repos.nodes.update(node.id, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    })

    return { node: updated, role }
  }

  /**
   * 移动节点。
   *
   * 三重校验（架构文档 §8.3）：
   *   1. 节点本身 ≥ edit；
   *   2. **目标父级 ≥ edit**（权限不继承，所以必须单独查）；
   *   3. 目标不能是节点自身或其子孙（否则树成环）。
   * 另加：目标必须同空间、未删除、是文件夹；移动后总深度不超上限。
   */
  async moveNode(
    userId: string,
    nodeId: string,
    newParentId: string | null,
  ): Promise<NodeAccess> {
    const { node, role } = await this.requireRole(nodeId, userId, 'edit')

    if (node.deletedAt !== null) {
      throw validationFailed('回收站中的节点不能移动')
    }

    if (newParentId !== null) {
      if (newParentId === node.id) {
        throw validationFailed('不能把节点移动到自身下')
      }

      const target = await this.repos.nodes.findById(newParentId)
      if (!target) throw notFound('目标目录不存在')
      if (target.workspaceId !== node.workspaceId) throw notFound('目标目录不存在')
      if (target.deletedAt !== null) throw validationFailed('目标目录在回收站中')
      if (target.type !== 'folder') throw validationFailed('只能移动到文件夹下')

      const targetRole = await this.roleOn(target, userId, 'edit')
      if (targetRole === null) throw notFound('目标目录不存在')
      if (!roleAtLeast(targetRole, 'edit')) throw forbidden('无权移动到该目录')

      // 循环检测：目标不能是节点的子孙
      const targetAncestors = await this.repos.nodes.listAncestors(target.id)
      if (targetAncestors.some((a) => a.id === node.id)) {
        throw validationFailed('不能把节点移动到自己的子目录下')
      }

      // 深度校验：目标深度 + 1（节点自身）+ 子树高度 ≤ 上限
      const targetDepth = targetAncestors.length + 1
      const subtreeHeight = await this.subtreeHeight(node.id)
      if (targetDepth + subtreeHeight > MAX_TREE_DEPTH) {
        throw validationFailed(`目录层级不能超过 ${MAX_TREE_DEPTH} 层`)
      }
    } else {
      // 移到根级：同样要求空间默认角色达到 edit
      const base = await this.workspaceBase(node.workspaceId, userId)
      if (!roleAtLeast(minWorkspaceDefault(base), 'edit')) {
        throw forbidden('无权移到根目录')
      }
    }

    const updated = await this.repos.nodes.update(node.id, { parentId: newParentId })
    return { node: updated, role }
  }

  /** 软删除（连同子树）。 */
  async softDelete(userId: string, nodeId: string): Promise<{ affected: number }> {
    const { node } = await this.requireRole(nodeId, userId, 'manage')

    if (node.deletedAt !== null) {
      throw validationFailed('节点已在回收站中')
    }

    // trashRootId 用节点自身 id——整批还原时按它找回整棵子树
    const affected = await this.repos.nodes.softDelete({
      id: node.id,
      deletedAt: new Date(),
      deletedBy: userId,
      trashRootId: node.id,
    })

    return { affected }
  }

  /** 还原（整批，按 trashRootId）。 */
  async restore(userId: string, nodeId: string): Promise<{ affected: number }> {
    const { node } = await this.requireRole(nodeId, userId, 'manage', 'restore')

    if (node.deletedAt === null) {
      throw validationFailed('节点不在回收站中')
    }

    const trashRootId = node.trashRootId ?? node.id

    // 防御性检查：父目录若已被彻底删除，还原后节点会悬空。
    // 正常情况下 FK 的 ON DELETE CASCADE 会把子节点一起删掉，这个分支几乎不可达；
    // 保留它是为了兜住"手工改库"这类数据异常。
    if (node.parentId !== null) {
      const parent = await this.repos.nodes.findById(node.parentId)
      if (!parent || parent.deletedAt !== null) {
        throw validationFailed('上级目录已被删除，请先还原上级目录')
      }
    }

    const affected = await this.repos.nodes.restore({
      trashRootId,
      restoredAt: new Date(),
    })

    return { affected }
  }

  /** 彻底删除（仅空间 owner/admin，依赖 FK 级联删子树）。 */
  async purge(userId: string, nodeId: string): Promise<{ ok: true }> {
    const node = await this.loadNodeForUser(nodeId, userId)

    // 先判 purge 资格（架构文档 §8.2 第 5 条：仅空间 owner/admin）。
    // 注意顺序：不能先查"能否读"——已删除节点要求 manage 才能读，
    // 而空间 admin 对别人创建的 workspace 文档 base 是空间默认角色（通常 edit），
    // 先读后判会让 admin 永远删不掉别人删的东西。
    const purgeRole = await this.roleOn(node, userId, 'purge')

    if (purgeRole === null) {
      // 没有 purge 资格，再区分"看得见但不能删"（403）与"根本看不见"（404）——
      // 否则会出现"回收站里看得见、一点删除就说不存在"的误导。
      const readRole = await this.roleOn(node, userId, 'read')
      if (readRole === null) throw notFound('节点不存在')
      throw forbidden('仅空间所有者或管理员可彻底删除')
    }

    // purge 只对回收站中的节点有意义；对未删除节点直接 purge 等于绕过回收站
    if (node.deletedAt === null) {
      throw validationFailed('请先删除到回收站，再彻底删除')
    }

    const removed = await this.repos.nodes.purge(node.id)
    if (!removed) throw notFound('节点不存在')

    return { ok: true }
  }

  // ---------------------------------------------------------------- 内部：深度

  /**
   * 计算子树高度（节点自身算 1 层）。
   *
   * 逐层 BFS；深度上限 8，所以最多 8 轮。
   */
  private async subtreeHeight(rootId: string): Promise<number> {
    let height = 0
    let frontier = [rootId]

    while (frontier.length > 0 && height <= MAX_TREE_DEPTH) {
      height += 1
      const next: string[] = []
      for (const id of frontier) {
        const children = await this.repos.nodes.listChildIds(id)
        next.push(...children)
      }
      frontier = next
    }

    return height
  }
}

// ---------------------------------------------------------------- 纯函数辅助

/** 领域节点 → authz 入参。 */
function toAuthzNode(node: TreeNode): AuthzNode {
  return {
    id: node.id,
    workspaceId: node.workspaceId,
    ownerId: node.ownerId,
    visibility: node.visibility,
    deletedAt: node.deletedAt,
  }
}

/** ACL 条目 → authz 入参。 */
function toAuthzAcl(entry: {
  subjectType: 'user' | 'workspace'
  subjectId: string
  role: string
  effect: 'allow' | 'deny'
}): AuthzAclEntry {
  return {
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    role: entry.role as Role,
    effect: entry.effect,
  }
}

/** 按节点 id 分组 ACL（批量查询后分组用）。 */
function groupAclByNode(
  rows: Array<{
    nodeId: string
    subjectType: 'user' | 'workspace'
    subjectId: string
    role: string
    effect: 'allow' | 'deny'
  }>,
): Map<string, AuthzAclEntry[]> {
  const map = new Map<string, AuthzAclEntry[]>()
  for (const row of rows) {
    const list = map.get(row.nodeId) ?? []
    list.push(toAuthzAcl(row))
    map.set(row.nodeId, list)
  }
  return map
}

/**
 * 空间默认角色经空间角色封顶后的实际权限。
 *
 * 用于"根级创建/移动到根"这类没有父节点可查的场景：
 * viewer 恒为 view；member 取默认角色；owner/admin 不封顶。
 */
function minWorkspaceDefault(base: WorkspaceAuthzBase): Role {
  if (base.workspaceRole === 'viewer') return 'view'
  return base.workspaceDefaultRole
}
