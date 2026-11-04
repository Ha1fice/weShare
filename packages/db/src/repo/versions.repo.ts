/**
 * 版本快照仓储。
 *
 * 聚合边界：一个节点的版本序列。
 * 版本号的自增与保留策略裁剪必须一起看——"下一个版本号是多少"
 * 取决于"哪些版本还在"，拆开会导致竞态。
 */

import type { PrismaClient } from '../../generated/client/client.js'
import type { VersionsRepository } from './interfaces.js'
import type { Version } from './types.js'
import { toBytes, toVersion, type PrismaVersion } from './mapping.js'

export class VersionsRepositoryImpl implements VersionsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listForNode(nodeId: string): Promise<Version[]> {
    const rows = (await this.prisma.nodeVersion.findMany({
      where: { nodeId },
      orderBy: { versionNo: 'desc' },
    })) as PrismaVersion[]
    return rows.map(toVersion)
  }

  async findByNo(nodeId: string, versionNo: number): Promise<Version | null> {
    const row = (await this.prisma.nodeVersion.findUnique({
      where: { nodeId_versionNo: { nodeId, versionNo } },
    })) as PrismaVersion | null
    return row ? toVersion(row) : null
  }

  async create(input: {
    id: string
    nodeId: string
    kind: 'auto' | 'manual' | 'restore'
    label?: string | null
    contentJson: unknown
    yjsState?: Uint8Array | null
    createdBy?: string | null
  }): Promise<Version> {
    const versionNo = await this.nextVersionNo(input.nodeId)
    const row = (await this.prisma.nodeVersion.create({
      data: {
        id: input.id,
        nodeId: input.nodeId,
        versionNo,
        kind: input.kind,
        label: input.label ?? null,
        contentJson: input.contentJson as never,
        yjsState:
          input.yjsState === null || input.yjsState === undefined ? null : toBytes(input.yjsState),
        createdBy: input.createdBy ?? null,
        contentSchemaVersion: 1,
        yjsSchemaVersion: 1,
      },
    })) as PrismaVersion
    return toVersion(row)
  }

  async nextVersionNo(nodeId: string): Promise<number> {
    const latest = (await this.prisma.nodeVersion.findFirst({
      where: { nodeId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    })) as { versionNo: number } | null
    return (latest?.versionNo ?? 0) + 1
  }

  async pruneAutoVersions(input: {
    nodeId: string
    keepCount: number
    keepManual: boolean
  }): Promise<number> {
    const autos = (await this.prisma.nodeVersion.findMany({
      where: { nodeId: input.nodeId, kind: 'auto' },
      orderBy: { versionNo: 'desc' },
      select: { id: true, versionNo: true },
    })) as { id: string; versionNo: number }[]

    const toRemove = autos.slice(input.keepCount)
    if (toRemove.length === 0) return 0
    const result = await this.prisma.nodeVersion.deleteMany({
      where: { id: { in: toRemove.map((v) => v.id) } },
    })
    return result.count
  }
}
