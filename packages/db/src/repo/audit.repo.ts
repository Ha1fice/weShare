/**
 * 审计仓储。
 *
 * 聚合边界：只写不改的审计流水。
 */

import type { PrismaClient } from '../../generated/client/client.js'
import type { AuditRepository } from './interfaces.js'
import type { AuditEvent, CreateAuditInput } from './types.js'
import { toAudit, type PrismaAudit } from './mapping.js'

export class AuditRepositoryImpl implements AuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateAuditInput): Promise<AuditEvent> {
    const row = (await this.prisma.auditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        // SQLite 下 Json 不能有数据库默认值，由应用层补（见 schema 注释）
        metadata: (input.metadata ?? {}) as never,
        ip: input.ip ?? null,
      },
    })) as PrismaAudit
    return toAudit(row)
  }

  async listForWorkspace(input: {
    workspaceId: string
    limit: number
    offset?: number
  }): Promise<AuditEvent[]> {
    const rows = (await this.prisma.auditEvent.findMany({
      where: { workspaceId: input.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      skip: input.offset ?? 0,
    })) as PrismaAudit[]
    return rows.map(toAudit)
  }
}
