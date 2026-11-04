/**
 * Repository 测试夹具。
 *
 * 目标：用**真实数据库**检验 Repository 实现，而不是 mock。
 * Repository 层的价值全在"Prisma 查询 ↔ 领域类型"的转换与事务边界上，
 * mock 掉 Prisma 就把这些全测没了——那样的测试只是让覆盖率好看。
 *
 * 建库方式：文件库 + 直接应用迁移 SQL。
 *   - 不用 `prisma migrate`：那要拉起 schema engine，慢，且在 Windows 的
 *     系统临时目录上会报 os error 161。
 *   - 迁移 SQL 仍是唯一真源——测试读的就是 `prisma/migrations/` 下
 *     将来要部署到生产的那份 SQL，不会与 Schema 漂移。
 *
 * 为什么不能用 `:memory:` 内存库（踩过的坑）：
 *   libsql 的 `:memory:` 是**按连接隔离**的——每个连接看到一个独立的空库。
 *   Prisma 有连接池，池里开出第二个连接时，模型 API 就报
 *   "no such table: main.nodes"，而 raw SQL 走的是另一个连接所以能看到表。
 *   文件库没有这个问题：所有连接指向同一个文件。
 *
 * 为什么不用系统临时目录（踩过的坑）：
 *   libsql 的 `close()` 在 Windows 上不立即释放文件句柄，
 *   临时目录删不掉（EPERM）。测试库改放仓库内的 data/ 目录，
 *   由 Vitest 的 globalTeardown 统一清理（那时 worker 已退出，句柄已释放）。
 *
 * 关于共享 client：Prisma 的 adapter 内部自建 libsql client，无法把外部
 * client 传进去。若让两者各建各的，建表的 client 与 Prisma 用的 client
 * 就不是同一个库（内存库下尤其致命）。解法是覆写 adapter 的
 * `createClient`，让它返回我们自己的实例。
 */

import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type Client } from '@libsql/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaClient } from '../generated/client/client.js'
import { createRepositories } from '../src/repo/index.js'
import type { Repositories } from '../src/repo/interfaces.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')
const MIGRATIONS_DIR = path.join(PKG_ROOT, 'prisma', 'migrations')

/** 测试库目录（相对仓库根）。放在仓库内而非系统临时目录——见文件头说明。 */
export const TEST_DB_DIR = path.resolve(PKG_ROOT, '..', '..', 'data', 'test')

/** 读出全部迁移 SQL，按目录名（时间戳）排序。 */
function readMigrationSql(): string {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

  const parts: string[] = []
  for (const dir of dirs) {
    const file = path.join(MIGRATIONS_DIR, dir, 'migration.sql')
    try {
      parts.push(readFileSync(file, 'utf8'))
    } catch {
      // 目录里没有 migration.sql（如 shadow database 目录），跳过
    }
  }
  if (parts.length === 0) {
    throw new Error('未找到任何迁移 SQL——测试无法建库')
  }
  return parts.join('\n')
}

/**
 * 复用外部 client 的 libsql adapter。
 *
 * `createClient` 是 adapter 工厂的公开方法，Prisma 在连接时调用它建 client。
 * 覆写为返回我们已建好表的实例，就让 Prisma 与建表脚本共用同一个库。
 */
class SharedClientLibSqlAdapter extends PrismaLibSql {
  constructor(
    private readonly shared: Client,
    config: { url: string },
  ) {
    super(config)
  }

  override createClient(): Client {
    return this.shared
  }
}

export interface TestDb {
  prisma: PrismaClient
  repos: Repositories
  /** 清空所有表，用于测试用例之间隔离。 */
  reset(): Promise<void>
  close(): Promise<void>
}

let dbCounter = 0

/**
 * 建一个带完整结构的库。
 *
 * @param label 用于区分不同测试文件的库名（并行时互不干扰）
 */
export async function createTestDb(label = 'db'): Promise<TestDb> {
  dbCounter += 1
  mkdirSync(TEST_DB_DIR, { recursive: true })

  const dbPath = path.join(TEST_DB_DIR, `${label}-${process.pid}-${dbCounter}.db`)
  // Windows 上必须是 `file:C:/...`（两斜杠）；三斜杠形式会被 libsql 当成
  // 相对路径解析，报 "unable to open database file"。
  const url = 'file:' + dbPath.replace(/\\/g, '/')

  // 建表：读迁移 SQL 并应用
  const client = createClient({ url })
  await client.executeMultiple(readMigrationSql())

  const prisma = new PrismaClient({
    adapter: new SharedClientLibSqlAdapter(client, { url }),
  })
  const repos = createRepositories(prisma)

  return {
    prisma,
    repos,
    async reset() {
      // 顺序按外键依赖倒序：先删被引用的表。
      // nodes 有自引用（parent_id / trash_root_id），先断链再删，
      // 不依赖 SQLite "删光整表时不检查外键" 的优化。
      await prisma.$executeRawUnsafe(
        'UPDATE nodes SET parent_id = NULL, trash_root_id = NULL, deleted_by = NULL',
      )
      const tables = [
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
      ]
      for (const t of tables) {
        await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`)
      }
    },
    async close() {
      await prisma.$disconnect()
      client.close()
      // 文件本身由 globalTeardown 统一删除——此时句柄可能还没释放，
      // 在这里删会 EPERM。
    },
  }
}

/** 固定的测试标识符，避免随机 UUID 让断言难写。 */
export const IDs = {
  user: 'u-owner',
  user2: 'u-member',
  user3: 'u-outsider',
  workspace: 'w-1',
  folder: 'n-folder',
  doc: 'n-doc',
  child: 'n-child',
  grandchild: 'n-grandchild',
} as const
