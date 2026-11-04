/**
 * 文档正文仓储。
 *
 * 聚合边界：内容镜像 + 协同事实源 + 版本号。
 * 三者在同一个聚合里，因为它们的生命周期完全一致——一次写入同时更新
 * content_json / yjs_state / revision，分开存放会让"哪份是新的"变得含糊。
 */

import type { PrismaClient } from '../../generated/client/client.js'
import type { DocumentContentUncheckedUpdateInput as PrismaDocumentContentUncheckedUpdateInput } from '../../generated/client/models/DocumentContent.js'
import type { ContentsRepository } from './interfaces.js'
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
