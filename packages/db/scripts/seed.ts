/**
 * 示例数据 seed（T1.4）。
 *
 * 1 个管理员 + 1 个示例空间 + 3 个示例文档。
 * 可重复执行：已存在的数据会被跳过。
 *
 * 通过 Repository 接口写入——seed 也是业务代码，不能直接用 Prisma Client
 * （架构文档不变式 I7）。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createPrismaClient, disconnectPrisma } from '../src/client.js'
import { createRepositories } from '../src/repo/implementations.js'
import { migrate } from './migrate.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')

/** 示例管理员。密码仅用于本地开发，生产环境必须改掉。 */
const ADMIN_EMAIL = 'admin@weshare.local'
const ADMIN_PASSWORD = 'admin12345'

/**
 * scrypt 密码哈希。
 *
 * 格式：scrypt$N$r$p$salt$hash
 * 参数 N=2^15（32768）——OWASP 推荐的 scrypt 最低配置。
 */
async function hashPassword(password: string): Promise<string> {
  const { scrypt, randomBytes } = await import('node:crypto')
  const N = 32768
  const r = 8
  const p = 1
  const keylen = 64
  const salt = randomBytes(16)
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

async function main(): Promise<void> {
  const dbPath = process.env.DB_PATH ?? path.resolve(PKG_ROOT, '../../data/weshare.db')

  // 先确保迁移已执行
  console.log('→ 检查迁移状态…')
  migrate(dbPath, false)

  const prisma = createPrismaClient({ dbPath })
  const repos = createRepositories(prisma)

  try {
    // --- 管理员 ---
    let user = await repos.users.findByEmail(ADMIN_EMAIL)
    if (user) {
      console.log(`→ 管理员已存在，跳过：${ADMIN_EMAIL}`)
    } else {
      user = await repos.users.create({
        id: randomUUID(),
        email: ADMIN_EMAIL,
        passwordHash: await hashPassword(ADMIN_PASSWORD),
        displayName: '管理员',
      })
      console.log(`→ 创建管理员：${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
    }

    // --- 示例空间 ---
    const spaces = await repos.workspaces.listForUser(user.id)
    let workspace = spaces.find((w) => w.name === '示例空间')
    if (workspace) {
      console.log('→ 示例空间已存在，跳过')
    } else {
      workspace = await repos.workspaces.create({
        id: randomUUID(),
        name: '示例空间',
        ownerId: user.id,
        defaultRole: 'edit',
      })
      console.log('→ 创建示例空间')
    }

    // --- 示例文档 ---
    const existing = await repos.nodes.listTree(workspace.id)
    for (const title of ['产品需求文档', '会议纪要', '技术方案']) {
      if (existing.some((n) => n.title === title)) {
        console.log(`→ 文档已存在，跳过：${title}`)
        continue
      }
      const node = await repos.nodes.create({
        id: randomUUID(),
        workspaceId: workspace.id,
        type: 'doc',
        title,
        ownerId: user.id,
      })
      await repos.contents.create({
        nodeId: node.id,
        contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
      })
      console.log(`→ 创建文档：${title}`)
    }

    console.log('\n✓ seed 完成')
    console.log(`  登录账号：${ADMIN_EMAIL}`)
    console.log(`  登录密码：${ADMIN_PASSWORD}`)
  } finally {
    await disconnectPrisma()
  }
}

main().catch((err) => {
  console.error('✗ seed 失败：', err)
  process.exit(1)
})

