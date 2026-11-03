/**
 * Prisma Client 封装（架构文档不变式 I7）。
 *
 * 本文件是**唯一**允许出现 Prisma Client 与数据库驱动类型的地方。
 * 业务代码（apps/*、packages/* 除本包外）不得 import 本文件，
 * 更不得 import @prisma/client —— 必须经 packages/db 暴露的 Repository 接口。
 *
 * 由 scripts/guards/check-data-access-leak.mjs 强制。
 */

import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaClient } from '../generated/client/client.js'
/** 数据库文件路径。默认在仓库根的 data/weshare.db。 */
export const DEFAULT_DB_PATH = 'data/weshare.db'

/**
 * 把路径转成 Prisma 可用的 file: URL。
 *
 * Windows 必须是 `file:C:/path/to.db`（两斜杠）。三斜杠形式
 * （`file:///C:/...`）会被 Prisma 7 的 schema engine 拒绝，
 * 报 os error 161「指定的路径无效」。
 */
export function toDatabaseUrl(dbPath: string): string {
  if (dbPath === ':memory:') return 'file::memory:'
  const abs = dbPath.replace(/\\/g, '/')
  return `file:${abs}`
}

export interface DbOptions {
  /** 数据库文件路径，或 ':memory:'。 */
  dbPath?: string
  /** 完整 URL，优先于 dbPath。 */
  url?: string
}

/**
 * 创建 Prisma Client。
 *
 * Prisma 7 必须通过 driver adapter 连接（不再内置 Rust 引擎）。
 * 适配器是 libSQL，与项目的 SQLite 单文件方案一致。
 */
export function createPrismaClient(options: DbOptions = {}): PrismaClient {
  const url = options.url ?? toDatabaseUrl(options.dbPath ?? DEFAULT_DB_PATH)
  const adapter = new PrismaLibSql({ url })
  // Prisma 7 的 prisma-client generator 自动内置模型，
  // 不需要（也不能）再传 schema 选项——那是 Prisma 6 的写法。
  return new PrismaClient({ adapter })
}

let singleton: PrismaClient | null = null

/**
 * 取得进程内共享的 Prisma Client。
 *
 * 单例是有意的：Prisma Client 内部维护连接池，
 * 每次 new 都会新建一套，在 Hocuspocus 长连接进程里会累积连接。
 */
export function getPrismaClient(dbPath?: string): PrismaClient {
  if (!singleton) {
    singleton = createPrismaClient({ dbPath })
  }
  return singleton
}

/** 关闭共享 Client（进程退出时调用）。 */
export async function disconnectPrisma(): Promise<void> {
  if (singleton) {
    await singleton.$disconnect()
    singleton = null
  }
}
