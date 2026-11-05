/**
 * 文档正文仓储。
 *
 * 聚合边界：内容镜像 + 协同事实源 + 版本号。
 * 三者在同一个聚合里，因为它们的生命周期完全一致——一次写入同时更新
 * content_json / yjs_state / revision，分开存放会让"哪份是新的"变得含糊。
 */

import type { PrismaClient } from '../../generated/client/client.js'
import type { DocumentContentUncheckedUpdateInput as PrismaDocumentContentUncheckedUpdateInput } from '../../generated/client/models/DocumentContent.js'
import type { ContentsRepository, DocumentSummary } from './interfaces.js'
import type { DocumentContent, SaveContentInput } from './types.js'
import { toBytes, toContent, type PrismaContent } from './mapping.js'

export class ContentsRepositoryImpl implements ContentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByNodeId(nodeId: string): Promise<DocumentContent | null> {
    const row = (await this.prisma.documentContent.findUnique({
      where: { nodeId },
    })) as PrismaContent | null
    return row ? toContent(row) : null
  }

  async create(input: { nodeId: string; contentJson: unknown }): Promise<DocumentContent> {
    const row = (await this.prisma.documentContent.create({
      data: {
        nodeId: input.nodeId,
        contentJson: input.contentJson as never,
        contentSchemaVersion: 1,
        yjsSchemaVersion: 1,
      },
    })) as PrismaContent
    return toContent(row)
  }

  async save(input: SaveContentInput & { expectedRevision?: number }): Promise<DocumentContent> {
    // 乐观锁：期望版本不匹配时抛错，由上层转 409（架构文档 §9.1）
    if (input.expectedRevision !== undefined) {
      const current = await this.findByNodeId(input.nodeId)
      if (!current) throw new Error(`正文不存在：${input.nodeId}`)
      if (current.revision !== input.expectedRevision) {
        throw new Error(`版本冲突：期望 ${input.expectedRevision}，实际 ${current.revision}`)
      }
    }
    const row = (await this.prisma.documentContent.update({
      where: { nodeId: input.nodeId },
      data: {
        ...(input.contentJson !== undefined ? { contentJson: input.contentJson as never } : {}),
        ...(input.yjsState !== undefined
          ? { yjsState: input.yjsState === null ? null : toBytes(input.yjsState) }
          : {}),
        ...(input.stateVector !== undefined
          ? { stateVector: input.stateVector === null ? null : toBytes(input.stateVector) }
          : {}),
        ...(input.textPreview !== undefined ? { textPreview: input.textPreview } : {}),
        ...(input.charCount !== undefined ? { charCount: input.charCount } : {}),
        ...(input.docSizeBytes !== undefined ? { docSizeBytes: input.docSizeBytes } : {}),
        ...(input.updatedBy !== undefined ? { updatedBy: input.updatedBy } : {}),
        revision: { increment: 1 },
      },
    })) as PrismaContent
    return toContent(row)
  }

  async listSummaries(nodeIds: string[]): Promise<DocumentSummary[]> {
    if (nodeIds.length === 0) return []
    const rows = await this.prisma.documentContent.findMany({
      where: { nodeId: { in: nodeIds } },
      select: { nodeId: true, textPreview: true, charCount: true, revision: true },
    })
    return rows.map((r) => ({
      nodeId: r.nodeId,
      textPreview: r.textPreview ?? null,
      charCount: r.charCount,
      revision: r.revision,
    }))
  }

  /**
   * 协同落库。
   *
   * 带一个**条件**：只有 `yjsState` 仍为 NULL 时才写。
   * 这是 Phase 2→3 迁移桥的跨进程安全网（架构文档 §13 R16）：
   * 两个进程同时首次打开同一文档时，谁先写谁赢，后到的那个 updateMany
   * 影响 0 行，调用方据此知道"别人先迁移了"，应丢弃自己的迁移结果。
   */
  async claimCollaborative(input: SaveContentInput): Promise<boolean> {
    // 显式标注为 Unchecked 变体：updatedBy 是可空的外键，
    // 交给 TS 推断会在 checked/unchecked 之间产生歧义。
    const data: PrismaDocumentContentUncheckedUpdateInput = {
      ...(input.contentJson !== undefined ? { contentJson: input.contentJson as never } : {}),
      ...(input.yjsState !== undefined
        ? { yjsState: input.yjsState === null ? null : toBytes(input.yjsState) }
        : {}),
      ...(input.stateVector !== undefined
        ? { stateVector: input.stateVector === null ? null : toBytes(input.stateVector) }
        : {}),
      ...(input.textPreview !== undefined ? { textPreview: input.textPreview } : {}),
      ...(input.charCount !== undefined ? { charCount: input.charCount } : {}),
      ...(input.docSizeBytes !== undefined ? { docSizeBytes: input.docSizeBytes } : {}),
      ...(input.updatedBy !== undefined ? { updatedBy: input.updatedBy } : {}),
      storedAt: new Date(),
    }
    const result = await this.prisma.documentContent.updateMany({
      where: { nodeId: input.nodeId, yjsState: null },
      data,
    })
    return result.count > 0
  }

  async saveCollaborative(input: SaveContentInput): Promise<DocumentContent> {
    // 显式标注为 Unchecked 变体：updatedBy 是可空的外键，
    // 交给 TS 推断会在 checked/unchecked 之间产生歧义。
    const data: PrismaDocumentContentUncheckedUpdateInput = {
      ...(input.contentJson !== undefined ? { contentJson: input.contentJson as never } : {}),
      ...(input.yjsState !== undefined
        ? { yjsState: input.yjsState === null ? null : toBytes(input.yjsState) }
        : {}),
      ...(input.stateVector !== undefined
        ? { stateVector: input.stateVector === null ? null : toBytes(input.stateVector) }
        : {}),
      ...(input.textPreview !== undefined ? { textPreview: input.textPreview } : {}),
      ...(input.charCount !== undefined ? { charCount: input.charCount } : {}),
      ...(input.docSizeBytes !== undefined ? { docSizeBytes: input.docSizeBytes } : {}),
      ...(input.updatedBy !== undefined ? { updatedBy: input.updatedBy } : {}),
      storedAt: new Date(),
    }
    const row = (await this.prisma.documentContent.update({
      where: { nodeId: input.nodeId },
      data,
    })) as PrismaContent
    return toContent(row)
  }
}
