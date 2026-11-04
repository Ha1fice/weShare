/**
 * 数据库唯一出口（架构文档 §10、不变式 I7）。
 *
 * 业务代码（apps/* 与 packages/* 除本包外）只经此导入访问数据：
 *   - `repositories` —— Repository 接口（业务领域类型）
 *   - `types` —— 业务领域类型
 *
 * **不得**从这里导出 Prisma Client、Prisma Model 类型或驱动类型。
 * 实现细节（Prisma Client 的创建、adapter）留在包内。
 */

export type {
  AclEntry,
  Attachment,
  AuditEvent,
  CreateAclInput,
  CreateAuditInput,
  CreateNodeInput,
  CreateUserInput,
  DocumentContent,
  NodeType,
  NodeVisibility,
  SaveContentInput,
  Session,
  SubjectType,
  TreeNode,
  UpdateNodeInput,
  User,
  UserStatus,
  Version,
  VersionKind,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  AclEffect,
} from './repo/types.js'

export type {
  AclRepository,
  AttachmentsRepository,
  AuditRepository,
  ContentsRepository,
  NodesRepository,
  Repositories,
  UsersRepository,
  VersionsRepository,
  WorkspacesRepository,
} from './repo/interfaces.js'

export { normalizeEmail, normalizeTitle } from './repo/mapping.js'

export { createRepositories } from './repo/index.js'

export { createDbHandle } from './factory.js'
export type { DbHandle } from './factory.js'
