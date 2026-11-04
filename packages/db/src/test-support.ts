/**
 * 测试辅助：建一个带完整结构的临时库。
 *
 * 放在 packages/db 是因为**只有这个包能碰数据库驱动**——
 * 业务包（apps/api、apps/collab）连 @libsql/client 都不该有。
 * 测试辅助也遵守同一条边界。
 *
 * 库结构来自 `prisma/migrations/` 下将来要部署到生产的那份 SQL，
 * 因此测试与生产结构不会漂移。
 *
 * 两个 libSQL 的坑（详见 packages/db/test/fixture.ts 与架构文档 §15.2）：
 *   1. `:memory:` 按连接隔离 → 必须用文件库；
 *   2. 文件句柄在 Windows 上不及时释放 → 清理交给调用方在进程退出后做。
 */

import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { createDbHandle, type DbHandle } from './factory.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(HERE, '..', 'prisma', 'migrations')

/** 读出全部迁移 SQL，按目录名（时间戳）排序。 */
export function readMigrationSql(): string {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

  const parts: string[] = []
  for (const dir of dirs) {
    try {
      parts.push(readFileSync(path.join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'))
    } catch {
      // 目录里没有 migration.sql（如 shadow database 目录），跳过
    }
  }
  if (parts.length === 0) {
    throw new Error('未找到任何迁移 SQL——测试无法建库')
  }
  return parts.join('\n')
}

/** 构造 file: URL（Windows 上必须两斜杠，三斜杠会被当成相对路径）。 */
export function toFileUrl(dbPath: string): string {
  return 'file:' + dbPath.replace(/\\/g, '/')
}

/** 建一个带完整结构的临时库，返回句柄与文件路径。 */
export async function createTestDatabase(): Promise<{
  db: DbHandle
  dbPath: string
  dir: string
}> {
  const dir = mkdtempSync(path.join(tmpdir(), 'weshare-test-'))
  const dbPath = path.join(dir, 'test.db')
  const url = toFileUrl(dbPath)

  // 建表——必须等 executeMultiple 完成，否则后续查询会报"no such table"
  const client = createClient({ url })
  try {
    await client.executeMultiple(readMigrationSql())
  } finally {
    client.close()
  }

  return { db: createDbHandle(dbPath), dbPath, dir }
}

/**
 * 清空所有业务表。
 *
 * 用独立的 libsql 客户端执行——它与 Prisma 指向同一个文件。
 */
export async function clearTables(dbPath: string): Promise<void> {
  const client = createClient({ url: toFileUrl(dbPath) })
  try {
    // nodes 有自引用，先断链
    await client.execute(
      'UPDATE nodes SET parent_id = NULL, trash_root_id = NULL, deleted_by = NULL',
    )
    for (const t of [
      'audit_events',
      'attachments',
      'node_versions',
      'node_acl',
      'document_contents',
      'nodes',
      'workspace_members',
      'workspaces',
      'sessions',
      'users',
    ]) {
      await client.execute(`DELETE FROM "${t}"`)
    }
  } finally {
    client.close()
  }
}
