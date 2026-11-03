/**
 * 表结构定义（架构文档 §7.2）。
 *
 * 唯一真源。禁止手写 DDL（不变式 I7 + Phase 1 验收第 8 条）——
 * 表结构只来自 drizzle-kit 生成的迁移。
 *
 * 类型映射见架构文档 §7.2 的类型映射表：
 * 主键/外键 = text（应用层 crypto.randomUUID）、时间戳 = integer(ms)、
 * JSON = text(mode:json)、二进制 = blob、枚举 = text。
 */

import { sql } from 'drizzle-orm'
import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core'

/** 主键：应用层生成的 UUID v4 字符串。 */
const id = () => text('id').primaryKey()

/** UTC 毫秒时间戳。 */
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' })
const createdAt = () =>
  timestamp('created_at')
    .notNull()
    .$defaultFn(() => new Date())
const updatedAt = () =>
  timestamp('updated_at')
    .notNull()
    .$defaultFn(() => new Date())

// ---------------------------------------------------------------- 用户与会话

export const users = sqliteTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    avatarKey: text('avatar_key'),
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastLoginAt: timestamp('last_login_at'),
  },
  (t) => [
    // 大小写不敏感的唯一邮箱
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
  ],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 只存 sha256，明文 token 不落库
    tokenHash: blob('token_hash').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at')
      .notNull()
      .$defaultFn(() => new Date()),
    userAgent: text('user_agent'),
    ip: text('ip'),
    revokedAt: timestamp('revoked_at'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId, t.expiresAt),
  ],
)

// ---------------------------------------------------------------- 空间与成员

export const workspaces = sqliteTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id),
  defaultRole: text('default_role', { enum: ['view', 'comment', 'edit'] })
    .notNull()
    .default('edit'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp('deleted_at'),
})

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member', 'viewer'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('workspace_members_user_idx').on(t.userId),
  ],
)

// ---------------------------------------------------------------- 目录树与元数据

export const nodes = sqliteTable(
  'nodes',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // 自引用 + 级联：彻底删除父节点时子节点一并删除（架构文档 §7.2 变更 2）
    parentId: text('parent_id').references((): AnySQLiteColumn => nodes.id, {
      onDelete: 'cascade',
    }),
    type: text('type', { enum: ['folder', 'doc', 'sheet'] }).notNull(),
    title: text('title').notNull().default(''),
    // 小写去空白标题，仅用于检索（SQLite 无 trigram，前缀匹配）
    titleNorm: text('title_norm').notNull().default(''),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    visibility: text('visibility', { enum: ['private', 'workspace'] })
      .notNull()
      .default('workspace'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at'),
    deletedBy: text('deleted_by').references(() => users.id),
    // 一次删除批次的根，便于整批还原
    trashRootId: text('trash_root_id').references((): AnySQLiteColumn => nodes.id),
  },
  (t) => [
    index('nodes_tree_idx').on(t.workspaceId, t.parentId, t.deletedAt, t.sortOrder),
    index('nodes_trash_idx')
      .on(t.workspaceId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
    index('nodes_title_norm_idx').on(t.titleNorm),
  ],
)

// ---------------------------------------------------------------- 正文

export const documentContents = sqliteTable('document_contents', {
  nodeId: text('node_id')
    .primaryKey()
    .references(() => nodes.id, { onDelete: 'cascade' }),
  // 两条独立的版本线（架构文档 §5.5）
  contentSchemaVersion: integer('content_schema_version').notNull().default(1),
  yjsSchemaVersion: integer('yjs_schema_version').notNull().default(1),
  // 只读镜像，新建时为初始空文档
  contentJson: text('content_json', { mode: 'json' }),
  // 协同事实源（Uint8Array）
  yjsState: blob('yjs_state'),
  stateVector: blob('state_vector'),
  docSizeBytes: integer('doc_size_bytes').notNull().default(0),
  // 单机保存模式乐观锁
  revision: integer('revision').notNull().default(0),
  textPreview: text('text_preview'),
  charCount: integer('char_count').notNull().default(0),
  updatedBy: text('updated_by').references(() => users.id),
  updatedAt: updatedAt(),
  storedAt: timestamp('stored_at'),
})

// ---------------------------------------------------------------- 显式授权

export const nodeAcl = sqliteTable(
  'node_acl',
  {
    id: id(),
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type', { enum: ['user', 'workspace'] }).notNull(),
    // subjectType=workspace 时为 workspace_id（全员）
    subjectId: text('subject_id').notNull(),
    role: text('role', { enum: ['view', 'comment', 'edit', 'manage'] }).notNull(),
    // allow=授予，deny=降权。deny 优先于 allow（架构文档 §7.2 变更 1）
    effect: text('effect', { enum: ['allow', 'deny'] })
      .notNull()
      .default('allow'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('node_acl_subject_uq').on(t.nodeId, t.subjectType, t.subjectId),
    index('node_acl_subject_idx').on(t.subjectType, t.subjectId),
  ],
)

// ---------------------------------------------------------------- 版本快照

export const nodeVersions = sqliteTable(
  'node_versions',
  {
    id: id(),
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    kind: text('kind', { enum: ['auto', 'manual', 'restore'] }).notNull(),
    label: text('label'),
    contentSchemaVersion: integer('content_schema_version').notNull().default(1),
    yjsSchemaVersion: integer('yjs_schema_version').notNull().default(1),
    contentJson: text('content_json', { mode: 'json' }).notNull(),
    yjsState: blob('yjs_state'),
    createdBy: text('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('node_versions_node_no_uq').on(t.nodeId, t.versionNo),
    index('node_versions_node_idx').on(t.nodeId, t.versionNo),
  ],
)

// ---------------------------------------------------------------- 附件

export const attachments = sqliteTable(
  'attachments',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // 文档删除后附件保留待清理
    nodeId: text('node_id').references(() => nodes.id, { onDelete: 'set null' }),
    uploaderId: text('uploader_id')
      .notNull()
      .references(() => users.id),
    originalName: text('original_name').notNull(),
    // 服务端嗅探结果，不取客户端声明
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    width: integer('width'),
    height: integer('height'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('attachments_storage_key_uq').on(t.storageKey),
    index('attachments_node_idx').on(t.nodeId),
  ],
)

// ---------------------------------------------------------------- 审计

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    workspaceId: text('workspace_id').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    metadata: text('metadata', { mode: 'json' }).notNull().default({}),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_events_ws_time_idx').on(t.workspaceId, t.createdAt)],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Session = typeof sessions.$inferSelect
export type Workspace = typeof workspaces.$inferSelect
export type WorkspaceMember = typeof workspaceMembers.$inferSelect
export type Node = typeof nodes.$inferSelect
export type NewNode = typeof nodes.$inferInsert
export type DocumentContent = typeof documentContents.$inferSelect
export type NodeAcl = typeof nodeAcl.$inferSelect
export type NodeVersion = typeof nodeVersions.$inferSelect
export type Attachment = typeof attachments.$inferSelect
export type AuditEvent = typeof auditEvents.$inferSelect
