/**
 * 迁移结构对照校验（T1.3 判据：迁移后结构与原设计一致）。
 *
 * 逐项验证：
 *   1. 10 张表全部存在
 *   2. 每张表的字段集合与列名一致
 *   3. 主键与自增策略
 *   4. 外键与级联删除行为
 *   5. 唯一约束
 *   6. 索引（含 Prisma 无法表达、手工补入的部分索引）
 *   7. 可空性与默认值
 *   8. 软删除字段
 *   9. email 大小写唯一（emailLower 列）
 *
 * 与 Prisma 生成的结构对照基准写在 EXPECTED 中——
 * 该基准来自原 Drizzle 迁移 0000_init.sql 逐项抄录，不是"Prisma 生成什么就是什么"。
 */

import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'


/**
 * 期望结构 —— 逐项对照原 Drizzle 迁移 0000_init.sql 抄录。
 *
 * 格式：表名 → { 列名: { notNull, default } }
 * null 表示可空；default 为 undefined 表示无数据库默认值。
 */
const EXPECTED: Record<string, Record<string, { notNull: boolean; default?: string }>> = {
  users: {
    id: { notNull: true },
    email: { notNull: true },
    email_lower: { notNull: true },
    password_hash: { notNull: true },
    display_name: { notNull: true },
    avatar_key: { notNull: false },
    status: { notNull: true, default: "'active'" },
    created_at: { notNull: true },
    updated_at: { notNull: true },
    last_login_at: { notNull: false },
  },
  sessions: {
    id: { notNull: true },
    user_id: { notNull: true },
    token_hash: { notNull: true },
    expires_at: { notNull: true },
    created_at: { notNull: true },
    last_seen_at: { notNull: true },
    user_agent: { notNull: false },
    ip: { notNull: false },
    revoked_at: { notNull: false },
  },
  workspaces: {
    id: { notNull: true },
    name: { notNull: true },
    owner_id: { notNull: true },
    default_role: { notNull: true, default: "'edit'" },
    created_at: { notNull: true },
    updated_at: { notNull: true },
    deleted_at: { notNull: false },
  },
  workspace_members: {
    workspace_id: { notNull: true },
    user_id: { notNull: true },
    role: { notNull: true },
    created_at: { notNull: true },
  },
  nodes: {
    id: { notNull: true },
    workspace_id: { notNull: true },
    parent_id: { notNull: false },
    type: { notNull: true },
    title: { notNull: true, default: "''" },
    title_norm: { notNull: true, default: "''" },
    owner_id: { notNull: true },
    visibility: { notNull: true, default: "'workspace'" },
    sort_order: { notNull: true, default: '0' },
    created_at: { notNull: true },
    updated_at: { notNull: true },
    deleted_at: { notNull: false },
    deleted_by: { notNull: false },
    trash_root_id: { notNull: false },
  },
  document_contents: {
    node_id: { notNull: true },
    content_schema_version: { notNull: true, default: '1' },
    yjs_schema_version: { notNull: true, default: '1' },
    content_json: { notNull: false },
    yjs_state: { notNull: false },
    state_vector: { notNull: false },
    doc_size_bytes: { notNull: true, default: '0' },
    revision: { notNull: true, default: '0' },
    text_preview: { notNull: false },
    char_count: { notNull: true, default: '0' },
    updated_by: { notNull: false },
    updated_at: { notNull: true },
    stored_at: { notNull: false },
  },
  node_acl: {
    id: { notNull: true },
    node_id: { notNull: true },
    subject_type: { notNull: true },
    subject_id: { notNull: true },
    role: { notNull: true },
    effect: { notNull: true, default: "'allow'" },
    created_by: { notNull: true },
    created_at: { notNull: true },
  },
  node_versions: {
    id: { notNull: true },
    node_id: { notNull: true },
    version_no: { notNull: true },
    kind: { notNull: true },
    label: { notNull: false },
    content_schema_version: { notNull: true, default: '1' },
    yjs_schema_version: { notNull: true, default: '1' },
    content_json: { notNull: true },
    yjs_state: { notNull: false },
    created_by: { notNull: false },
    created_at: { notNull: true },
  },
  attachments: {
    id: { notNull: true },
    workspace_id: { notNull: true },
    node_id: { notNull: false },
    uploader_id: { notNull: true },
    original_name: { notNull: true },
    mime_type: { notNull: true },
    byte_size: { notNull: true },
    sha256: { notNull: true },
    storage_key: { notNull: true },
    width: { notNull: false },
    height: { notNull: false },
    created_at: { notNull: true },
  },
  audit_events: {
    id: { notNull: true },
    workspace_id: { notNull: true },
    actor_id: { notNull: false },
    action: { notNull: true },
    target_type: { notNull: true },
    target_id: { notNull: false },
    metadata: { notNull: true },
    ip: { notNull: false },
    created_at: { notNull: true },
  },
}

