/**
 * 文档正文领域服务（Phase 2：单机编辑 + 真实持久化）。
 *
 * 两条写入路径互斥（架构文档不变式 I2）：
 *   - Phase 2：本服务，REST 整篇写回 + revision 乐观锁；
 *   - Phase 3：collab 服务把 Y.Doc 落库。
 * 一旦 `yjs_state` 非空（文档被协同打开过），本服务的写入路径**关闭**，
 * 返回 409 COLLAB_ENABLED。这样永远不会出现"REST 写了一份、协同写了另一份"。
 *
 * 权限：
 *   | 操作 | 要求 |
 *   |---|---|
 *   | 读正文 | effectiveRole ≥ view |
 *   | 写正文 | effectiveRole ≥ edit（且服务端复核，不靠前端禁用输入） |
 *
 * 关于 revision 语义：`revision` 是**正文表的版本号**，不是节点元数据的版本。
 * 改名不动它——元数据与正文分离（架构文档 §5.3），改标题不该让别人的编辑器
 * 报冲突。
 */

import type { Repositories } from '@weshare/db'
import type { ProseMirrorDoc } from '@weshare/shared'
import { CONTENT_SIZE_LIMIT_BYTES, extractPlainText } from '@weshare/shared'
import { AppError, conflict, notFound } from '../http/errors.js'
import type { NodeService } from './node-service.js'

export interface ContentServiceOptions {
  repos: Repositories
  nodes: NodeService
}

/** 读正文的结果。 */
export interface ContentResult {
  nodeId: string
  doc: ProseMirrorDoc | null
  revision: number
  contentSchemaVersion: number
  textPreview: string | null
  charCount: number
  updatedAt: Date
  collabEnabled: boolean
}

/** 列表摘要用的字段。 */
export interface ContentSummary {
  textPreview: string | null
  charCount: number
  revision: number
}

/** 摘要在列表接口里可能缺失（从未保存过的文档）。 */
export type ContentSummaryMap = Map<string, ContentSummary>

export class ContentService {
  private readonly repos: Repositories
  private readonly nodes: NodeService

  constructor(options: ContentServiceOptions) {
    this.repos = options.repos
    this.nodes = options.nodes
  }

  /**
   * 读正文。
   *
   * 越权与不存在都返回 404（防探测，架构文档 T5.3）。
   */
  async get(nodeId: string, userId: string): Promise<ContentResult> {
    // 复用节点服务的权限判定——不比它多一条、也不比它少一条
    await this.nodes.getNode(nodeId, userId)

    const content = await this.repos.contents.findByNodeId(nodeId)
    if (!content) throw notFound('文档正文不存在')

    return {
      nodeId: content.nodeId,
      doc: content.contentJson as ProseMirrorDoc | null,
      revision: content.revision,
      contentSchemaVersion: content.contentSchemaVersion,
      textPreview: content.textPreview,
      charCount: content.charCount,
      updatedAt: content.updatedAt,
      collabEnabled: content.yjsState !== null,
    }
  }

  /**
   * 保存正文。
   *
   * @param expectedRevision 客户端拿到的 revision。不一致即 409。
   *
   * 校验顺序是有讲究的：
   *   1. 权限（不是空间成员 → 404，别让人知道自己猜对了 ID）
   *   2. 已删除 → 404（回收站里的文档不能继续编辑）
   *   3. 协同已启用 → 409 COLLAB_ENABLED（先判会不会被拒，再判内容大小）
   *   4. 体积上限 → 413
   *   5. revision 冲突 → 409
   */
  async save(input: {
    nodeId: string
    userId: string
    doc: ProseMirrorDoc
    revision: number
  }): Promise<ContentResult> {
    const { node } = await this.nodes.requireRole(input.nodeId, input.userId, 'edit')

    if (node.deletedAt !== null) throw notFound('文档不存在')

    const current = await this.repos.contents.findByNodeId(input.nodeId)
    if (!current) throw notFound('文档正文不存在')

    if (current.yjsState !== null) {
      throw new AppError(
        'COLLAB_ENABLED',
        '这篇文档已启用实时协同，正文只能通过协同服务写入',
      )
    }

    // 序列化后再量体积——不能信客户端自报的字数
    const serialized = JSON.stringify(input.doc)
    const bytes = Buffer.byteLength(serialized, 'utf8')
    if (bytes > CONTENT_SIZE_LIMIT_BYTES) {
      throw new AppError(
        'PAYLOAD_TOO_LARGE',
        `文档体积超出上限（${Math.round(CONTENT_SIZE_LIMIT_BYTES / 1024 / 1024)} MB）`,
      )
    }

    if (current.revision !== input.revision) {
      throw conflict('内容已被其他人修改，请载入最新版本后再保存')
    }

    const textPreview = extractPlainText(input.doc)
    const saved = await this.repos.contents.save({
      nodeId: input.nodeId,
      contentJson: input.doc,
      expectedRevision: input.revision,
      textPreview: textPreview.slice(0, 200),
      charCount: textPreview.length,
      docSizeBytes: bytes,
      updatedBy: input.userId,
    })

    return {
      nodeId: saved.nodeId,
      doc: saved.contentJson as ProseMirrorDoc | null,
      revision: saved.revision,
      contentSchemaVersion: saved.contentSchemaVersion,
      textPreview: saved.textPreview,
      charCount: saved.charCount,
      updatedAt: saved.updatedAt,
      collabEnabled: saved.yjsState !== null,
    }
  }

  /**
   * 批量取摘要（列表页用）。
   *
   * 列表页要显示"最近编辑"和摘要，但正文可能很大，不能整篇拉。
   * 这里返回 textPreview / charCount，不返回 doc。
   */
  async summaries(nodeIds: string[]): Promise<ContentSummaryMap> {
    if (nodeIds.length === 0) return new Map()
    const rows = await this.repos.contents.listSummaries(nodeIds)
    const map: ContentSummaryMap = new Map()
    for (const row of rows) {
      map.set(row.nodeId, {
        textPreview: row.textPreview,
        charCount: row.charCount,
        revision: row.revision,
      })
    }
    return map
  }
}
