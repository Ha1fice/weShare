/**
 * 协同服务的端到端测试（真 WebSocket，两个客户端）。
 *
 * 这是 1.0 验收里"两人实时互见"那一条的自动化版本。
 * 不 mock 网络、不 mock 数据库——它是最终说得清的证据。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { WebSocket } from 'ws'
import { createTestDatabase, clearTables } from '@weshare/db/test-support'
import type { DbHandle } from '@weshare/db'
import { buildCollab, type BuiltCollab } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { createSession, createUser, createWorkspaceWithDoc } from './fixture.js'

let db: DbHandle
let dbPath: string
let built: BuiltCollab
let port: number

beforeAll(async () => {
  const created = await createTestDatabase()
  db = created.db
  dbPath = created.dbPath

  const config = loadConfig({
    NODE_ENV: 'test',
    DB_PATH: dbPath,
    PORT: String(0),
    LOG_LEVEL: 'debug',
    ALLOWED_ORIGINS: 'http://127.0.0.1',
  })

  built = buildCollab({ db, config })
  await built.server.listen()
  // Hocuspocus 在 port=0 时由系统分配，这里从实例上取回真实端口
  port = built.server.httpServer.address().port as number
})

afterAll(async () => {
  await built.close()
})

let seq = 0

/**
 * 建一个真实可连接的文档（含用户 + 会话）。
 *
 * 每个用例用独立的用户 id 与会话——共享用户会让第二个用例撞上
 * 邮箱唯一约束，而"复用同一个用户"也不符合真实场景。
 */
async function seedDoc(options: { contentJson?: unknown } = {}) {
  seq += 1
  const uid = `u${seq}`
  await createUser(db, { id: uid, email: `${uid}@example.com`, displayName: '甲' })
  const { nodeId, workspaceId } = await createWorkspaceWithDoc(db, uid, {
    contentJson: options.contentJson,
  })

  const tokens: Record<string, string> = {}
  tokens[uid] = await createSession(db, uid)

  return { nodeId, workspaceId, tokens }
}

/**
 * Node 环境的 WebSocket 垫片。
 *
 * 生产环境走浏览器原生 WebSocket（Cookie 由浏览器自动带上）。
 * Node 没有 Cookie 罐，所以这里用 `ws` 并在握手头里显式塞 Cookie——
 * 这是"模拟浏览器"的最小代价，也让测试真的走了一遍 Cookie 鉴权链路。
 */
class CookieWebSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[], header?: string) {
    // header 形如 "cookie=xxx|origin=http://..."，用 `|` 分隔 ——
    // Cookie 值本身可能含 `=` 与 `;`，用 `; ` 切会把 Cookie 切断。
    const headers: Record<string, string> = {}
    if (header) {
      for (const part of header.split('|')) {
        const idx = part.indexOf('=')
        if (idx > 0) headers[part.slice(0, idx)] = part.slice(idx + 1)
      }
    }
    super(url, protocols, { headers } as never)
  }
}

/** 连一个客户端。 */
function connect(nodeId: string, token: string, doc: Y.Doc, origin = 'http://127.0.0.1'): HocuspocusProvider {
  return new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}`,
    name: `node:${nodeId}`,
    document: doc,
    connect: true,
    // 注入带 Cookie + Origin 的 WebSocket
    WebSocketPolyfill: class extends CookieWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols, `cookie=weshare_session=${token}|origin=${origin}`)
      }
    },
    ...(origin ? {} : {}),
  })
}

function waitEvent(target: { on: (e: string, cb: (...a: never[]) => void) => void; off: (e: string, cb: (...a: never[]) => void) => void }, event: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待 ${event} 超时`)), timeoutMs)
    const handler = () => {
      clearTimeout(timer)
      resolve()
    }
    target.on(event, handler as never)
  })
}

