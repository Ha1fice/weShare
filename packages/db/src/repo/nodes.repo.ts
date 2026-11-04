/**
 * 目录树节点仓储。
 *
 * 聚合边界：树结构本身 + 软删除/回收站语义。
 * 软删除与还原是同一个聚合的两面——`trashRootId` 把一次删除批次的
 * 全部节点绑在一起，所以它们必须在同一个仓储里。
 */

import type { PrismaClient } from '../../generated/client/client.js'
import type { NodesRepository } from './interfaces.js'
import type { CreateNodeInput, TreeNode, UpdateNodeInput } from './types.js'
import { normalizeTitle, toNode, type PrismaNode } from './mapping.js'

export class NodesRepositoryImpl implements NodesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<TreeNode | null> {
    const row = (await this.prisma.node.findUnique({ where: { id } })) as PrismaNode | null
    return row ? toNode(row) : null
  }

  async create(input: CreateNodeInput): Promise<TreeNode> {
    const row = (await this.prisma.node.create({
      data: {
        id: input.id,
        workspaceId: input.workspaceId,
        parentId: input.parentId ?? null,
        type: input.type,
        title: input.title,
        titleNorm: normalizeTitle(input.title),
        ownerId: input.ownerId,
        visibility: input.visibility ?? 'workspace',
        sortOrder: 0,
      },
    })) as PrismaNode
    return toNode(row)
  }

  async createDocument(input: CreateNodeInput & { contentJson: unknown }): Promise<TreeNode> {
    // 节点与正文必须一起成功——否则会留下"打不开的文档"
    const [row] = await this.prisma.$transaction([
      this.prisma.node.create({
        data: {
          id: input.id,
          workspaceId: input.workspaceId,
          parentId: input.parentId ?? null,
          type: input.type,
          title: input.title,
          titleNorm: normalizeTitle(input.title),
          ownerId: input.ownerId,
          visibility: input.visibility ?? 'workspace',
          sortOrder: 0,
        },
      }),
      this.prisma.documentContent.create({
        data: {
          nodeId: input.id,
          contentJson: input.contentJson as never,
          contentSchemaVersion: 1,
          yjsSchemaVersion: 1,
        },
      }),
    ])
    return toNode(row as PrismaNode)
  }

  async update(id: string, input: UpdateNodeInput): Promise<TreeNode> {
    const row = (await this.prisma.node.update({
      where: { id },
      data: {
        ...(input.title !== undefined
          ? { title: input.title, titleNorm: normalizeTitle(input.title) }
          : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.deletedAt !== undefined ? { deletedAt: input.deletedAt } : {}),
        ...(input.deletedBy !== undefined ? { deletedBy: input.deletedBy } : {}),
        ...(input.trashRootId !== undefined ? { trashRootId: input.trashRootId } : {}),
      },
    })) as PrismaNode
    return toNode(row)
  }

  async softDelete(input: {
    id: string
    deletedAt: Date
    deletedBy: string
    trashRootId: string
  }): Promise<number> {
    // 子树批量标记，trashRootId 统一，便于整批还原
    const ids = await this.collectSubtreeIds(input.id)
    const result = await this.prisma.node.updateMany({
      where: { id: { in: ids } },
      data: {
        deletedAt: input.deletedAt,
        deletedBy: input.deletedBy,
        trashRootId: input.trashRootId,
      },
    })
    return result.count
  }

  async restore(input: { trashRootId: string; restoredAt: Date }): Promise<number> {
    const result = await this.prisma.node.updateMany({
      where: { trashRootId: input.trashRootId },
      data: { deletedAt: null, deletedBy: null, trashRootId: null },
    })
    return result.count
  }

  async purge(id: string): Promise<boolean> {
    const result = await this.prisma.node.deleteMany({ where: { id } })
    return result.count > 0
  }

  async listTree(workspaceId: string): Promise<TreeNode[]> {
    const rows = (await this.prisma.node.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }],
    })) as PrismaNode[]
    return rows.map(toNode)
  }

  async listTrash(workspaceId: string): Promise<TreeNode[]> {
    const rows = (await this.prisma.node.findMany({
      where: { workspaceId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    })) as PrismaNode[]
    return rows.map(toNode)
  }

  async listAncestors(id: string): Promise<TreeNode[]> {
    // 逐级向上，直到根。深度上限 8（架构文档 §7.3），不会无限循环。
    const ancestors: TreeNode[] = []
    let current = await this.findById(id)
    while (current?.parentId) {
      const parent = await this.findById(current.parentId)
      if (!parent) break
      ancestors.unshift(parent)
      current = parent
      if (ancestors.length > 16) break
    }
    return ancestors
  }

  async listChildIds(id: string): Promise<string[]> {
    const rows = (await this.prisma.node.findMany({
      where: { parentId: id },
      select: { id: true },
    })) as { id: string }[]
    return rows.map((r) => r.id)
  }

  async searchByTitle(workspaceId: string, keyword: string): Promise<TreeNode[]> {
    const rows = (await this.prisma.node.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        titleNorm: { startsWith: normalizeTitle(keyword) },
      },
      orderBy: { updatedAt: 'desc' },
    })) as PrismaNode[]
    return rows.map(toNode)
  }

  /** 收集子树所有 id（含自身）。 */
  private async collectSubtreeIds(rootId: string): Promise<string[]> {
    const ids: string[] = [rootId]
    let frontier = [rootId]
    while (frontier.length > 0) {
      const children = await this.prisma.node.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      })
      const next = (children as { id: string }[]).map((c) => c.id)
      if (next.length === 0) break
      ids.push(...next)
      frontier = next
    }
    return ids
  }
}
