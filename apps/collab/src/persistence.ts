/**
 * 协同落库。
 *
 * ## 内容模型
 *
 * 正文在 Y.Doc 里是 `Y.XmlFragment('prosemirror')`，通过 **y-prosemirror**
 * 与 ProseMirror JSON 互转。这是业界标准做法，好处是：
 *   - 并发编辑按字符级 CRDT 合并，不会因为"两个人同时在一个段落里插入"
 *     而互相覆盖；
 *   - Y.Doc 与 PM JSON 的转换是双向确定的，服务端可以随时从 Y.Doc 派生出
 *     只读镜像（`content_json`），而不需要跑一个编辑器实例。
 *
 * Schema 必须与前端完全一致（见 `schema.ts`），否则转换时会丢节点。
 *
 * ## 两个钩子
 *
 * - **onLoadDocument**：`yjs_state` 有 → 直接回放；没有但有 `content_json`
 *   → **迁移桥**（Phase 2 → 3 一次性迁移）；两者都空 → 新文档。
 * - **onStoreDocument**：Y.Doc 编码写回 `yjs_state`，同时派生 `content_json`
 *   镜像 + `text_preview`。派生失败不得回滚事实源（架构文档 §5.4）。
 *
 * ## 迁移桥的并发（架构文档 §13 R16）
 *
 * 两个客户端同时首次打开时，各自会从 `content_json` 建一份 Y.Doc。
 * 若都写入，合并后文本会重复。两层保证：
 *   1. 进程内：`loading` 表按 nodeId 串行化，后到者等前者完成后再从数据库回放；
 *   2. 跨进程：`claimCollaborative` 条件更新（`yjs_state IS NULL`），
 *      没抢到的放弃自己的迁移结果，改为回放数据库里的那份。
 */

import * as Y from 'yjs'
import type { Document } from '@hocuspocus/server'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror'
import type { Node as PMNode, Schema } from 'prosemirror-model'
import type { Repositories } from '@weshare/db'
import { extractPlainText } from '@weshare/shared'
import { buildProseMirrorSchema } from './schema.js'
import { parseDocumentName } from './doc-name.js'

/** 正文在 Y.Doc 里的 fragment 名。与前端 `editor/collab.ts` 必须一致。 */
export const PROSEMIRROR_FRAGMENT = 'prosemirror'

export interface PersistenceOptions {
  repos: Repositories
  /**
   * 可注入的 Schema（测试用）。
   *
   * 不注入时用与前端一致的那份构造——**不要**在测试里换成别的 Schema，
   * 那样测的就不是生产路径了。
   */
  schema?: Schema
}

export interface LoadInput {
  document: Document
  documentName: string
  context?: { nodeId?: string }
}

export interface StoreInput {
  document: Document
  documentName: string
}

/**
 * 从 PM JSON 抽取纯文本（迁移与摘要用）。
 *
 * 不引编辑器：只按块结构把文字排出来。迁移只需要"用户能看到什么"。
 */
const BLOCK_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'codeBlock',
  'blockquote',
  'listItem',
  'bulletList',
  'orderedList',
  'horizontalRule',
])

export function pmJsonToPlainText(doc: unknown): string {
  const lines: string[] = []

  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const n = node as { type?: unknown; text?: unknown; content?: unknown }

    if (typeof n.text === 'string') {
      if (lines.length === 0) lines.push('')
      lines[lines.length - 1] += n.text
      return
    }

    const isBlock = typeof n.type === 'string' && BLOCK_TYPES.has(n.type)
    if (isBlock && n.type !== 'doc') lines.push('')

    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child)
    }

    if (isBlock && n.type !== 'doc' && lines.length > 0 && lines[lines.length - 1] !== '') {
      lines.push('')
    }
  }

  walk(doc)
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

/** 空文档结构。与 api 建文档时写入的一致。 */
export const EMPTY_DOC_JSON = { type: 'doc', content: [{ type: 'paragraph' }] }

export class Persistence {
  private readonly repos: Repositories
  private readonly schema: Schema

  /**
   * 每个 nodeId 一个装载中的 Promise。
   *
   * 用 Map 而不是 Set：并发的第二次打开要**等同一个结果**再回放，
   * 不是"看到标记就自己再跑一遍"——后者等于没有串行化。
   */
  private readonly loading = new Map<string, Promise<void>>()

  constructor(options: PersistenceOptions) {
    this.repos = options.repos
    this.schema = options.schema ?? buildProseMirrorSchema()
  }

