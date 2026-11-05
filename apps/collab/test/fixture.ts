/**
 * collab 集成测试夹具。
 *
 * 与 api 夹具同一思路：**真实数据库，不 mock**。
 * 协同的正确性全在"两个客户端编辑后收敛成同一状态""只读连接被拒"这类
 * 只有真跑才成立的地方。
 */
import { randomBytes, createHash } from 'node:crypto'
import { clearTables, createTestDatabase } from '@weshare/db/test-support'
import type { DbHandle } from '@weshare/db'
import { loadConfig, type CollabConfig } from '../src/config.js'

export interface CollabTestContext {
  db: DbHandle
  dbPath: string
  config: CollabConfig
  reset(): Promise<void>
  close(): Promise<void>
}

export async function createCollabTestContext(): Promise<CollabTestContext> {
  const { db, dbPath } = await createTestDatabase()

  const config = loadConfig({
    NODE_ENV: 'test',
    DB_PATH: dbPath,
    LOG_LEVEL: 'debug',
    ALLOWED_ORIGINS: 'http://127.0.0.1:5173',
  })

  return {
    db,
    dbPath,
    config,
    async reset() {
      await clearTables(dbPath)
    },
    async close() {
      await db.close()
    },
  }
}

/** 建用户。 */
export async function createUser(
  db: DbHandle,
  input: { id: string; email: string; displayName: string },
) {
  return db.repos.users.create({
    id: input.id,
    email: input.email,
    passwordHash: 'not-used-in-collab-tests',
    displayName: input.displayName,
  })
}

/** 建会话，返回明文 token。 */
export async function createSession(db: DbHandle, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db.repos.users.createSession({
    id: `s-${randomBytes(8).toString('hex')}`,
    userId,
    tokenHash: createHash('sha256').update(token, 'utf8').digest(),
    expiresAt: new Date(Date.now() + 3600_000),
    ip: null,
    userAgent: null,
  })
  return token
}

/** 建空间 + 一个文档节点。 */
export async function createWorkspaceWithDoc(
  db: DbHandle,
  ownerId: string,
  options: { contentJson?: unknown } = {},
) {
  const workspace = await db.repos.workspaces.create({
    id: `w-${randomBytes(4).toString('hex')}`,
    name: '协同测试空间',
    ownerId,
    defaultRole: 'edit',
  })

  const node = await db.repos.nodes.createDocument({
    id: `n-${randomBytes(4).toString('hex')}`,
    workspaceId: workspace.id,
    parentId: null,
    title: '协同文档',
    ownerId,
    visibility: 'workspace',
    type: 'doc',
    contentJson: options.contentJson ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  })

  return { workspaceId: workspace.id, nodeId: node.id }
}
