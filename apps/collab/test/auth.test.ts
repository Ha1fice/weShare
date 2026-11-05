/**
 * 协同鉴权测试。
 *
 * 覆盖三条防线里最关键的两条：Origin 白名单（防跨站 WS 劫持）与
 * 角色判定（只读由服务端强制）。这两条任何一条失效，文档就被人看光了。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Repositories } from '@weshare/db'
import { checkOrigin, parseAllowedOrigins } from '../src/auth/origin.js'
import { parseDocumentName, toDocumentName } from '../src/doc-name.js'
import { resolveSession } from '../src/session.js'
import { CollabAuth } from '../src/auth/service.js'
import {
  createCollabTestContext,
  createSession,
  createUser,
  createWorkspaceWithDoc,
  type CollabTestContext,
} from './fixture.js'

let ctx: CollabTestContext
let repos: Repositories

beforeAll(async () => {
  ctx = await createCollabTestContext()
  repos = ctx.db.repos
})

beforeEach(async () => {
  await ctx.reset()
})

afterAll(async () => {
  await ctx.close()
})

const auth = () => new CollabAuth({ repos, resolveSession: (t) => resolveSession(repos, t) })

// ---------------------------------------------------------------- Origin

describe('Origin 白名单', () => {
  const allowed = parseAllowedOrigins('http://127.0.0.1:5173, https://doc.example.com/')

  it('解析时去空白、去尾斜杠、转小写', () => {
    expect(allowed).toEqual(['http://127.0.0.1:5173', 'https://doc.example.com'])
  })

  it('白名单内的 Origin 放行', () => {
    expect(checkOrigin('http://127.0.0.1:5173', allowed)).toEqual({ ok: true })
    expect(checkOrigin('https://doc.example.com', allowed)).toEqual({ ok: true })
  })

  it('白名单外的 Origin 拒绝（这就是跨站 WS 劫持的攻击面）', () => {
    const r = checkOrigin('https://evil.example.com', allowed)
    expect(r).toEqual({ ok: false, reason: 'not-allowed' })
  })

  it('Origin 缺失也拒绝（不放行无 Origin 的非浏览器客户端）', () => {
    expect(checkOrigin(null, allowed)).toEqual({ ok: false, reason: 'missing-origin' })
    expect(checkOrigin(undefined, allowed)).toEqual({ ok: false, reason: 'missing-origin' })
  })

  it('白名单为空时一律拒绝（fail-closed，不是放行）', () => {
    expect(checkOrigin('http://127.0.0.1:5173', [])).toEqual({
      ok: false,
      reason: 'not-configured',
    })
  })
})

// ---------------------------------------------------------------- 文档名

describe('文档名映射', () => {
  it('往返一致', () => {
    expect(parseDocumentName(toDocumentName('abc-123'))).toBe('abc-123')
  })

  it('缺少前缀返回 null', () => {
    expect(parseDocumentName('abc-123')).toBeNull()
  })

  it('空 id 返回 null', () => {
    expect(parseDocumentName('node:')).toBeNull()
  })
})

// ---------------------------------------------------------------- 会话

describe('会话解析', () => {
  it('有效 token 解析出用户', async () => {
    await createUser(ctx.db, { id: 'u1', email: 'u1@example.com', displayName: 'A' })
    const token = await createSession(ctx.db, 'u1')

    const resolved = await resolveSession(repos, token)
    expect(resolved?.userId).toBe('u1')
  })

  it('无效 token 返回 null', async () => {
    expect(await resolveSession(repos, 'bogus')).toBeNull()
  })

  it('空 token 返回 null', async () => {
    expect(await resolveSession(repos, '')).toBeNull()
  })
})

// ---------------------------------------------------------------- 授权

describe('协同授权', () => {
  it('空间所有者可以写', async () => {
    await createUser(ctx.db, { id: 'owner', email: 'o@example.com', displayName: '所有者' })
    const { nodeId } = await createWorkspaceWithDoc(ctx.db, 'owner')
    const token = await createSession(ctx.db, 'owner')

    const result = await auth().authorize(nodeId, `weshare_session=${token}`)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.canWrite).toBe(true)
      expect(result.role).toBe('manage')
    }
  })

  it('只读成员拿到只读连接（canWrite = false）', async () => {
    await createUser(ctx.db, { id: 'owner', email: 'o@example.com', displayName: '所有者' })
    await createUser(ctx.db, { id: 'viewer', email: 'v@example.com', displayName: '只读' })
    const { nodeId, workspaceId } = await createWorkspaceWithDoc(ctx.db, 'owner')
    await repos.workspaces.upsertMember({ workspaceId, userId: 'viewer', role: 'viewer' })

    const token = await createSession(ctx.db, 'viewer')
    const result = await auth().authorize(nodeId, `weshare_session=${token}`)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.canWrite).toBe(false)
      expect(result.role).toBe('view')
    }
  })

  it('非成员得到 not-found（不泄露文档存在）', async () => {
    await createUser(ctx.db, { id: 'owner', email: 'o@example.com', displayName: '所有者' })
    await createUser(ctx.db, { id: 'outsider', email: 'x@example.com', displayName: '外部' })
    const { nodeId } = await createWorkspaceWithDoc(ctx.db, 'owner')

    const token = await createSession(ctx.db, 'outsider')
    const result = await auth().authorize(nodeId, `weshare_session=${token}`)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-found')
  })

  it('没有 Cookie 得到 unauthenticated', async () => {
    const result = await auth().authorize('whatever', undefined)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unauthenticated')
  })

  it('会话已失效得到 unauthenticated', async () => {
    const result = await auth().authorize('whatever', 'weshare_session=stale-token')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unauthenticated')
  })

  it('已删除文档不给出可写连接', async () => {
    await createUser(ctx.db, { id: 'owner', email: 'o@example.com', displayName: '所有者' })
    const { nodeId } = await createWorkspaceWithDoc(ctx.db, 'owner')
    await repos.nodes.softDelete({
      id: nodeId,
      deletedAt: new Date(),
      deletedBy: 'owner',
      trashRootId: nodeId,
    })

    const token = await createSession(ctx.db, 'owner')
    const result = await auth().authorize(nodeId, `weshare_session=${token}`)

    // 回收站里的文档只有 manage 能读，但协同不该让人编辑它
    if (result.ok) {
      expect(result.canWrite).toBe(false)
    } else {
      expect(result.reason).toBe('not-found')
    }
  })

  it('ACL deny 能把成员压到只读（与 REST 同一份算法）', async () => {
    await createUser(ctx.db, { id: 'owner', email: 'o@example.com', displayName: '所有者' })
    await createUser(ctx.db, { id: 'member', email: 'm@example.com', displayName: '成员' })
    const { nodeId, workspaceId } = await createWorkspaceWithDoc(ctx.db, 'owner')
    await repos.workspaces.upsertMember({ workspaceId, userId: 'member', role: 'member' })
    await repos.acl.upsert({
      id: 'acl-1',
      nodeId,
      subjectType: 'user',
      subjectId: 'member',
      role: 'view',
      effect: 'deny',
      createdBy: 'owner',
    })

    const token = await createSession(ctx.db, 'member')
    const result = await auth().authorize(nodeId, `weshare_session=${token}`)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.canWrite).toBe(false)
  })

  it('dev 裸名 Cookie 也能识别（部署环境变化不掉线）', async () => {
    await createUser(ctx.db, { id: 'owner', email: 'o@example.com', displayName: '所有者' })
    const { nodeId } = await createWorkspaceWithDoc(ctx.db, 'owner')
    const token = await createSession(ctx.db, 'owner')

    const result = await auth().authorize(nodeId, `weshare_session=${token}`)
    expect(result.ok).toBe(true)
  })
})
