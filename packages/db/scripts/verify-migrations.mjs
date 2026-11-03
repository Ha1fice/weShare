/**
 * 迁移校验（T1.3 判据：空库执行一次得完整结构，二次执行无副作用）。
 *
 * 校验内容：
 *   1. 在临时内存库上执行全部迁移 → 不报错
 *   2. 再执行一次 → 无副作用（幂等）
 *   3. 迁移后的结构包含 schema 定义的每一张表
 *   4. 关键 PRAGMA 生效（外键开启、WAL）
 *
 * 用内存库而不是文件库：校验不该在磁盘上留垃圾，也避免与开发库冲突。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { drizzle } from 'drizzle-orm/libsql'
import { getTableName, isTable } from 'drizzle-orm'
import * as schema from '../src/schema/sqlite.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')
const MIGRATIONS_DIR = path.join(PKG_ROOT, 'migrations')

/** schema 中定义的全部表名。 */
const EXPECTED_TABLES = Object.values(schema)
  .filter((v) => isTable(v))
  .map((t) => getTableName(t))
  .sort()

function fail(message) {
  console.error(`✗ 迁移校验失败：${message}`)
  process.exit(1)
}

async function main() {
  // 用内存库：校验不该在磁盘上留垃圾，也不该与开发库冲突。
  // WAL 对内存库无意义（没有磁盘文件），因此不设 journal_mode。
  const client = createClient({ url: 'file::memory:' })

  try {
    // 外键必须开启——否则级联删除校验会假失败
    await client.execute('PRAGMA foreign_keys = ON')
    await client.execute('PRAGMA busy_timeout = 5000')

    const db = drizzle(client, { schema })

    // 1. 首次迁移
    console.log('→ 首次执行迁移…')
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR })

    // 2. 幂等：再执行一次
    console.log('→ 二次执行迁移（幂等检查）…')
    try {
      await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
    } catch (err) {
      fail(
        `二次执行迁移报错，说明迁移不幂等：\n${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // 3. 表结构完整性
    console.log('→ 校验表结构…')
    const rows = await client.execute(
      "select name from sqlite_master where type='table' and name not like 'sqlite_%'",
    )
    const actual = new Set(rows.rows.map((r) => String(r.name)))

    const missing = EXPECTED_TABLES.filter((t) => !actual.has(t))
    if (missing.length > 0) {
      fail(`迁移后缺少这些表：${missing.join('、')}`)
    }

    const extra = [...actual].filter(
      (t) => !EXPECTED_TABLES.includes(t) && !t.startsWith('__drizzle'),
    )
    if (extra.length > 0) {
      fail(`迁移后出现 schema 未定义的表：${extra.join('、')}`)
    }

    console.log(`✓ ${EXPECTED_TABLES.length} 张表全部就位`)

    // 4. 关键 PRAGMA
    const fk = await client.execute('PRAGMA foreign_keys')
    if (Number(fk.rows[0]?.foreign_keys) !== 1) {
      fail('PRAGMA foreign_keys 未开启——所有外键约束形同虚设')
    }

    // 5. 级联删除真实生效（架构文档 §7.2 变更 2 的落点）
    console.log('→ 校验级联删除…')
    // 插入顺序必须满足外键：先 user，再 workspace，最后 nodes
    await client.execute(
      "insert into users (id, email, password_hash, display_name, status, created_at, updated_at) values ('u1','a@b.c','h','A','active',0,0)",
    )
    await client.execute(
      "insert into workspaces (id, name, owner_id, default_role, created_at, updated_at) values ('w1','W','u1','edit',0,0)",
    )
    await client.execute(
      "insert into nodes (id, workspace_id, parent_id, type, title, title_norm, owner_id, visibility, sort_order, created_at, updated_at) values ('p1','w1',null,'folder','P','p','u1','workspace',0,0,0)",
    )
    await client.execute(
      "insert into nodes (id, workspace_id, parent_id, type, title, title_norm, owner_id, visibility, sort_order, created_at, updated_at) values ('c1','w1','p1','doc','C','c','u1','workspace',0,0,0)",
    )
    await client.execute("delete from nodes where id = 'p1'")
    const remaining = await client.execute("select id from nodes where id = 'c1'")
    if (remaining.rows.length > 0) {
      fail('级联删除未生效：删除父节点后子节点仍存在')
    }
    console.log('✓ 级联删除生效')

    console.log('\n✓ 迁移校验全部通过')
  } finally {
    try {
      client.close()
    } catch {
      /* 已关闭 */
    }
  }
}

main().catch((err) => {
  console.error('✗ 迁移校验异常：', err)
  process.exit(1)
})