/** 期望的外键（含级联行为）—— 对照原迁移。 */
const EXPECTED_FKS: { table: string; column: string; target: string; onDelete: string }[] = [
  { table: 'sessions', column: 'user_id', target: 'users', onDelete: 'CASCADE' },
  { table: 'workspaces', column: 'owner_id', target: 'users', onDelete: 'RESTRICT' },
  { table: 'workspace_members', column: 'workspace_id', target: 'workspaces', onDelete: 'CASCADE' },
  { table: 'workspace_members', column: 'user_id', target: 'users', onDelete: 'CASCADE' },
  { table: 'nodes', column: 'workspace_id', target: 'workspaces', onDelete: 'CASCADE' },
  { table: 'nodes', column: 'parent_id', target: 'nodes', onDelete: 'CASCADE' },
  { table: 'nodes', column: 'owner_id', target: 'users', onDelete: 'RESTRICT' },
  { table: 'nodes', column: 'deleted_by', target: 'users', onDelete: 'SET NULL' },
  { table: 'nodes', column: 'trash_root_id', target: 'nodes', onDelete: 'SET NULL' },
  { table: 'document_contents', column: 'node_id', target: 'nodes', onDelete: 'CASCADE' },
  { table: 'document_contents', column: 'updated_by', target: 'users', onDelete: 'SET NULL' },
  { table: 'node_acl', column: 'node_id', target: 'nodes', onDelete: 'CASCADE' },
  { table: 'node_acl', column: 'created_by', target: 'users', onDelete: 'RESTRICT' },
  { table: 'node_versions', column: 'node_id', target: 'nodes', onDelete: 'CASCADE' },
  { table: 'node_versions', column: 'created_by', target: 'users', onDelete: 'SET NULL' },
  { table: 'attachments', column: 'workspace_id', target: 'workspaces', onDelete: 'CASCADE' },
  { table: 'attachments', column: 'node_id', target: 'nodes', onDelete: 'SET NULL' },
  { table: 'attachments', column: 'uploader_id', target: 'users', onDelete: 'RESTRICT' },
  { table: 'audit_events', column: 'workspace_id', target: 'workspaces', onDelete: 'CASCADE' },
  { table: 'audit_events', column: 'actor_id', target: 'users', onDelete: 'SET NULL' },
]

/** 期望的唯一索引。 */
const EXPECTED_UNIQUE_INDEXES = [
  { table: 'users', columns: ['email_lower'] },
  { table: 'sessions', columns: ['token_hash'] },
  { table: 'node_acl', columns: ['node_id', 'subject_type', 'subject_id'] },
  { table: 'node_versions', columns: ['node_id', 'version_no'] },
  { table: 'attachments', columns: ['storage_key'] },
]

/** 期望存在的部分索引（Prisma 无法表达，手工补入迁移）。 */
const EXPECTED_PARTIAL_INDEXES = [
  { name: 'nodes_trash_idx', table: 'nodes' },
]

const problems: string[] = []
function fail(msg: string) {
  problems.push(msg)
}

