/**
 * 执行数据库迁移（T1.3）。
 *
 * 可重复执行：迁移记录在 __drizzle_migrations 表里，已执行过的不会重跑。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { openDb, closeDb, DEFAULT_DB_PATH } from '../src/driver.sqlite.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.resolve(HERE, '..', 'migrations')

async function main() {
  const dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH
  const handle = await openDb(dbPath)
  try {
    console.log(`→ 迁移数据库：${dbPath}`)
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_DIR })
    console.log('✓ 迁移完成')
  } finally {
    await closeDb(handle)
  }
}

main().catch((err) => {
  console.error('✗ 迁移失败：', err)
  process.exit(1)
})
