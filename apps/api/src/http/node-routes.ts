/**
 * 节点路由（架构文档附录 A）。
 *
 *   GET    /api/v1/workspaces/:id/tree            目录树
 *   GET    /api/v1/workspaces/:id/nodes           列表（搜索）
 *   GET    /api/v1/workspaces/:id/trash           回收站
 *   POST   /api/v1/nodes                          创建
 *   GET    /api/v1/nodes/:id                      详情 + 我的角色
 *   GET    /api/v1/nodes/:id/breadcrumb           面包屑
 *   PATCH  /api/v1/nodes/:id                      改名 / 移动 / 可见性
 *   DELETE /api/v1/nodes/:id                      删除进回收站
 *   POST   /api/v1/nodes/:id/restore              还原
 *   DELETE /api/v1/nodes/:id/purge                彻底删除
 *
 * 权限判定全在 NodeService——本文件只做 HTTP 适配（与空间路由同构）。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  CreateNodeBodySchema,
  UpdateNodeBodySchema,
  type BreadcrumbItem,
  type NodeView,
} from '@weshare/shared'
import type { Repositories, TreeNode } from '@weshare/db'
import type { Role } from '@weshare/shared'
import { validationFailed } from '../http/errors.js'
import { requireUser } from './auth-routes.js'
import type { SessionService } from '../domain/session-service.js'
import type { NodeService } from '../domain/node-service.js'

export interface NodeRouteOptions {
  repos: Repositories
  nodes: NodeService
  sessions: SessionService
  secureCookie: boolean
}

/** 领域节点 → API 视图。 */
function toNodeView(node: TreeNode, role?: Role | null): NodeView {
  return {
    id: node.id,
    workspaceId: node.workspaceId,
    parentId: node.parentId,
    type: node.type,
    title: node.title,
    ownerId: node.ownerId,
    visibility: node.visibility,
    sortOrder: node.sortOrder,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    deletedAt: node.deletedAt ? node.deletedAt.toISOString() : null,
    ...(role !== undefined ? { role } : {}),
  }
}

/** 注册节点路由。 */
export function registerNodeRoutes(app: FastifyInstance, options: NodeRouteOptions): void {
  const { repos, nodes, sessions } = options

  const currentUser = (req: FastifyRequest) =>
    requireUser(req, { repos, sessions, secureCookie: options.secureCookie })

  // ------------------------------------------------------------ 目录树
  app.get('/api/v1/workspaces/:id/tree', async (req) => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }

    const list = await nodes.listTree(id, user.id)

    return {
      nodes: list.map((n) => ({
        ...toNodeView(n, n.role),
        hasChildren: n.hasChildren,
      })),
    }
  })

  // ------------------------------------------------------------ 列表 / 搜索
  app.get('/api/v1/workspaces/:id/nodes', async (req) => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }
    const { q } = req.query as { q?: string }

    // MVP 的列表就是"搜索"——不传 q 时返回全部可读节点
    const list = await nodes.search(id, user.id, q ?? '')

    return { nodes: list.map((n) => toNodeView(n, n.role)) }
  })

  // ------------------------------------------------------------ 回收站
  app.get('/api/v1/workspaces/:id/trash', async (req) => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }

    const list = await nodes.listTrash(id, user.id)

    return { nodes: list.map((n) => toNodeView(n, n.role)) }
  })

  // ------------------------------------------------------------ 创建
  app.post('/api/v1/nodes', async (req, reply) => {
    const user = await currentUser(req)

    const parsed = CreateNodeBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw validationFailed(parsed.error.issues[0]?.message ?? '请求参数不合法')
    }

    const result = await nodes.createNode(user.id, {
      workspaceId: parsed.data.workspaceId,
      parentId: parsed.data.parentId ?? null,
      type: parsed.data.type,
      title: parsed.data.title,
      ...(parsed.data.visibility ? { visibility: parsed.data.visibility } : {}),
    })

    reply.status(201).send({ node: toNodeView(result.node, result.role) })
  })

  // ------------------------------------------------------------ 详情
  app.get('/api/v1/nodes/:id', async (req) => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }

    const { node, role } = await nodes.getNode(id, user.id)
    return { node: toNodeView(node, role) }
  })

  // ------------------------------------------------------------ 面包屑
  app.get('/api/v1/nodes/:id/breadcrumb', async (req) => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }

    const items = await nodes.breadcrumb(id, user.id)
    return { items: items satisfies BreadcrumbItem[] }
  })

  // ------------------------------------------------------------ 修改（改名 / 移动 / 可见性）
  app.patch('/api/v1/nodes/:id', async (req) => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }

    const parsed = UpdateNodeBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw validationFailed(parsed.error.issues[0]?.message ?? '请求参数不合法')
    }

    // parentId 的修改走移动（有额外的目标父级权限与循环校验）
    if (parsed.data.parentId !== undefined) {
      const moved = await nodes.moveNode(user.id, id, parsed.data.parentId)
      // 移动与改名可能同时发生：先移动再改名
      if (parsed.data.title !== undefined || parsed.data.visibility !== undefined) {
        const updated = await nodes.updateNode(user.id, id, {
          ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
          ...(parsed.data.visibility !== undefined ? { visibility: parsed.data.visibility } : {}),
        })
        return { node: toNodeView(updated.node, updated.role) }
      }
      return { node: toNodeView(moved.node, moved.role) }
    }

    const result = await nodes.updateNode(user.id, id, {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.visibility !== undefined ? { visibility: parsed.data.visibility } : {}),
    })

    return { node: toNodeView(result.node, result.role) }
  })

  // ------------------------------------------------------------ 删除（进回收站）
  app.delete('/api/v1/nodes/:id', async (req) => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }

    const result = await nodes.softDelete(user.id, id)
    return { ok: true, affected: result.affected }
  })

  // ------------------------------------------------------------ 还原
  app.post('/api/v1/nodes/:id/restore', async (req) => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }

    const result = await nodes.restore(user.id, id)
    return { ok: true, affected: result.affected }
  })

  // ------------------------------------------------------------ 彻底删除
  app.delete('/api/v1/nodes/:id/purge', async (req) => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }

    const result = await nodes.purge(user.id, id)
    return result
  })
}