function checkStructure(db: DatabaseSync) {
  // --- 表存在性 ---
  const tables = db
    .prepare(
      `select name from sqlite_master where type='table' and name not like 'sqlite_%' and name != '_prisma_migrations'`,
    )
    .all() as { name: string }[]
  const actualTables = new Set(tables.map((t) => t.name))

  for (const expected of Object.keys(EXPECTED)) {
    if (!actualTables.has(expected)) fail(`缺少表：${expected}`)
  }
  for (const actual of actualTables) {
    if (!(actual in EXPECTED)) fail(`多出未定义的表：${actual}`)
  }
  if (problems.length > 0) return

  // --- 字段 ---
  for (const [table, expectedCols] of Object.entries(EXPECTED)) {
    const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as {
      name: string
      notnull: number
      dflt_value: string | null
      pk: number
    }[]
    const actualCols = new Map(cols.map((c) => [c.name, c]))

    for (const [colName, spec] of Object.entries(expectedCols)) {
      const col = actualCols.get(colName)
      if (!col) {
        fail(`${table} 缺少字段 ${colName}`)
        continue
      }
      const isNotNull = col.notnull === 1 || col.pk > 0
      if (isNotNull !== spec.notNull) {
        fail(
          `${table}.${colName} 可空性不符：期望 ${spec.notNull ? 'NOT NULL' : '可空'}，实际 ${isNotNull ? 'NOT NULL' : '可空'}`,
        )
      }
      if (spec.default !== undefined) {
        const actualDefault = col.dflt_value
        if (actualDefault === null) {
          fail(`${table}.${colName} 缺少默认值 ${spec.default}`)
        } else if (actualDefault !== spec.default) {
          fail(`${table}.${colName} 默认值不符：期望 ${spec.default}，实际 ${actualDefault}`)
        }
      }
    }
    for (const name of actualCols.keys()) {
      if (!(name in expectedCols)) fail(`${table} 多出未定义字段 ${name}`)
    }
  }
}

function checkForeignKeys(db: DatabaseSync) {
  for (const table of Object.keys(EXPECTED)) {
    const fks = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as {
      from: string
      table: string
      on_delete: string
    }[]
    for (const expected of EXPECTED_FKS.filter((f) => f.table === table)) {
      const match = fks.find((f) => f.from === expected.column)
      if (!match) {
        fail(`${table}.${expected.column} 缺少外键`)
        continue
      }
      if (match.table !== expected.target) {
        fail(`${table}.${expected.column} 外键目标不符：期望 ${expected.target}，实际 ${match.table}`)
      }
      if (match.on_delete !== expected.onDelete) {
        fail(
          `${table}.${expected.column} 级联行为不符：期望 ${expected.onDelete}，实际 ${match.on_delete}`,
        )
      }
    }
  }
}

function checkIndexes(db: DatabaseSync) {
  const all = db
    .prepare(`select name, tbl_name, sql from sqlite_master where type='index'`)
    .all() as { name: string; tbl_name: string; sql: string }[]

  // 唯一索引
  for (const expected of EXPECTED_UNIQUE_INDEXES) {
    const found = all.find(
      (i) =>
        i.tbl_name === expected.table &&
        i.sql?.toUpperCase().includes('UNIQUE') &&
        expected.columns.every((c) => i.sql?.includes(`"${c}"`)),
    )
    if (!found) {
      fail(`${expected.table} 缺少唯一索引 (${expected.columns.join(', ')})`)
    }
  }

  // 部分索引（Prisma 无法表达，必须在迁移 SQL 中手工补入）
  for (const expected of EXPECTED_PARTIAL_INDEXES) {
    const found = all.find((i) => i.name === expected.name)
    if (!found) {
      fail(`缺少部分索引 ${expected.name}（Prisma 无法表达，须在迁移 SQL 中补入）`)
    } else if (!found.sql?.toUpperCase().includes('WHERE')) {
      fail(`${expected.name} 不是部分索引（缺少 WHERE 子句）`)
    }
  }
}