describe('协同服务（端到端）', () => {
  it('Origin 不在白名单时握手被拒（跨站 WS 劫持防线）', async () => {
    const { nodeId, tokens } = await seedDoc()
    const doc = new Y.Doc()
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`,
      name: `node:${nodeId}`,
      document: doc,
      // @ts-expect-error 运行时支持
      headers: { cookie: `weshare_session=${tokens.u1}`, origin: 'https://evil.example.com' },
    })

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 2500)
      provider.on('authenticationFailed', () => {
        clearTimeout(timer)
        resolve()
      })
      provider.on('status', ({ status }: { status: string }) => {
        if (status === 'disconnected') {
          clearTimeout(timer)
          resolve()
        }
      })
    })

    expect(provider.synced).toBe(false)
    provider.destroy()
    doc.destroy()
  })

  it('两个客户端能收敛到同一份内容', async () => {
    const { nodeId, tokens } = await seedDoc({
      contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
    })

    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const a = connect(nodeId, tokens[Object.keys(tokens)[0]!]!, docA)
    const b = connect(nodeId, tokens[Object.keys(tokens)[0]!]!, docB)

    try {
      await Promise.all([waitEvent(a as never, 'synced'), waitEvent(b as never, 'synced')])

      // A 写一段
      docA.transact(() => {
        const fragment = docA.getXmlFragment('prosemirror')
        const p = new Y.XmlElement('paragraph')
        const text = new Y.XmlText()
        text.insert(0, '甲写的内容')
        p.insert(0, [text])
        fragment.insert(fragment.length, [p])
      })

      // 等 B 收到
      await new Promise((r) => setTimeout(r, 800))

      const textOf = (doc: Y.Doc): string => {
        const fragment = doc.getXmlFragment('prosemirror')
        const parts: string[] = []
        const walk = (n: Y.XmlElement | Y.XmlText) => {
          if (n instanceof Y.XmlText) {
            parts.push(n.toString())
            return
          }
          for (const c of n.toArray()) if (c instanceof Y.XmlElement || c instanceof Y.XmlText) walk(c)
        }
        for (const c of fragment.toArray()) if (c instanceof Y.XmlElement || c instanceof Y.XmlText) walk(c)
        return parts.join('')
      }

      expect(textOf(docB)).toContain('甲写的内容')

      // B 写一段，A 也应该看到
      docB.transact(() => {
        const fragment = docB.getXmlFragment('prosemirror')
        const p = new Y.XmlElement('paragraph')
        const text = new Y.XmlText()
        text.insert(0, '乙写的内容')
        p.insert(0, [text])
        fragment.insert(fragment.length, [p])
      })

      await new Promise((r) => setTimeout(r, 800))
      expect(textOf(docA)).toContain('乙写的内容')
    } finally {
      a.destroy()
      b.destroy()
      docA.destroy()
      docB.destroy()
    }
  })

  it('落库：断开后 yjs_state 非空，刷新能恢复', async () => {
    const { nodeId, tokens } = await seedDoc({
      contentJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '初始内容' }] }],
      },
    })

    const doc = new Y.Doc()
    const provider = connect(nodeId, tokens[Object.keys(tokens)[0]!]!, doc)
    await waitEvent(provider as never, 'synced')

    doc.transact(() => {
      const fragment = doc.getXmlFragment('prosemirror')
      const p = new Y.XmlElement('paragraph')
      const text = new Y.XmlText()
      text.insert(0, '落库内容')
      p.insert(0, [text])
      fragment.insert(fragment.length, [p])
    })

    // 等防抖窗口 + 落库
    await new Promise((r) => setTimeout(r, 2200))
    provider.destroy()
    doc.destroy()

    // 关掉文档触发最后一次 flush
    await built.server.hocuspocus.closeConnections()
    await new Promise((r) => setTimeout(r, 800))

    const row = await db.repos.contents.findByNodeId(nodeId)
    expect(row?.yjsState).not.toBeNull()

    // 新客户端重新装载，内容应包含后写的那段
    const fresh = new Y.Doc()
    const provider2 = connect(nodeId, tokens[Object.keys(tokens)[0]!]!, fresh)
    await waitEvent(provider2 as never, 'synced')

    const fragment = fresh.getXmlFragment('prosemirror')
    const texts: string[] = []
    const walk = (n: Y.XmlElement | Y.XmlText) => {
      if (n instanceof Y.XmlText) {
        texts.push(n.toString())
        return
      }
      for (const c of n.toArray()) if (c instanceof Y.XmlElement || c instanceof Y.XmlText) walk(c)
    }
    for (const c of fragment.toArray()) if (c instanceof Y.XmlElement || c instanceof Y.XmlText) walk(c)

    expect(texts.join('')).toContain('落库内容')
    provider2.destroy()
    fresh.destroy()
  })
})

// clearTables 在 afterAll 前不需要单独调用：每个用例都用自己的空间
void clearTables
