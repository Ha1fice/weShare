/**
 * 节点授权仓储。
 *
 * 聚合边界：一个节点上的 ACL 规则集（含 allow/deny）。
 * allow 与 deny 必须放一起——判定时两者要一起比较，分成两个仓储
 * 会让"deny 优先"的规则无法在一次查询里完成。
 */

import type { PrismaClient } from '../../generated/client/client.js'
import type { AclRepository } from './interfaces.js'
import type { AclEntry, CreateAclInput } from './types.js'
import { toAcl, type PrismaAcl } from './mapping.js'

export class AclRepositoryImpl implements AclRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listForNode(nodeId: string): Promise<AclEntry[]> {
    const rows = (await this.prisma.nodeAcl.findMany({
      where: { nodeId },
      orderBy: { createdAt: 'asc' },
    })) as PrismaAcl[]
    return rows.map(toAcl)
  }

  async listForSubjects(
    nodeId: string,
    userId: string,
    workspaceId: string,
  ): Promise<AclEntry[]> {
    const rows = (await this.prisma.nodeAcl.findMany({
      where: {
        nodeId,
        OR: [
          { subjectType: 'user', subjectId: userId },
          { subjectType: 'workspace', subjectId: workspaceId },
        ],
      },
    })) as PrismaAcl[]
    return rows.map(toAcl)
  }

  async listForNodes(
    nodeIds: string[],
    userId: string,
    workspaceId: string,
  ): Promise<AclEntry[]> {
    if (nodeIds.length === 0) return []

    const rows = (await this.prisma.nodeAcl.findMany({
      where: {
        nodeId: { in: nodeIds },
        OR: [
          { subjectType: 'user', subjectId: userId },
          { subjectType: 'workspace', subjectId: workspaceId },
        ],
      },
    })) as PrismaAcl[]
    return rows.map(toAcl)
  }

  async upsert(input: CreateAclInput): Promise<AclEntry> {
    const row = (await this.prisma.nodeAcl.upsert({
      where: {
        nodeId_subjectType_subjectId: {
          nodeId: input.nodeId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
        },
      },
      create: {
        id: input.id,
        nodeId: input.nodeId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        role: input.role,
        effect: input.effect ?? 'allow',
        createdBy: input.createdBy,
      },
      update: {
        role: input.role,
        effect: input.effect ?? 'allow',
      },
    })) as PrismaAcl
    return toAcl(row)
  }

  async remove(nodeId: string, aclId: string): Promise<boolean> {
    const result = await this.prisma.nodeAcl.deleteMany({ where: { id: aclId, nodeId } })
    return result.count > 0
  }
}
