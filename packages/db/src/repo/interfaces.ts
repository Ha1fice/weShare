/**
 * Repository 接口 —— 业务代码访问数据的唯一入口（架构文档不变式 I7）。
 *
 * 设计原则：
 *   1. **按业务聚合组织，不按数据库表拆分**。这里没有 "nodes.repo" 式的
 *      一表一文件的机械切分——每个接口对应一个业务用例聚合，
 *      方法是业务动作（"创建节点"、"标记删除"），不是 CRUD 动词。
 *   2. **接口只用业务领域类型**（见 types.ts），不出现 Prisma 类型。
 *   3. **避免无业务意义的 CRUD**。没有"通用 listAll"这种方法；
 *      每个方法都对应一个明确的业务查询。
 *   4. **事务边界在实现层**。跨表的原子操作由实现内部处理，
 *      不让 Service 层跨 Repository 拼事务（那会导致事务边界失控）。
 */

import type {
  AclEntry,
  AuthRecord,
  Attachment,
  AuditEvent,
  CreateAclInput,
  CreateAuditInput,
  CreateNodeInput,
  CreateUserInput,
  DocumentContent,
  NodeVisibility,
  SaveContentInput,
  Session,
  TreeNode,
  UpdateNodeInput,
  User,
  Version,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from './types.js'

/**
 * 账号与会话。
 *
 * 聚合：用户账号 + 它们的登录会话。
 */
export interface UsersRepository {
  /** 按 id 查用户。不存在返回 null。 */
  findById(id: string): Promise<User | null>

  /** 按邮箱查用户（大小写不敏感）。不存在返回 null。 */
  findByEmail(email: string): Promise<User | null>

  /**
   * 按邮箱查认证记录（用户 + 密码哈希）。
   *
   * **仅登录流程使用**。密码哈希不该出现在会被序列化的 User 上——
   * 拆成这个方法，"取哈希"这件事在类型层面就是显式且局部的。
   */
  findAuthRecordByEmail(email: string): Promise<AuthRecord | null>

  /**
   * 创建用户。
   * 邮箱大小写不敏感唯一——由数据库的 email_lower 唯一索引保证。
   * @throws 邮箱已存在
   */
  create(input: CreateUserInput): Promise<User>

  /** 更新显示名。 */
  updateDisplayName(id: string, displayName: string): Promise<User>

  /**
   * 更新密码哈希。
   *
   * 用于参数升级：将来把 Argon2 参数调高后，用户登录时用新参数重新哈希
   * 并写回（旧哈希仍可校验，因此升级是渐进的）。
   */
  updatePasswordHash(id: string, passwordHash: string): Promise<void>

  /** 记录登录时间。 */
  touchLastLogin(id: string, at: Date): Promise<void>

  /**
   * 启用/禁用账号。
   *
   * 禁用的账号不能登录（认证路由会检查 status）。
   */
  setStatus(id: string, status: 'active' | 'disabled'): Promise<User>

  /**
   * 为用户创建会话。
   * @param tokenHash sha256(随机 token)，明文不落库
   */
  createSession(input: {
    id: string
    userId: string
    tokenHash: Uint8Array
    expiresAt: Date
    ip?: string | null
    userAgent?: string | null
  }): Promise<Session>

  /** 按 token 哈希查未过期、未撤销的会话。 */
  findSessionByTokenHash(tokenHash: Uint8Array): Promise<Session | null>

  /** 撤销会话（登出）。 */
  revokeSession(id: string, at: Date): Promise<void>

  /**
   * 延长会话有效期（滑动续期）。
   *
   * 会话服务在校验时发现剩余有效期不足一半就调用它，把会话续到完整 TTL。
   * 不换 session id——换 id 会让客户端手里的 token 失效。
   */
  extendSession(id: string, newExpiresAt: Date): Promise<void>

  /** 清理过期会话。 */
  deleteExpiredSessions(before: Date): Promise<number>
}

/**
 * 空间与成员。
 *
 * 聚合：一个空间 + 它的成员名单。
 */
export interface WorkspacesRepository {
  findById(id: string): Promise<Workspace | null>

  /** 创建空间，创建者自动成为 owner。 */
  create(input: {
    id: string
    name: string
    ownerId: string
    defaultRole?: 'view' | 'comment' | 'edit'
  }): Promise<Workspace>

  update(id: string, input: { name?: string; defaultRole?: Workspace['defaultRole'] }): Promise<Workspace>

  /** 我参与的空间列表。 */
  listForUser(userId: string): Promise<Workspace[]>

  /** 空间成员名单。 */
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>

  /** 某人在空间中的角色。不在空间内返回 null。 */
  findMemberRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null>

  /** 添加成员。已存在则更新角色。 */
  upsertMember(input: {
    workspaceId: string
    userId: string
    role: WorkspaceRole
  }): Promise<WorkspaceMember>

  /** 移除成员。 */
  removeMember(workspaceId: string, userId: string): Promise<boolean>
}

/**
 * 目录树节点。
 *
 * 聚合：树结构本身 + 软删除/回收站语义。
 */
export interface NodesRepository {
  findById(id: string): Promise<TreeNode | null>

  /** 创建节点。 */
  create(input: CreateNodeInput): Promise<TreeNode>

  /**
   * 更新节点。
   * 移动（parentId）时必须由调用方先校验目标父级权限
   * 与是否构成循环（架构文档 §8.3）。
   */
  update(id: string, input: UpdateNodeInput): Promise<TreeNode>

  /**
   * 标记删除（软删除）。
   * 子树批量标记，trashRootId 保持一致以便整批还原。
   */
  softDelete(input: {
    id: string
    deletedAt: Date
    deletedBy: string
    trashRootId: string
  }): Promise<number>

  /** 还原节点（含子树）。 */
  restore(input: { trashRootId: string; restoredAt: Date }): Promise<number>

  /** 彻底删除（物理删除，依赖级联）。 */
  purge(id: string): Promise<boolean>

  /** 某空间的节点树（一次查询构造，不逐层递归）。 */
  listTree(workspaceId: string): Promise<TreeNode[]>

  /** 回收站列表（已删除的节点）。 */
  listTrash(workspaceId: string): Promise<TreeNode[]>

  /** 面包屑（祖先路径）。 */
  listAncestors(id: string): Promise<TreeNode[]>

  /** 子节点 ID（用于级联与循环检测）。 */
  listChildIds(id: string): Promise<string[]>

  /** 按标题前缀搜索（大小写不敏感）。 */
  searchByTitle(workspaceId: string, keyword: string): Promise<TreeNode[]>
}

/**
 * 文档正文。
 *
 * 聚合：内容镜像 + 协同事实源 + 版本号。
 */
export interface ContentsRepository {
  findByNodeId(nodeId: string): Promise<DocumentContent | null>

  /** 创建正文（新建文档时）。 */
  create(input: { nodeId: string; contentJson: unknown }): Promise<DocumentContent>

  /**
   * 保存内容（单机模式）。
   * 带 revision 乐观锁，冲突时抛错由上层转 409。
   */
  save(input: SaveContentInput & { expectedRevision?: number }): Promise<DocumentContent>

  /**
   * 保存协同落库结果。
   * 正文优先——派生失败不得回滚正文（架构文档 §5.4）。
   */
  saveCollaborative(input: SaveContentInput): Promise<DocumentContent>
}

/**
 * 节点授权。
 *
 * 聚合：一个节点上的 ACL 规则集（含 allow/deny）。
 */
export interface AclRepository {
  /** 列出节点的全部授权规则。 */
  listForNode(nodeId: string): Promise<AclEntry[]>

  /**
   * 查询与指定主体相关的规则。
   * 判定权限时按 user + workspace 两个主体分别查（架构文档 §8.2）。
   */
  listForSubjects(nodeId: string, userId: string, workspaceId: string): Promise<AclEntry[]>

  /** 新增或覆盖一条授权（同一 node+subject 唯一）。 */
  upsert(input: CreateAclInput): Promise<AclEntry>

  /** 撤销一条授权。 */
  remove(nodeId: string, aclId: string): Promise<boolean>
}

/**
 * 版本快照。
 *
 * 聚合：一个节点的版本序列。
 */
export interface VersionsRepository {
  listForNode(nodeId: string): Promise<Version[]>

  findByNo(nodeId: string, versionNo: number): Promise<Version | null>

  /** 创建版本快照，返回其版本号。 */
  create(input: {
    id: string
    nodeId: string
    kind: 'auto' | 'manual' | 'restore'
    label?: string | null
    contentJson: unknown
    yjsState?: Uint8Array | null
    createdBy?: string | null
  }): Promise<Version>

  /** 下一个版本号（并发安全，由唯一索引兜底）。 */
  nextVersionNo(nodeId: string): Promise<number>

  /** 清理超出保留策略的自动快照。 */
  pruneAutoVersions(input: {
    nodeId: string
    keepCount: number
    keepManual: boolean
  }): Promise<number>
}

/**
 * 附件。
 *
 * 聚合：附件元数据（文件本体在文件存储里）。
 */
export interface AttachmentsRepository {
  findById(id: string): Promise<Attachment | null>

  findByStorageKey(storageKey: string): Promise<Attachment | null>

  create(input: {
    id: string
    workspaceId: string
    nodeId?: string | null
    uploaderId: string
    originalName: string
    mimeType: string
    byteSize: number
    sha256: string
    storageKey: string
    width?: number | null
    height?: number | null
  }): Promise<Attachment>

  /** 关联到节点。 */
  attachToNode(id: string, nodeId: string): Promise<Attachment>

  /** 解除与节点的关联（节点删除后附件保留待清理）。 */
  detachFromNode(id: string): Promise<boolean>
}

/**
 * 审计事件。
 *
 * 聚合：只写不改的审计流水。
 */
export interface AuditRepository {
  /** 记录一条审计事件。 */
  create(input: CreateAuditInput): Promise<AuditEvent>

  /** 按空间分页查询。 */
  listForWorkspace(input: {
    workspaceId: string
    limit: number
    offset?: number
  }): Promise<AuditEvent[]>
}

/**
 * 所有 Repository 的集合。
 *
 * Service 层依赖这个接口，而不是具体的 Prisma 实现。
 */
export interface Repositories {
  users: UsersRepository
  workspaces: WorkspacesRepository
  nodes: NodesRepository
  contents: ContentsRepository
  acl: AclRepository
  versions: VersionsRepository
  attachments: AttachmentsRepository
  audit: AuditRepository
}

// 保持类型引用，避免 lint 报未使用
export type {
  AclEntry,
  AuthRecord,
  Attachment,
  AuditEvent,
  CreateAclInput,
  CreateAuditInput,
  CreateNodeInput,
  CreateUserInput,
  DocumentContent,
  NodeVisibility,
  SaveContentInput,
  Session,
  TreeNode,
  UpdateNodeInput,
  User,
  Version,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
}
