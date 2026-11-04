/**
 * Prisma 行类型 ↔ 业务领域类型的映射。
 *
 * 这是 Repository 实现层内部的共享件——每个 .repo.ts 都从这里取转换函数，
 * 不重复定义行类型。**对外不导出**：业务代码看到的只有 types.ts 的领域类型。
 *
 * 关键约束（架构文档不变式 I7）：
 *   Prisma Model 的形状只允许出现在本文件与各 .repo.ts 内，
 *   不得出现在任何导出签名里。
 */

import type { WorkspaceRole } from '@weshare/shared'
import type {
  AclEntry,
  Attachment,
  AuditEvent,
  DocumentContent,
  TreeNode,
  User,
  Version,
  Workspace,
  WorkspaceMember,
} from './types.js'

// ---------------------------------------------------------------- Prisma 行类型

export type PrismaUser = {
  id: string
  email: string
  emailLower: string
  passwordHash: string
  displayName: string
  avatarKey: string | null
  status: string
  createdAt: Date
  updatedAt: Date
  lastLoginAt: Date | null
}

export type PrismaSession = {
  id: string
  userId: string
  expiresAt: Date
  createdAt: Date
  lastSeenAt: Date
  revokedAt: Date | null
}

export type PrismaWorkspace = {
  id: string
  name: string
  ownerId: string
  defaultRole: string
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

export type PrismaWorkspaceMember = {
  workspaceId: string
  userId: string
  role: string
  createdAt: Date
}

export type PrismaNode = {
  id: string
  workspaceId: string
  parentId: string | null
  type: string
  title: string
  titleNorm: string
  ownerId: string
  visibility: string
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  deletedBy: string | null
  trashRootId: string | null
}

export type PrismaContent = {
  nodeId: string
  contentSchemaVersion: number
  yjsSchemaVersion: number
  contentJson: unknown
  yjsState: Uint8Array | null
  stateVector: Uint8Array | null
  docSizeBytes: number
  revision: number
  textPreview: string | null
  charCount: number
  updatedAt: Date
  storedAt: Date | null
}

export type PrismaAcl = {
  id: string
  nodeId: string
  subjectType: string
  subjectId: string
  role: string
  effect: string
  createdBy: string
  createdAt: Date
}

export type PrismaVersion = {
  id: string
  nodeId: string
  versionNo: number
  kind: string
  label: string | null
  contentSchemaVersion: number
  yjsSchemaVersion: number
  contentJson: unknown
  yjsState: Uint8Array | null
  createdBy: string | null
  createdAt: Date
}

export type PrismaAttachment = {
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

export type PrismaAudit = {
  id: number
  workspaceId: string
  actorId: string | null
  action: string
  targetType: string
  targetId: string | null
  metadata: unknown
  ip: string | null
  createdAt: Date
}

// ---------------------------------------------------------------- 转换函数

export function toUser(row: PrismaUser): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarKey: row.avatarKey,
    status: row.status as User['status'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
  }
}

export function toSession(row: PrismaSession) {
  return {
    id: row.id,
    userId: row.userId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
  }
}

export function toWorkspace(row: PrismaWorkspace): Workspace {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    defaultRole: row.defaultRole as Workspace['defaultRole'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}

export function toWorkspaceMember(row: PrismaWorkspaceMember): WorkspaceMember {
  return {
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: row.role as WorkspaceRole,
    createdAt: row.createdAt,
  }
}

export function toNode(row: PrismaNode): TreeNode {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    parentId: row.parentId,
    type: row.type as TreeNode['type'],
    title: row.title,
    titleNormalized: row.titleNorm,
    ownerId: row.ownerId,
    visibility: row.visibility as TreeNode['visibility'],
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
    trashRootId: row.trashRootId,
  }
}

export function toContent(row: PrismaContent): DocumentContent {
  return {
    nodeId: row.nodeId,
    contentSchemaVersion: row.contentSchemaVersion,
    yjsSchemaVersion: row.yjsSchemaVersion,
    contentJson: row.contentJson ?? null,
    yjsState: row.yjsState ?? null,
    stateVector: row.stateVector ?? null,
    docSizeBytes: row.docSizeBytes,
    revision: row.revision,
    textPreview: row.textPreview,
    charCount: row.charCount,
    updatedAt: row.updatedAt,
    storedAt: row.storedAt,
  }
}

export function toAcl(row: PrismaAcl): AclEntry {
  return {
    id: row.id,
    nodeId: row.nodeId,
    subjectType: row.subjectType as AclEntry['subjectType'],
    subjectId: row.subjectId,
    role: row.role,
    effect: row.effect as AclEntry['effect'],
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

export function toVersion(row: PrismaVersion): Version {
  return {
    id: row.id,
    nodeId: row.nodeId,
    versionNo: row.versionNo,
    kind: row.kind as Version['kind'],
    label: row.label,
    contentSchemaVersion: row.contentSchemaVersion,
    yjsSchemaVersion: row.yjsSchemaVersion,
    contentJson: row.contentJson,
    yjsState: row.yjsState ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

export function toAttachment(row: PrismaAttachment): Attachment {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    nodeId: row.nodeId,
    uploaderId: row.uploaderId,
    originalName: row.originalName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    storageKey: row.storageKey,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
  }
}

export function toAudit(row: PrismaAudit): AuditEvent {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    ip: row.ip,
    createdAt: row.createdAt,
  }
}

// ---------------------------------------------------------------- 工具

/** 邮箱归一化：小写去空白。emailLower 唯一索引靠它保证大小写不敏感唯一。 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** 标题归一化：小写去空白。仅用于检索。 */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase()
}

/**
 * 把 Uint8Array 窄化为 Prisma 的 Bytes 类型。
 *
 * Prisma 的 Bytes 是 `Uint8Array<ArrayBuffer>`（TS 5.7+ 之后 Uint8Array
 * 的泛型参数区分 ArrayBuffer 与 SharedArrayBuffer）。领域层用宽松的
 * `Uint8Array`，写入时需要一次显式窄化——内容完全相同，只是类型声明更严。
 *
 * 这个转换属于 Prisma 特有的实现细节，只允许出现在实现层。
 */
export function toBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(data) as Uint8Array<ArrayBuffer>
}
