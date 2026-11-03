/**
 * SQLite 驱动（架构文档 §7.2 SQLite 特有约束、T1.2）。
 *
 * 本文件是**唯一**允许出现 SQLite 方言细节的地方——业务代码只经仓储接口访问数据
 * （不变式 I7 方言不可上浮，由 scripts/guards/check-dialect-isolation.mjs 强制）。
 *
 * 为什么用 @libsql/client 而不是 better-sqlite3：
 *   better-sqlite3 是原生模块，需要 node-gyp 编译（Windows 上还要 MSBuild +
 *   ClangCL 工具集），这会让 CI 环境与离线交付都变脆。
 *   @libsql/client 提供预编译二进制，装完即用；SQLite 文件格式完全兼容，
 *   且 Drizzle 官方支持 `drizzle-orm/libsql` 驱动。
 *   许可证 MIT，与本项目依赖树的许可基调一致。
 */

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema/sqlite.js'

/**
 * 默认数据库文件位置。
 *
 * 相对于**仓库根**而不是当前工作目录——脚本可能在包目录下运行
 * （`pnpm --filter @weshare/db db:migrate`），用 cwd 相对路径会让
 * 数据库文件落在 `packages/db/data/`，与文档和 api 进程预期的位置不一致。
 */
export const DEFAULT_DB_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../data/weshare.db',
)

/**
 * SQLite 必须显式打开的 PRAGMA。
 *
 * 每一项都有具体后果，不是"建议"：
 * - foreign_keys：SQLite 默认**关闭**外键约束，不开等于所有 FK 形同虚设
 * - journal_mode=WAL：允许读写并发，否则读会阻塞写
 * - busy_timeout：写锁竞争时等待而不是立刻抛 SQLITE_BUSY
 */
export const PRAGMAS = [
  'PRAGMA foreign_keys = ON',
  'PRAGMA journal_mode = WAL',
  'PRAGMA busy_timeout = 5000',
  // WAL 下 NORMAL 是安全与性能的良好折中
  'PRAGMA synchronous = NORMAL',
] as const

export interface DbHandle {
  client: Client
  db: ReturnType<typeof drizzle<typeof schema>>
  /** 打开的数据库路径。 */
  path: string
}

/**
 * 打开数据库连接。
 *
 * @param dbPath 文件路径；传 ':memory:' 得到内存库（测试用，每测试独立实例）。
 */
export async function openDb(dbPath: string = DEFAULT_DB_PATH): Promise<DbHandle> {
  if (dbPath !== ':memory:') {
    const abs = path.resolve(dbPath)
    mkdirSync(path.dirname(abs), { recursive: true })
  }
  const client = createClient({ url: `file:${dbPath}` })

  for (const pragma of PRAGMAS) {
    await client.execute(pragma)
  }

  return { client, db: drizzle(client, { schema }), path: dbPath }
}

/**
 * 读取当前生效的 PRAGMA 值（用于测试断言，见 T1.2 判据）。
 */
export async function readPragma(client: Client, name: string): Promise<unknown> {
  const result = await client.execute(`PRAGMA ${name}`)
  const row = result.rows[0] as Record<string, unknown> | undefined
  if (!row) return undefined
  return Object.values(row)[0]
}

/** 关闭连接（触发 WAL checkpoint，避免留下游离的 -wal 文件）。 */
export async function closeDb(handle: DbHandle): Promise<void> {
  try {
    await handle.client.execute('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch {
    // 连接已关闭或数据库不是 WAL 模式时忽略
  }
  handle.client.close()
}
