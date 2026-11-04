/**
 * Repository 工厂。
 *
 * 组装全部仓储实现，返回的是**接口**类型而不是实现类——
 * 调用方拿不到任何 Prisma 类型的痕迹（架构文档不变式 I7）。
 */

import type { PrismaClient } from '../../generated/client/client.js'
import type { Repositories } from './interfaces.js'
import { AclRepositoryImpl } from './acl.repo.js'
import { AttachmentsRepositoryImpl } from './attachments.repo.js'
import { AuditRepositoryImpl } from './audit.repo.js'
import { ContentsRepositoryImpl } from './contents.repo.js'
import { NodesRepositoryImpl } from './nodes.repo.js'
import { UsersRepositoryImpl } from './users.repo.js'
import { VersionsRepositoryImpl } from './versions.repo.js'
import { WorkspacesRepositoryImpl } from './workspaces.repo.js'

export function createRepositories(prisma: PrismaClient): Repositories {
  return {
    users: new UsersRepositoryImpl(prisma),
    workspaces: new WorkspacesRepositoryImpl(prisma),
    nodes: new NodesRepositoryImpl(prisma),
    contents: new ContentsRepositoryImpl(prisma),
    acl: new AclRepositoryImpl(prisma),
    versions: new VersionsRepositoryImpl(prisma),
    attachments: new AttachmentsRepositoryImpl(prisma),
    audit: new AuditRepositoryImpl(prisma),
  }
}
