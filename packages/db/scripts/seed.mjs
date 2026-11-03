/**
 * 示例数据 seed（T1.4）。
 *
 * 1 个管理员 + 1 个示例空间 + 3 个示例文档。
 * 可重复执行：已存在的数据会被跳过。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { openDb, closeDb, DEFAULT_DB_PATH } from '../src/driver.sqlite.js'
import {
  users,
  workspaces,
  workspaceMembers,
  nodes,
  documentContents,
} from '../src/schema/sqlite.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.resolve(HERE, '..', 'migrations')

/** 示例管理员。密码为明文，仅用于本地开发，生产环境必须改掉。 */
const ADMIN_EMAIL = 'admin@weshare.local'
const ADMIN_PASSWORD = 'admin12345'

/**
 * scrypt 密码哈希。
 *
 * 格式：scrypt$N$r$p$salt$hash
 * 参数选 N=2^15（32768）——OWASP 推荐的 scrypt 最低配置。
 */
async function hashPassword(password) {
  const { scrypt, randomBytes } = await import('node:crypto')
  const N = 32768
  const r = 8
  const p = 1
  const keylen = 64
  const salt = randomBytes(16)
  const derived = await new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

async function main() {
  const dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH
  const handle = await openDb(dbPath)
  const { db, client } = handle

  try {
    // 先确保迁移已执行
    const { migrate } = await import('drizzle-orm/libsql/migrator')
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR })

    const now = new Date()

    // --- 管理员 ---
    const existingUser = await client.execute({
      sql: 'select id from users where email = ?',
      args: [ADMIN_EMAIL],
    })
    let userId
    if (existingUser.rows.length > 0) {
      userId = String(existingUser.rows[0].id)
      console.log(`→ 管理员已存在，跳过：${ADMIN_EMAIL}`)
    } else {
      userId = randomUUID()
      await db.insert(users).values({
        id: userId,
        email: ADMIN_EMAIL,
        passwordHash: await hashPassword(ADMIN_PASSWORD),
        displayName: '管理员',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      console.log(`→ 创建管理员：${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
    }

    // --- 示例空间 ---
    const existingWs = await client.execute({
      sql: 'select id from workspaces where name = ?',
      args: ['示例空间'],
    })
    let workspaceId
    if (existingWs.rows.length > 0) {
      workspaceId = String(existingWs.rows[0].id)
      console.log('→ 示例空间已存在，跳过')
    } else {
      workspaceId = randomUUID()
      await db.insert(workspaces).values({
        id: workspaceId,
        name: '示例空间',
        ownerId: userId,
        defaultRole: 'edit',
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(workspaceMembers).values({
        workspaceId,
        userId,
        role: 'owner',
        createdAt: now,
      })
      console.log('→ 创建示例空间')
    }

    // --- 示例文档 ---
    const docs = ['产品需求文档', '会议纪要', '技术方案']
    for (const title of docs) {
      const existing = await client.execute({
        sql: 'select id from nodes where workspace_id = ? and title = ? and type = ?',
        args: [workspaceId, title, 'doc'],
      })
      if (existing.rows.length > 0) {
        console.log(`→ 文档已存在，跳过：${title}`)
        continue
      }
      const nodeId = randomUUID()
      await db.insert(nodes).values({
        id: nodeId,
        workspaceId,
        parentId: null,
        type: 'doc',
        title,
        titleNorm: title.toLowerCase(),
        ownerId: userId,
        visibility: 'workspace',
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      })
      await db.insert(documentContents).values({
        nodeId,
        contentSchemaVersion: 1,
        yjsSchemaVersion: 1,
        contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
        revision: 0,
        charCount: 0,
        updatedAt: now,
      })
      console.log(`→ 创建文档：${title}`)
    }

    console.log('\n✓ seed 完成')
    console.log(`  登录账号：${ADMIN_EMAIL}`)
    console.log(`  登录密码：${ADMIN_PASSWORD}`)
  } finally {
    await closeDb(handle)
  }
}

main().catch((err) => {
  console.error('✗ seed 失败：', err)
  process.exit(1)
})
