/**
 * 节点（目录树 / 文档）的 API 契约。
 *
 * 与认证、空间契约同理放在 shared：前后端用同一份校验规则。
 */

import { z } from 'zod'
import { NODE_TYPES, VISIBILITIES } from './enums.js'
import type { Role } from './roles.js'

/** 可创建的节点类型。MVP 不含 sheet（Phase 5）。 */
export const CreatableNodeTypeSchema = z.enum(['folder', 'doc'])

/**
 * 节点标题（基础规则）。
 *
 * **不带 default**——默认值只在创建时用（新建文档可以没名字），
 * 更新时"未传"必须真的表示"不改"。若把 default 写进基础 schema，
 * PATCH 空 body 会被当成"把标题改成空字符串"，绕过"至少改一项"的校验。
 */
export const NodeTitleSchema = z.string().trim().max(200, '标题不能超过 200 个字符')

/** 创建节点请求体。 */
export const CreateNodeBodySchema = z.object({
  workspaceId: z.string().min(1),
  parentId: z.string().min(1).nullable().optional(),
  type: CreatableNodeTypeSchema,
  // 允许空标题（新建文档时用户可能还没命名），由前端显示"未命名"
  title: NodeTitleSchema.default(''),
  visibility: z.enum(VISIBILITIES).optional(),
})
export type CreateNodeBody = z.infer<typeof CreateNodeBodySchema>

/**
 * 修改节点请求体。
 *
 * 只允许改这三项。`deletedAt` / `deletedBy` / `trashRootId` 不通过 PATCH 改——
 * 删除走 DELETE、还原走 POST /restore，避免"改个字段就把节点从回收站捞出来"
 * 这类绕过权限校验的路径。
 */
export const UpdateNodeBodySchema = z
  .object({
    title: NodeTitleSchema.optional(),
    parentId: z.string().min(1).nullable().optional(),
    visibility: z.enum(VISIBILITIES).optional(),
  })
  .refine((v) => v.title !== undefined || v.parentId !== undefined || v.visibility !== undefined, {
    message: '至少要修改一项',
  })
export type UpdateNodeBody = z.infer<typeof UpdateNodeBodySchema>

/** 节点视图（API 返回）。 */
export interface NodeView {
  id: string
  workspaceId: string
  parentId: string | null
  type: (typeof NODE_TYPES)[number]
  title: string
  ownerId: string
  visibility: 'private' | 'workspace'
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  /** 当前用户对该节点的有效角色。列表里不返回（省体积），详情里返回。 */
  role?: Role | null
}

/** 树节点的视图：带上自己的可读子节点。 */
export interface TreeNodeView extends NodeView {
  /** 是否还有子节点（前端用来决定是否显示展开箭头）。 */
  hasChildren: boolean
}

/** 面包屑单项。 */
export interface BreadcrumbItem {
  id: string
  title: string
}
