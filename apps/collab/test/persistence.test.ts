/**
 * 落库与迁移桥测试。
 *
 * 三件必须成立的事：
 *   1. 装载能把 `content_json` 迁进 Y.Doc，且用与前端一致的 PM Schema；
 *   2. 迁移只发生一次，并发首次打开不产生重复内容（R16）；
 *   3. 落库后 `yjs_state` 非空，`content_json` 被派生为镜像。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { Repositories } from '@weshare/db'
import { Persistence, PROSEMIRROR_FRAGMENT, pmJsonToPlainText, EMPTY_DOC_JSON } from '../src/persistence.js'
import { toDocumentName } from '../src/doc-name.js'
import {
  createCollabTestContext,
  createUser,
  createWorkspaceWithDoc,
  type CollabTestContext,
} from './fixture.js'

let ctx: CollabTestContext
let repos: Repositories
let persistence: Persistence

beforeAll(async () => {
  ctx = await createCollabTestContext()
  repos = ctx.db.repos
  persistence = new Persistence({ repos })
})

beforeEach(async () => {
  await ctx.reset()
})

afterAll(async () => {
  await ctx.close()
})

const paraDoc = (lines: string[]) => ({
  type: 'doc',
  content: lines.map((line) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: line }],
  })),
})

/** 取 Y.Doc 里的纯文本（走 y-prosemirror 的正式路径）。 */
async function textOf(doc: Y.Doc): Promise<string> {
  const { yXmlFragmentToProsemirrorJSON } = await import('y-prosemirror')
  const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(PROSEMIRROR_FRAGMENT))
  return pmJsonToPlainText(json)
}

describe('pmJsonToPlainText', () => {
  it('多段落用换行分隔', () => {
    expect(pmJsonToPlainText(paraDoc(['第一段', '第二段']))).toBe('第一段\n第二段')
  })

  it('空文档得到空串', () => {
    expect(pmJsonToPlainText({ type: 'doc', content: [] })).toBe('')
  })

  it('非对象输入不抛错', () => {
    expect(pmJsonToPlainText(null)).toBe('')
    expect(pmJsonToPlainText('x')).toBe('')
  })
})

