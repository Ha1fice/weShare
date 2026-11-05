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
   * 协同落库（**无条件**）。
   *
   * 这个方法是协同的**事实源写入**，不能带任何"只在某条件下才写"的门槛。
   *
   * 曾经的实现用 `updateMany({ where: { nodeId, yjsState: null } })` 做
   * "抢占迁移权"，结果是：抢到之后后续每一次落库都被那个 `where` 挡掉，
   * 只影响 0 行——**用户协同时写的所有内容根本没进数据库**，而调用方还
   * 以为存成功了。这类"静默不写"比报错危险得多。
   *
   * 迁移权之争（两个进程同时首次打开同一文档）用 CAS 解决：
   * `expectYjsState: 'null'` 时，只有当前仍为空才写；没命中返回
   * `claimed: false`，调用方据此丢弃自己的迁移副本。
   *
   * 两种语义合并成一个方法：写什么完全一样，只有"允不允许写"不同。
   * 拆开时两边的 data 对象是手抄的两份，漏字段只是时间问题。
   */
  async saveCollaborative(
    input: SaveContentInput & { expectYjsState?: 'null' | 'any' },
  ): Promise<{ claimed: boolean }> {
    const result = (await this.prisma.documentContent.updateMany({
      where: {
        nodeId: input.nodeId,
        ...(input.expectYjsState === 'null' ? { yjsState: null } : {}),
      },
      data: collaborativeData(input),
    })) as { count: number }
    return { claimed: result.count > 0 }
  }
}

/**
 * 协同写入的字段集。
 *
 * 显式标注为 Unchecked 变体：`updatedBy` 是可空外键，交给 TS 推断会在
 * checked/unchecked 之间产生歧义。
 */
function collaborativeData(input: SaveContentInput): PrismaDocumentContentUncheckedUpdateInput {
  return {
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
}
