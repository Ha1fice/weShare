/**
 * 数据库唯一出口（架构文档 §10）。
 *
 * 业务代码（apps/* 与 packages/* 除本包外）只经此导入访问数据，
 * 不得直接引用 driver 或表定义——这是不变式 I7 的落地形式。
 */

export * from './driver.sqlite.js'
export * as schema from './schema/sqlite.js'
export type {
  Attachment,
  AuditEvent,
  DocumentContent,
  Node,
  NodeAcl,
  NodeVersion,
  NewNode,
  NewUser,
  Session,
  User,
  Workspace,
  WorkspaceMember,
} from './schema/sqlite.js'
