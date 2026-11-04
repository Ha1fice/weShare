/**
 * 空间与成员路由（架构文档附录 A）。
 *
 *   GET    /api/v1/workspaces              我的空间
 *   POST   /api/v1/workspaces              创建空间
 *   GET    /api/v1/workspaces/:id          空间详情
 *   PATCH  /api/v1/workspaces/:id          改名与默认角色（仅 owner）
 *   GET    /api/v1/workspaces/:id/members  成员列表
 *   POST   /api/v1/workspaces/:id/members  添加成员（owner/admin）
 *   PATCH  /api/v1/workspaces/:id/members/:userId  改角色（owner/admin）
 *   DELETE /api/v1/workspaces/:id/members/:userId  移除成员（owner/admin）
 *
 * 权限判定的**唯一实现在 WorkspaceService**——本文件只做 HTTP 适配。
 * 这样"谁能做什么"只有一处定义，不会出现路由与领域服务不一致
 * （架构文档 §8.4 反面清单的第一条）。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  AddMemberBodySchema,
  CreateWorkspaceBodySchema,
  UpdateMemberBodySchema,
  UpdateWorkspaceBodySchema,
  type WorkspaceMemberView,
  type WorkspaceView,
} from '@weshare/shared'
import type { Repositories } from '@weshare/db'
import { validationFailed } from '../http/errors.js'
import { requireUser } from './auth-routes.js'
import { WorkspaceService } from '../domain/workspace-service.js'
import type { SessionService } from '../domain/session-service.js'

export interface WorkspaceRouteOptions {
  repos: Repositories
  workspaces: WorkspaceService
  /** 会话服务——解析当前用户时需要（与认证路由同一份实现）。 */
  sessions: SessionService
  secureCookie: boolean
}

/** 空间 → API 视图。 */
function toWorkspaceView(
  ws: {
    id: string
    name: string
    ownerId: string
    defaultRole: 'view' | 'comment' | 'edit'
    createdAt: Date
    updatedAt: Date
  },
  role: WorkspaceView['role'],
): WorkspaceView {
  return {
    id: ws.id,
    name: ws.name,
    ownerId: ws.ownerId,
    defaultRole: ws.defaultRole,
    role,
    createdAt: ws.createdAt.toISOString(),
    updatedAt: ws.updatedAt.toISOString(),
  }
}

/** 注册空间与成员路由。 */
export function registerWorkspaceRoutes(
  app: FastifyInstance,
  options: WorkspaceRouteOptions,
): void {
  const { repos, workspaces, sessions } = options

  /** 取当前用户。复用认证路由的会话解析——不重复实现。 */
  const currentUser = (req: FastifyRequest) =>
    requireUser(req, { repos, sessions, secureCookie: options.secureCookie })

  // ------------------------------------------------------------ 我的空间
  app.get('/api/v1/workspaces', async (req) => {
    const user = await currentUser(req)

    const list = await repos.workspaces.listForUser(user.id)
    const views = await Promise.all(
      list.map(async (ws) => {
        const role = (await repos.workspaces.findMemberRole(ws.id, user.id)) ?? 'viewer'
        return toWorkspaceView(ws, role)
      }),
    )

    return { workspaces: views }
  })

  // ------------------------------------------------------------ 创建空间
  app.post('/api/v1/workspaces', async (req, reply) => {
    const user = await currentUser(req)

    const parsed = CreateWorkspaceBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw validationFailed(parsed.error.issues[0]?.message ?? '请求参数不合法')
    }

    const ws = await workspaces.create(user.id, parsed.data)

    reply.status(201).send({ workspace: toWorkspaceView(ws, 'owner') })
  })

  // ------------------------------------------------------------ 空间详情
  app.get('/api/v1/workspaces/:id', async (req) => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }

    const role = await workspaces.requireMembership(id, user.id)
    const ws = await repos.workspaces.findById(id)

    return { workspace: toWorkspaceView(ws!, role) }
  })

  // ------------------------------------------------------------ 修改空间设置
  app.patch('/api/v1/workspaces/:id', async (req) => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }

    const parsed = UpdateWorkspaceBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw validationFailed(parsed.error.issues[0]?.message ?? '请求参数不合法')
    }

    await workspaces.updateSettings(id, user.id, parsed.data)

    const ws = await repos.workspaces.findById(id)
    const role = await repos.workspaces.findMemberRole(id, user.id)

    return { workspace: toWorkspaceView(ws!, role ?? 'viewer') }
  })

  // ------------------------------------------------------------ 成员列表
  app.get('/api/v1/workspaces/:id/members', async (req) => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }

    await workspaces.requireMembership(id, user.id)

    const members = await repos.workspaces.listMembers(id)

    // 附上用户信息（邮箱、显示名）——前端要显示成员名单
    const views: WorkspaceMemberView[] = await Promise.all(
      members.map(async (m) => {
        const u = await repos.users.findById(m.userId)
        return {
          userId: m.userId,
          email: u?.email ?? '',
          displayName: u?.displayName ?? '（用户已不存在）',
          role: m.role,
          createdAt: m.createdAt.toISOString(),
        }
      }),
    )

    return { members: views }
  })

  // ------------------------------------------------------------ 添加成员
  app.post('/api/v1/workspaces/:id/members', async (req, reply) => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }

    const parsed = AddMemberBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw validationFailed(parsed.error.issues[0]?.message ?? '请求参数不合法')
    }

    const result = await workspaces.addMemberByEmail(id, user.id, parsed.data)

    reply.status(201).send({ member: result })
  })

  // ------------------------------------------------------------ 改成员角色
  app.patch('/api/v1/workspaces/:id/members/:userId', async (req) => {
    const user = await currentUser(req)
    const { id, userId: targetUserId } = req.params as { id: string; userId: string }

    const parsed = UpdateMemberBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw validationFailed(parsed.error.issues[0]?.message ?? '请求参数不合法')
    }

    await workspaces.updateMemberRole(id, user.id, targetUserId, parsed.data.role)

    return { member: { userId: targetUserId, role: parsed.data.role } }
  })

  // ------------------------------------------------------------ 移除成员
  app.delete('/api/v1/workspaces/:id/members/:userId', async (req) => {
    const user = await currentUser(req)
    const { id, userId: targetUserId } = req.params as { id: string; userId: string }

    await workspaces.removeMember(id, user.id, targetUserId)

    return { ok: true }
  })
}
