/**
 * 角色枚举。
 *
 * 独立成模块，而不是放在 index.ts——`workspace-contract.ts` 要用它，
 * 若两者互相导入就形成循环依赖（ESM 下会拿到 undefined）。
 *
 * 这个模块是**角色定义的唯一真源**：shared 的契约、packages/db 的领域类型、
 * 前端的类型判断都从这里取。
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

/**
 * 可通过接口指派的成员角色。
 *
 * **不含 `owner`**：空间创建者由服务端确定，不能通过接口把某人设为 owner
 * （否则任何 admin 都能"造"一个 owner，绕过 owner 的独占权限）。
 * 转移所有权是独立操作，不在 MVP 范围。
 */
export const ASSIGNABLE_WORKSPACE_ROLES = ['admin', 'member', 'viewer'] as const
export type AssignableWorkspaceRole = (typeof ASSIGNABLE_WORKSPACE_ROLES)[number]

/** 角色是否达到所需的空间管理能力。owner/admin 可管理成员。 */
export function canManageMembers(role: WorkspaceRole | null): boolean {
  return role === 'owner' || role === 'admin'
}

/** 角色是否可修改空间设置（改名、默认角色）。仅 owner。 */
export function canManageWorkspaceSettings(role: WorkspaceRole | null): boolean {
  return role === 'owner'
}
