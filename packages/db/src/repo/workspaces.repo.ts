/**
 * 空间与成员仓储。
 *
 * 聚合边界：一个空间 + 它的成员名单。
 */

import type { PrismaClient } from '../../generated/client/client.js'
import type { WorkspacesRepository } from './interfaces.js'
import type { Workspace, WorkspaceMember, WorkspaceRole } from './types.js'
import {
  toWorkspace,
  toWorkspaceMember,
  type PrismaWorkspace,
  type PrismaWorkspaceMember,
} from './mapping.js'

export class WorkspacesRepositoryImpl implements WorkspacesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Workspace | null> {
    const row = (await this.prisma.workspace.findUnique({ where: { id } })) as PrismaWorkspace | null
    return row ? toWorkspace(row) : null
  }

  async create(input: {
    id: string
    name: string
    ownerId: string
    defaultRole?: 'view' | 'comment' | 'edit'
  }): Promise<Workspace> {
    // 创建空间与添加 owner 成员必须原子——否则会出现"空间存在但无 owner"
    const [row] = await this.prisma.$transaction([
      this.prisma.workspace.create({
        data: {
          id: input.id,
          name: input.name,
          ownerId: input.ownerId,
          defaultRole: input.defaultRole ?? 'edit',
        },
      }),
      this.prisma.workspaceMember.create({
        data: { workspaceId: input.id, userId: input.ownerId, role: 'owner' },
      }),
    ])
    return toWorkspace(row as PrismaWorkspace)
  }

  async update(
    id: string,
    input: { name?: string; defaultRole?: Workspace['defaultRole'] },
  ): Promise<Workspace> {
    const row = (await this.prisma.workspace.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.defaultRole !== undefined ? { defaultRole: input.defaultRole } : {}),
      },
    })) as PrismaWorkspace
    return toWorkspace(row)
  }

  async listForUser(userId: string): Promise<Workspace[]> {
    const rows = (await this.prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      orderBy: { createdAt: 'asc' },
    })) as PrismaWorkspace[]
    return rows.map(toWorkspace)
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const rows = (await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
    })) as PrismaWorkspaceMember[]
    return rows.map(toWorkspaceMember)
  }

  async findMemberRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const row = (await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })) as { role: string } | null
    return row ? (row.role as WorkspaceRole) : null
  }

  async upsertMember(input: {
    workspaceId: string
    userId: string
    role: WorkspaceRole
  }): Promise<WorkspaceMember> {
    const row = (await this.prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: { workspaceId: input.workspaceId, userId: input.userId },
      },
      create: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: input.role,
      },
      update: { role: input.role },
    })) as PrismaWorkspaceMember
    return toWorkspaceMember(row)
  }

  async removeMember(workspaceId: string, userId: string): Promise<boolean> {
    const result = await this.prisma.workspaceMember.deleteMany({
      where: { workspaceId, userId },
    })
    return result.count > 0
  }
}