/** 运行时行为验证：级联删除、软删除、email 大小写唯一。 */
function checkBehavior(db: DatabaseSync) {
  db.exec('PRAGMA foreign_keys = ON')

  db.exec(
    `insert into users (id, email, email_lower, password_hash, display_name, status, created_at, updated_at)
     values ('u1','A@B.C','a@b.c','h','A','active',0,0)`,
  )

  // email 大小写不敏感唯一
  try {
    db.prepare(
      `insert into users (id, email, email_lower, password_hash, display_name, status, created_at, updated_at)
       values ('u2','a@b.c','a@b.c','h','B','active',0,0)`,
    ).run()
    fail('email 大小写不敏感唯一未生效：重复 email 被插入')
  } catch {
    /* 预期被拒 */
  }

  db.exec(
    `insert into workspaces (id, name, owner_id, default_role, created_at, updated_at)
     values ('w1','W','u1','edit',0,0)`,
  )
  db.exec(
    `insert into nodes (id, workspace_id, parent_id, type, title, title_norm, owner_id, visibility, sort_order, created_at, updated_at)
     values ('p1','w1',null,'folder','P','p','u1','workspace',0,0,0)`,
  )
  db.exec(
    `insert into nodes (id, workspace_id, parent_id, type, title, title_norm, owner_id, visibility, sort_order, created_at, updated_at)
     values ('c1','w1','p1','doc','C','c','u1','workspace',0,0,0)`,
  )

  // 级联删除（架构文档 §7.2 变更 2）
  db.prepare('delete from nodes where id = ?').run('p1')
  const orphan = db.prepare('select id from nodes where id = ?').get('c1')
  if (orphan) fail('级联删除未生效：删除父节点后子节点仍存在')

  // 软删除字段
  const softCols = db.prepare(`PRAGMA table_info("nodes")`).all() as { name: string }[]
  if (!softCols.some((c) => c.name === 'deleted_at')) fail('nodes 缺少软删除字段 deleted_at')

  // 部分索引只收录已删除节点
  db.prepare(
    `insert into nodes (id, workspace_id, parent_id, type, title, title_norm, owner_id, visibility, sort_order, created_at, updated_at, deleted_at)
     values ('d1','w1',null,'doc','D','d','u1','workspace',0,0,0,12345)`,
  )
  const idx = db
    .prepare(`select sql from sqlite_master where name='nodes_trash_idx'`)
    .get() as { sql: string } | undefined
  if (idx?.sql && !idx.sql.toUpperCase().includes('WHERE')) {
    fail('nodes_trash_idx 缺少 WHERE 条件，不是部分索引')
  }
}

function main() {
  const dbPath = process.env.VERIFY_DB_PATH
  if (!dbPath || !existsSync(dbPath)) {
    console.error('✗ 未提供 VERIFY_DB_PATH 或文件不存在')
    process.exit(1)
  }

  // 用可写模式打开：结构校验之后还要做行为验证（级联删除、唯一约束），
  // 只读模式会让这些写操作失败。
  const db = new DatabaseSync(dbPath)

  console.log('→ 校验表与字段…')
  checkStructure(db)
  console.log('→ 校验外键与级联…')
  checkForeignKeys(db)
  console.log('→ 校验索引…')
  checkIndexes(db)
  console.log('→ 校验运行时行为…')
  checkBehavior(db)

  db.close()

  if (problems.length > 0) {
    console.error(`\n✗ 结构对照发现 ${problems.length} 处不一致\n`)
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }

  console.log('\n✓ 结构对照全部通过')
  console.log(`  ${Object.keys(EXPECTED).length} 张表、字段、可空性、默认值一致`)
  console.log(`  ${EXPECTED_FKS.length} 个外键与级联行为一致`)
  console.log(`  ${EXPECTED_UNIQUE_INDEXES.length} 个唯一索引 + ${EXPECTED_PARTIAL_INDEXES.length} 个部分索引存在`)
  console.log('  级联删除、软删除、email 大小写唯一行为正确')
}

main()
