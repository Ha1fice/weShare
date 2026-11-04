/**
 * 跨进程共享的纯逻辑：类型、契约、错误码、角色枚举。
 *
 * api 与 collab 都依赖本包，保证"REST 判得对、WS 判得错"不会发生——
 * 两边用的是同一份角色枚举与错误码（架构文档 §10 关键点）。
 */

// ---------------------------------------------------------------- 角色

export {
  ROLES,
  ROLE_RANK,
  maxRole,
  minRole,
  roleAtLeast,
  WORKSPACE_ROLES,
  ASSIGNABLE_WORKSPACE_ROLES,
  canManageMembers,
  canManageWorkspaceSettings,
} from './roles.js'
export type { Role, WorkspaceRole, AssignableWorkspaceRole } from './roles.js'

// ---------------------------------------------------------------- 领域枚举

export {
  NODE_TYPES,
  VISIBILITIES,
  SUBJECT_TYPES,
  ACL_EFFECTS,
  VERSION_KINDS,
  USER_STATUSES,
} from './enums.js'
export type {
  NodeType,
  Visibility,
  SubjectType,
  AclEffect,
  VersionKind,
  UserStatus,
} from './enums.js'

/** 统一错误码。前端按此映射提示文案（架构文档附录 A）。 */
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'COLLAB_ENABLED',
  'COLLAB_BUSY',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL_ERROR',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

/** HTTP 状态码与错误码的映射。 */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  COLLAB_ENABLED: 409,
  COLLAB_BUSY: 409,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL_ERROR: 500,
}

/** 统一错误响应体（架构文档附录 A）。 */
export interface ErrorBody {
  error: {
    code: ErrorCode
    message: string
    requestId: string
  }
}

/** WebSocket 拒绝码（架构文档附录 B）。 */
export const WS_CLOSE_CODES = {
  UNAUTHENTICATED: 4401,
  FORBIDDEN: 4403,
  NOT_FOUND: 4404,
  TOO_LARGE: 4429,
} as const

/** 树深度上限（架构文档 §7.3）。 */
export const MAX_TREE_DEPTH = 8

/** 单文档体积告警阈值与硬上限（字节，架构文档 §7.3）。 */
export const DOC_SIZE_WARN_BYTES = 2 * 1024 * 1024
export const DOC_SIZE_LIMIT_BYTES = 20 * 1024 * 1024

/** 附件类型白名单（架构文档 §3.3 C）。禁 SVG：可内嵌脚本。 */
export const ATTACHMENT_MIME_WHITELIST = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const
export type AttachmentMime = (typeof ATTACHMENT_MIME_WHITELIST)[number]

/** 附件大小上限（字节，架构文档 §12 Phase 2 验收 6）。 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

// ---------------------------------------------------------------- 密码策略

export {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_NORMALIZATION,
  normalizePassword,
  checkPasswordPolicy,
  passwordPolicyMessage,
  PasswordSchema,
} from './password-policy.js'
export type { PasswordPolicyResult } from './password-policy.js'

// ---------------------------------------------------------------- 认证契约

export {
  EmailSchema,
  DisplayNameSchema,
  RegisterBodySchema,
  LoginBodySchema,
  UpdateMeBodySchema,
} from './auth-contract.js'

export type {
  RegisterBody,
  LoginBody,
  UpdateMeBody,
  CurrentUser,
  MeResponse,
  AuthResponse,
} from './auth-contract.js'

// ---------------------------------------------------------------- 空间与成员契约

export {
  WorkspaceNameSchema,
  WorkspaceDefaultRoleSchema,
  AssignableMemberRoleSchema,
  CreateWorkspaceBodySchema,
  UpdateWorkspaceBodySchema,
  AddMemberBodySchema,
  UpdateMemberBodySchema,
} from './workspace-contract.js'

export type {
  CreateWorkspaceBody,
  UpdateWorkspaceBody,
  AddMemberBody,
  UpdateMemberBody,
  WorkspaceView,
  WorkspaceMemberView,
} from './workspace-contract.js'

// ---------------------------------------------------------------- 节点契约

export {
  CreatableNodeTypeSchema,
  NodeTitleSchema,
  CreateNodeBodySchema,
  UpdateNodeBodySchema,
} from './node-contract.js'

export type {
  CreateNodeBody,
  UpdateNodeBody,
  NodeView,
  TreeNodeView,
  BreadcrumbItem,
} from './node-contract.js'
