/**
 * 附件仓储。
 *
 * 聚合边界：附件元数据（文件本体在文件存储里，不在数据库）。
 */

import type { PrismaClient } from '../../generated/client/client.js'
import type { AttachmentsRepository } from './interfaces.js'
import type { Attachment } from './types.js'
import { toAttachment, type PrismaAttachment } from './mapping.js'

export class AttachmentsRepositoryImpl implements AttachmentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Attachment | null> {
    const row = (await this.prisma.attachment.findUnique({ where: { id } })) as PrismaAttachment | null
    return row ? toAttachment(row) : null
  }

  async findByStorageKey(storageKey: string): Promise<Attachment | null> {
    const row = (await this.prisma.attachment.findUnique({
      where: { storageKey },
    })) as PrismaAttachment | null
    return row ? toAttachment(row) : null
  }

  async create(input: {
    id: string
    workspaceId: string
    nodeId?: string | null
    uploaderId: string
    originalName: string
    mimeType: string
    byteSize: number
    sha256: string
    storageKey: string
    width?: number | null
    height?: number | null
  }): Promise<Attachment> {
    const row = (await this.prisma.attachment.create({
      data: {
        id: input.id,
        workspaceId: input.workspaceId,
        nodeId: input.nodeId ?? null,
        uploaderId: input.uploaderId,
        originalName: input.originalName,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        sha256: input.sha256,
        storageKey: input.storageKey,
        width: input.width ?? null,
        height: input.height ?? null,
      },
    })) as PrismaAttachment
    return toAttachment(row)
  }

  async attachToNode(id: string, nodeId: string): Promise<Attachment> {
    const row = (await this.prisma.attachment.update({
      where: { id },
      data: { nodeId },
    })) as PrismaAttachment
    return toAttachment(row)
  }

  async detachFromNode(id: string): Promise<boolean> {
    const result = await this.prisma.attachment.updateMany({
      where: { id },
      data: { nodeId: null },
    })
    return result.count > 0
  }
}
