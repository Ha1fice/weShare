/**
 * 空间与成员的 API 契约（zod）。
 *
 * 放在 shared 包：前端与后端用同一份校验规则，避免"前端放行、后端拒绝"。
 */

import { z } from 'zod'
import { ASSIGNABLE_WORKSPACE_ROLES, type WorkspaceRole } from './roles.js'

/** 空间名。 */
export const WorkspaceNameSchema = z
  .string()
  .trim()
  .min(1, '空间名不能为空')
  .max(64, '空间名不能超过 64 个字符')

/** 空间默认角色（空间内可见节点的默认权限）。 */
export const WorkspaceDefaultRoleSchema = z.enum(['view', 'comment', 'edit'])

/**
 * 成员角色。
 *
 * **不含 `owner`**——空间创建者由服务端确定，不能通过接口把某人设为 owner
 * （否则任何 admin 都能"造"一个 owner，绕过 owner 的独占权限）。
 * 需要转移所有权是独立操作，不在 MVP 范围。
 */
export const AssignableMemberRoleSchema = z.enum(ASSIGNABLE_WORKSPACE_ROLES)

/** 创建空间请求体。 */
export const CreateWorkspaceBodySchema = z.object({
  name: WorkspaceNameSchema,
  defaultRole: WorkspaceDefaultRoleSchema.optional(),
})
export type CreateWorkspaceBody = z.infer<typeof CreateWorkspaceBodySchema>

/** 修改空间请求体。 */
export const UpdateWorkspaceBodySchema = z
  .object({
    name: WorkspaceNameSchema.optional(),
    defaultRole: WorkspaceDefaultRoleSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.defaultRole !== undefined, {
    message: '至少要修改一项',
  })
export type UpdateWorkspaceBody = z.infer<typeof UpdateWorkspaceBodySchema>

/** 添加成员请求体。 */
export const AddMemberBodySchema = z.object({
  email: z.string().trim().min(3).max(254).email('邮箱格式不正确'),
  role: AssignableMemberRoleSchema.default('member'),
})
export type AddMemberBody = z.infer<typeof AddMemberBodySchema>

/** 修改成员角色请求体。 */
export const UpdateMemberBodySchema = z.object({
  role: AssignableMemberRoleSchema,
})
export type UpdateMemberBody = z.infer<typeof UpdateMemberBodySchema>

/** 空间视图（API 返回）。 */
export interface WorkspaceView {
  id: string
  name: string
  ownerId: string
  defaultRole: 'view' | 'comment' | 'edit'
  /** 当前用户在此空间中的角色。 */
  role: WorkspaceRole
  createdAt: string
  updatedAt: string
}

/** 成员视图。 */
export interface WorkspaceMemberView {
  userId: string
  email: string
  displayName: string
  role: WorkspaceRole
  createdAt: string
}