  // ------------------------------------------------------------ 装载
  async load(payload: LoadInput): Promise<void> {
    const nodeId = payload.context?.nodeId ?? parseDocumentName(payload.documentName)
    if (!nodeId) return

    const existing = this.loading.get(nodeId)
    if (existing) {
      // 已有装载在跑：等它完成，再从数据库回放。
      //
      // 不依赖"同一个 documentName 在 Hocuspocus 里是同一个 Document"这个事实：
      // 进程内并发与跨进程并发统一走"从数据库回放"，才是唯一可靠的收敛点。
      await existing
      await this.replay(nodeId, payload.document)
      return
    }

    const task = this.doLoad(nodeId, payload.document).finally(() => {
      this.loading.delete(nodeId)
    })
    this.loading.set(nodeId, task)
    await task
  }

  private async replay(nodeId: string, document: Document): Promise<void> {
    const row = await this.repos.contents.findByNodeId(nodeId)
    if (!row?.yjsState) return
    Y.applyUpdate(document, new Uint8Array(row.yjsState), 'load')
  }

  private async doLoad(nodeId: string, document: Document): Promise<void> {
    const row = await this.repos.contents.findByNodeId(nodeId)
    if (!row) return

    if (row.yjsState !== null) {
      Y.applyUpdate(document, new Uint8Array(row.yjsState), 'load')
      return
    }

    // ---- 迁移桥：Phase 2 的 content_json → Y.Doc ----
    const json = (row.contentJson ?? EMPTY_DOC_JSON) as Record<string, unknown>
    const fragment = document.getXmlFragment(PROSEMIRROR_FRAGMENT)

    if (fragment.length === 0) {
      // 借助 y-prosemirror 把 PM JSON 灌进 fragment。
      // 它会在内部用一个临时 Y.Doc，这里用 transact 把变更搬到真实 doc 上，
      // 保证所有改动归到同一个 origin。
      prosemirrorJSONToYXmlFragment(this.schema, json as never, fragment)
    }

    const text = pmJsonToPlainText(json)
    const state = Y.encodeStateAsUpdate(document)

    const claimed = await this.repos.contents.claimCollaborative({
      nodeId,
      yjsState: state,
      stateVector: Y.encodeStateVector(document),
      textPreview: text.slice(0, 200),
      charCount: text.length,
      docSizeBytes: state.byteLength,
    })

    if (!claimed) {
      // 别人先迁移了：以数据库那份为准，丢弃本地迁移结果，
      // 否则两份初始内容合并会变成重复文本。
      fragment.delete(0, fragment.length)
      const latest = await this.repos.contents.findByNodeId(nodeId)
      if (latest?.yjsState) {
        Y.applyUpdate(document, new Uint8Array(latest.yjsState), 'migration-loser')
      }
      return
    }

    // 迁移完成：把最终状态驻进数据库，之后所有客户端都从 yjs_state 回放。
    const finalState = Y.encodeStateAsUpdate(document)
    await this.repos.contents.saveCollaborative({
      nodeId,
      yjsState: finalState,
      stateVector: Y.encodeStateVector(document),
      textPreview: text.slice(0, 200),
      charCount: text.length,
      docSizeBytes: finalState.byteLength,
    })
  }

  // ------------------------------------------------------------ 落库
  async store(payload: StoreInput): Promise<void> {
    // onStoreDocument 不带 context（只有 lastContext），节点 id 由文档名解析——
    // 这也是 documentName 要有固定前缀的原因。
    const nodeId = parseDocumentName(payload.documentName)
    if (!nodeId) return

    const state = Y.encodeStateAsUpdate(payload.document)

    // 派生镜像：`content_json` 是只读投影，供列表摘要与将来搜索用。
    // 派生失败**不能**回滚 yjs_state —— 事实源优先（架构文档 §5.4）。
    let mirror: unknown
    let text = ''
    try {
      const json = yXmlFragmentToProsemirrorJSON(payload.document.getXmlFragment(PROSEMIRROR_FRAGMENT))
      mirror = json
      text = extractPlainText(json as PMNode | unknown)
    } catch {
      // 结构化派生失败：至少把纯文本留下
      mirror = undefined
    }

    await this.repos.contents.saveCollaborative({
      nodeId,
      yjsState: state,
      stateVector: Y.encodeStateVector(payload.document),
      ...(mirror !== undefined ? { contentJson: mirror } : {}),
      ...(text ? { textPreview: text.slice(0, 200), charCount: text.length } : {}),
      docSizeBytes: state.byteLength,
    })
  }

  /** 优雅关闭时用：等所有在途装载结束。 */
  async drain(): Promise<void> {
    await Promise.all([...this.loading.values()])
  }
}
