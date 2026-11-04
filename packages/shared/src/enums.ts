/**
 * 领域枚举。
 *
 * 独立成模块，而不是放在 index.ts——`node-contract.ts`、`workspace-contract.ts`
 * 都要用它们，若从 index.ts 导入就形成循环依赖（ESM 下拿到 undefined）。
 *
 * 与 roles.ts 的分工：roles.ts 放**权限相关**的枚举与函数（含 max/min 比较），
 * 这里放**业务对象**的枚举（节点类型、可见性、ACL 主体等）。
 */

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

/** 版本类型。 */
export const VERSION_KINDS = ['auto', 'manual', 'restore'] as const
export type VersionKind = (typeof VERSION_KINDS)[number]

/** 用户账号状态。 */
export const USER_STATUSES = ['active', 'disabled'] as const
export type UserStatus = (typeof USER_STATUSES)[number]
