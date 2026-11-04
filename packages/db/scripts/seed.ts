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
import { createRepositories } from '../src/repo/index.js'
import { ARGON2_PARAMS } from '@weshare/shared'
import { migrate } from './migrate.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')

/** 示例管理员。密码仅用于本地开发，生产环境必须改掉。 */
const ADMIN_EMAIL = 'admin@weshare.local'
const ADMIN_PASSWORD = 'weshare-admin-2026'

/**
 * 密码哈希（Argon2id）。
 *
 * **必须与 apps/api 用同一算法与参数**——否则 seed 建的账号登不进去
 * （argon2.verify 解析不了 scrypt 串，登录会静默失败）。
 * 参数来自 @weshare/shared 的 ARGON2_PARAMS，单一真源。
 */
async function hashPassword(password: string): Promise<string> {
  const { default: argon2 } = await import('argon2')
  return argon2.hash(password, { type: argon2.argon2id, ...ARGON2_PARAMS })
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