describe('迁移桥', () => {
  it('Phase 2 的 content_json 被迁进 Y.Doc', async () => {
    await createUser(ctx.db, { id: 'u1', email: 'u@example.com', displayName: 'A' })
    const { nodeId } = await createWorkspaceWithDoc(ctx.db, 'u1', {
      contentJson: paraDoc(['历史内容一', '历史内容二']),
    })

    const doc = new Y.Doc()
    await persistence.load({
      document: doc as never,
      documentName: toDocumentName(nodeId),
      context: { nodeId },
    })

    const text = await textOf(doc)
    expect(text).toContain('历史内容一')
    expect(text).toContain('历史内容二')
  })

  it('迁移后 yjs_state 落库（文档从此是协同文档）', async () => {
    await createUser(ctx.db, { id: 'u1', email: 'u@example.com', displayName: 'A' })
    const { nodeId } = await createWorkspaceWithDoc(ctx.db, 'u1', {
      contentJson: paraDoc(['迁移我']),
    })

    const doc = new Y.Doc()
    await persistence.load({
      document: doc as never,
      documentName: toDocumentName(nodeId),
      context: { nodeId },
    })

    const row = await repos.contents.findByNodeId(nodeId)
    expect(row?.yjsState).not.toBeNull()
    expect(row?.textPreview).toContain('迁移我')
  })

  it('已是协同文档时直接回放 yjs_state', async () => {
    await createUser(ctx.db, { id: 'u1', email: 'u@example.com', displayName: 'A' })
    const { nodeId } = await createWorkspaceWithDoc(ctx.db, 'u1', {
      contentJson: paraDoc(['旧内容']),
    })

    const first = new Y.Doc()
    await persistence.load({
      document: first as never,
      documentName: toDocumentName(nodeId),
      context: { nodeId },
    })

    const second = new Y.Doc()
    await persistence.load({
      document: second as never,
      documentName: toDocumentName(nodeId),
      context: { nodeId },
    })

    expect(await textOf(second)).toBe(await textOf(first))
    expect((await textOf(second)).split('旧内容').length - 1).toBe(1)
  })

  it('两个客户端同时首次打开：内容不重复、不丢（R16 并发用例）', async () => {
    await createUser(ctx.db, { id: 'u1', email: 'u@example.com', displayName: 'A' })
    const { nodeId } = await createWorkspaceWithDoc(ctx.db, 'u1', {
      contentJson: paraDoc(['并发迁移']),
    })

    const a = new Y.Doc()
    const b = new Y.Doc()
    await Promise.all([
      persistence.load({ document: a as never, documentName: toDocumentName(nodeId), context: { nodeId } }),
      persistence.load({ document: b as never, documentName: toDocumentName(nodeId), context: { nodeId } }),
    ])

    // 数据库里的迁移结果只应含一份
    const row = await repos.contents.findByNodeId(nodeId)
    const stored = new Y.Doc()
    Y.applyUpdate(stored, new Uint8Array(row!.yjsState!))
    expect((await textOf(stored)).split('并发迁移').length - 1).toBe(1)

    // 两个客户端的装载结果各自也只有一份
    expect((await textOf(a)).split('并发迁移').length - 1).toBe(1)
    expect((await textOf(b)).split('并发迁移').length - 1).toBe(1)
  })

  it('claimCollaborative 的第二个调用者拿不到资格', async () => {
    await createUser(ctx.db, { id: 'u1', email: 'u@example.com', displayName: 'A' })
    const { nodeId } = await createWorkspaceWithDoc(ctx.db, 'u1')

    const first = await repos.contents.claimCollaborative({
      nodeId,
      yjsState: new Uint8Array([1]),
      stateVector: new Uint8Array([2]),
    })
    const second = await repos.contents.claimCollaborative({
      nodeId,
      yjsState: new Uint8Array([3]),
      stateVector: new Uint8Array([4]),
    })

    expect(first).toBe(true)
    expect(second).toBe(false)
  })
})

describe('落库', () => {
  it('把 Y.Doc 状态写回数据库，并派生 content_json 镜像', async () => {
    await createUser(ctx.db, { id: 'u1', email: 'u@example.com', displayName: 'A' })
    const { nodeId } = await createWorkspaceWithDoc(ctx.db, 'u1')

    const doc = new Y.Doc()
    await persistence.load({
      document: doc as never,
      documentName: toDocumentName(nodeId),
      context: { nodeId },
    })

    // 模拟用户编辑：往 fragment 里插一段
    const { prosemirrorJSONToYXmlFragment } = await import('y-prosemirror')
    const fragment = doc.getXmlFragment(PROSEMIRROR_FRAGMENT)
    fragment.delete(0, fragment.length)
    prosemirrorJSONToYXmlFragment(
      (await import('../src/schema.js')).buildProseMirrorSchema(),
      paraDoc(['用户写的内容']) as never,
      fragment,
    )

    await persistence.store({ document: doc as never, documentName: toDocumentName(nodeId) })

    const row = await repos.contents.findByNodeId(nodeId)
    expect(row?.yjsState).not.toBeNull()
    expect(row?.textPreview).toContain('用户写的内容')
    // content_json 被派生为镜像（不再是初始空文档）
    expect(JSON.stringify(row?.contentJson)).toContain('用户写的内容')

    // 重新装载后内容仍在
    const again = new Y.Doc()
    await persistence.load({
      document: again as never,
      documentName: toDocumentName(nodeId),
      context: { nodeId },
    })
    expect(await textOf(again)).toContain('用户写的内容')
  })

  it('非法文档名不落库（不抛错）', async () => {
    const doc = new Y.Doc()
    await expect(
      persistence.store({ document: doc as never, documentName: 'garbage' }),
    ).resolves.toBeUndefined()
  })

  it('EMPTY_DOC_JSON 是合法 PM 结构（与 api 侧一致）', () => {
    expect(EMPTY_DOC_JSON.type).toBe('doc')
    expect(Array.isArray(EMPTY_DOC_JSON.content)).toBe(true)
  })
})
