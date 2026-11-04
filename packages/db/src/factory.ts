/**
 * 数据库句柄工厂。
 *
 * 目的：让业务代码（apps/api、apps/collab）**完全不需要接触 Prisma Client**。
 *
 * 不变式 I7 要求"业务层不得直接依赖 Prisma Client 或数据库驱动"。
 * 如果 api 自己 `new PrismaClient()` 再 `createRepositories(client)`，
 * 就等于让业务层持有 Prisma 类型——虽然不 import，但类型会流经函数签名。
 *
 * 这个工厂把 client 的创建与关闭都封在 packages/db 内，
 * 对外只暴露 Repository 接口与一个 close 函数。
 */

import { createPrismaClient } from './client.js'
import { createRepositories } from './repo/index.js'
import type { Repositories } from './repo/interfaces.js'

export interface DbHandle {
  /** Repository 集合（业务领域类型）。 */
  repos: Repositories
  /** 关闭底层连接。进程退出前必须调用。 */
  close(): Promise<void>
}

/**
 * 创建数据库句柄。
 *
 * @param dbPath 数据库文件路径。默认用仓库根的 data/weshare.db。
 *   测试可传自己的路径。
 */
export function createDbHandle(dbPath?: string): DbHandle {
  const prisma = createPrismaClient(dbPath ? { dbPath } : {})

  return {
    repos: createRepositories(prisma),
    async close() {
      await prisma.$disconnect()
    },
  }
}
