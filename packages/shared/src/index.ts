/**
 * 跨进程共享的纯逻辑：类型、契约、错误码、角色枚举。
 *
 * api 与 collab 都依赖本包，保证"REST 判得对、WS 判得错"不会发生——
 * 两边用的是同一份角色枚举与错误码（架构文档 §10 关键点）。
 */

/** 文档级角色。顺序即权限高低，用于 max/min 比较（架构文档 §8.2）。 */
export const ROLES = ['view', 'comment', 'edit', 'manage'] as const
export type Role = (typeof ROLES)[number]

/** 角色权重。higher 表示权限更高。 */
export const ROLE_RANK: Record<Role, number> = {
  view: 0,
  comment: 1,
  edit: 2,
  manage: 3,
}

/** 取两个角色中权限更高的一个。null 视为"无"。 */
export function maxRole(a: Role | null, b: Role | null): Role | null {
  if (a === null) return b
  if (b === null) return a
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b
}

/** 取两个角色中权限更低的一个。null 视为"无"。 */
export function minRole(a: Role | null, b: Role | null): Role | null {
  if (a === null) return b
  if (b === null) return a
  return ROLE_RANK[a] <= ROLE_RANK[b] ? a : b
}

/** 角色是否达到所需能力。 */
export function roleAtLeast(actual: Role | null, required: Role): boolean {
  return actual !== null && ROLE_RANK[actual] >= ROLE_RANK[required]
}

/** 空间成员角色。 */
export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

/** 节点类型。 */
export const NODE_TYPES = ['folder', 'doc', 'sheet'] as const
export type NodeType = (typeof NODE_TYPES)[number]

/** 节点可见性。 */
export const VISIBILITIES = ['private', 'workspace'] as const
export type Visibility = (typeof VISIBILITIES)[number]

/** ACL 主体类型。 */
export const SUBJECT_TYPES = ['user', 'workspace'] as const
export type SubjectType = (typeof SUBJECT_TYPES)[number]

/**
 * ACL 生效方式。
 * allow = 授予；deny = 降权，优先于 allow（架构文档 §8.2）。
 * 没有 effect 就无法在空间默认角色为 edit 时把某人单独降为只读。
 */
export const ACL_EFFECTS = ['allow', 'deny'] as const
export type AclEffect = (typeof ACL_EFFECTS)[number]

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
