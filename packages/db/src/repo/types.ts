/**
 * 业务领域类型 —— Repository 对外暴露的唯一契约。
 *
 * 关键约束（架构文档不变式 I7）：
 *   - 这里**不能**出现 Prisma Model 类型、Prisma 命名空间类型或驱动类型。
 *   - Repository 实现负责 Prisma 类型 ↔ 领域类型的转换。
 *   - Service 层只认这些类型，不知道数据库的存在。
 *
 * 领域类型与数据库列名解耦：例如数据库列是 `title_norm`，
 * 领域里是 `titleNormalized`；数据库存 `email_lower`，领域里是 `email`。
 */

// ---------------------------------------------------------------- 通用

/** 用户账号状态。 */
export type UserStatus = 'active' | 'disabled'

/** 空间成员角色。 */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer'

/** 节点类型。 */
export type NodeType = 'folder' | 'doc' | 'sheet'

/** 节点可见性。 */
export type NodeVisibility = 'private' | 'workspace'

/** ACL 主体类型。 */
export type SubjectType = 'user' | 'workspace'

/** ACL 生效方式。allow=授予，deny=降权（deny 优先）。 */
export type AclEffect = 'allow' | 'deny'

/** 版本类型。 */
export type VersionKind = 'auto' | 'manual' | 'restore'

// ---------------------------------------------------------------- 用户与会话

export interface User {
  id: string
  email: string
  displayName: string
  avatarKey: string | null
  status: UserStatus
  createdAt: Date
  updatedAt: Date
  lastLoginAt: Date | null
}

export interface CreateUserInput {
  id: string
  email: string
  /** 已哈希的密码。哈希算法在 lib 层，本层不关心。 */
  passwordHash: string
  displayName: string
}

/**
 * 认证记录：用户 + 密码哈希。
 *
 * **仅登录流程使用，绝不出现在 API 响应里。**
 *
 * 为什么不把 passwordHash 塞进 User：
 *   User 是会被序列化成 JSON 返回给客户端的视图（GET /me）。
 *   一旦 passwordHash 在 User 上，就有可能被某个"返回整个 user"的接口带出去。
 *   拆成两个类型，让"带哈希"这件事在类型层面就是显式的、局部的。
 */
export interface AuthRecord {
  user: User
  passwordHash: string
}

export interface Session {
  id: string
  userId: string
  expiresAt: Date
  createdAt: Date
  lastSeenAt: Date
  revokedAt: Date | null
}

// ---------------------------------------------------------------- 空间与成员

export interface Workspace {
  id: string
  name: string
  ownerId: string
  defaultRole: 'view' | 'comment' | 'edit'
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

export interface WorkspaceMember {
  workspaceId: string
  userId: string
  role: WorkspaceRole
  createdAt: Date
}

// ---------------------------------------------------------------- 节点

export interface TreeNode {
  id: string
  workspaceId: string
  parentId: string | null
  type: NodeType
  title: string
  /** 小写去空白标题，仅用于检索 */
  titleNormalized: string
  ownerId: string
  visibility: NodeVisibility
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  /** 软删除标记。非 null 表示在回收站。 */
  deletedAt: Date | null
  deletedBy: string | null
  /** 一次删除批次的根，便于整批还原 */
  trashRootId: string | null
}

export interface CreateNodeInput {
  id: string
  workspaceId: string
  parentId?: string | null
  type: NodeType
  title: string
  ownerId: string
  visibility?: NodeVisibility
}

export interface UpdateNodeInput {
  title?: string
  parentId?: string | null
  visibility?: NodeVisibility
  sortOrder?: number
  deletedAt?: Date | null
  deletedBy?: string | null
  trashRootId?: string | null
}

// ---------------------------------------------------------------- 正文

export interface DocumentContent {
  nodeId: string
  /** PM JSON 镜像版本 */
  contentSchemaVersion: number
  /** Y.Doc 结构版本 */
  yjsSchemaVersion: number
  /** 只读镜像 */
  contentJson: unknown | null
  /** 协同事实源 */
  yjsState: Uint8Array<ArrayBufferLike> | null
  stateVector: Uint8Array<ArrayBufferLike> | null
  docSizeBytes: number
  revision: number
  textPreview: string | null
  charCount: number
  updatedAt: Date
  storedAt: Date | null
}

export interface SaveContentInput {
  nodeId: string
  contentJson?: unknown | null
  yjsState?: Uint8Array<ArrayBufferLike> | null
  stateVector?: Uint8Array<ArrayBufferLike> | null
  textPreview?: string | null
  charCount?: number
  docSizeBytes?: number
  updatedBy?: string | null
}

// ---------------------------------------------------------------- ACL

export interface AclEntry {
  id: string
  nodeId: string
  subjectType: SubjectType
  subjectId: string
  role: string
  effect: AclEffect
  createdBy: string
  createdAt: Date
}

export interface CreateAclInput {
  id: string
  nodeId: string
  subjectType: SubjectType
  subjectId: string
  role: string
  effect?: AclEffect
  createdBy: string
}

// ---------------------------------------------------------------- 版本

export interface Version {
  id: string
  nodeId: string
  versionNo: number
  kind: VersionKind
  label: string | null
  contentSchemaVersion: number
  yjsSchemaVersion: number
  contentJson: unknown
  yjsState: Uint8Array<ArrayBufferLike> | null
  createdBy: string | null
  createdAt: Date
}

// ---------------------------------------------------------------- 附件

export interface Attachment {
  id: string
  workspaceId: string
  nodeId: string | null
  uploaderId: string
  originalName: string
  mimeType: string
  byteSize: number
  sha256: string
  storageKey: string
  width: number | null
  height: number | null
  createdAt: Date
}

// ---------------------------------------------------------------- 审计

export interface AuditEvent {
  id: number
  workspaceId: string
  actorId: string | null
  action: string
  targetType: string
  targetId: string | null
  metadata: Record<string, unknown>
  ip: string | null
  createdAt: Date
}

export interface CreateAuditInput {
  workspaceId: string
  actorId?: string | null
  action: string
  targetType: string
  targetId?: string | null
  metadata?: Record<string, unknown>
  ip?: string | null
}
