/**
 * 前端协同接入。
 *
 * 三件事，都是"要么不做，要么做对"的类型：
 *
 *   1. **Y.Doc 里的正文位置必须与服务端一致** —— `prosemirror` 这个
 *      XmlFragment 名两端都写死在常量里。一旦不一致，用户看到的是
 *      "连上了但内容永远是空的"。
 *
 *   2. **光标与服务端同步只走 Collaboration / CollaborationCaret** ——
 *      y-prosemirror 负责把 PM 事务翻译成 Y 更新，反向也负责。
 *      自己写 diff 同步必然在 IME 与并发场景下出问题（R4）。
 *
 *   3. **连接状态必须可观察** —— 断线时用户要知道自己在"离线编辑"，
 *      而不是以为内容已经存到服务器了。HocuspocusProvider 的 status 事件
 *      就是唯一事实源。
 */

import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'

/** Y.Doc 里正文 fragment 的名字。与服务端 `persistence.ts` 必须一致。 */
export const PROSEMIRROR_FRAGMENT = 'prosemirror'

/**
 * 协同草稿：新文档的第一段内容在客户端生成。
 *
 * 为什么需要它（不变式 I2 的前置条件）：
 *
 * 服务端靠 `yjs_state IS NULL` 判断"这篇还没进协同"。于是**协同没打开过的
 * 新文档**，REST 落库不会写 `yjs_state`——第一次进文档页时 `collabEnabled`
 * 仍是 false，前端就会走单机模式，永远迈不进协同。
 *
 * 反过来，只要第一次编辑发生在协同模式里，Y.Doc 就会落库，之后
 * `collabEnabled` 恒为 true。所以唯一要补的是"从没被协同打开过"这一个入口：
 * 此时说明数据库里没有协同状态，任何本地内容都是最新的，直接把上次
 * 单机模式留下的正文灌进 Y.Doc 的迁移桥即可。
 *
 * 读失败不阻断：最坏结果是这次编辑没带上旧内容，用户会立刻看到并重打一遍。
 */
const COLLAB_DRAFT_KEY_PREFIX = 'weshare:collab-draft:'

/** 记下"这篇文档还没进过协同"时的正文，下次打开时交给 Y.Doc。 */
export function rememberCollabDraft(nodeId: string, doc: unknown): void {
  try {
    if (doc && typeof window !== 'undefined' && 'localStorage' in window) {
      window.localStorage.setItem(
        `${COLLAB_DRAFT_KEY_PREFIX}${nodeId}`,
        JSON.stringify(doc),
      )
    }
  } catch {
    // 隐私模式 / 配额满：协同本身不受影响，只是这次没能带上旧内容
  }
}

/** 取出并清掉草稿（一次性：用过就不该再影响下一次装载）。 */
export function takeCollabDraft(nodeId: string): unknown {
  try {
    const key = `${COLLAB_DRAFT_KEY_PREFIX}${nodeId}`
    const raw = window.localStorage.getItem(key)
    if (raw === null) return null
    window.localStorage.removeItem(key)
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export type CollabStatus = 'connecting' | 'connected' | 'disconnected' | 'denied'

export interface CollabHandle {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  fragment: Y.XmlFragment
  destroy(): void
}

export interface ConnectOptions {
  nodeId: string
  /**
   * 这篇文档还没进过协同（服务端 `collabEnabled === false`）时，把本地正文
   * 灌进 Y.Doc；`null` 表示没有草稿。见 `rememberCollabDraft` 的说明。
   */
  seedDoc?: unknown
  /** 当前用户（用于在线状态里的名字与颜色）。 */
  user: { id: string; displayName: string }
  /** 只读用户不该发本地输入；这里只影响光标广播，写权限由服务端裁定。 */
  readOnly: boolean
  onStatus: (status: CollabStatus, detail?: string) => void
  /** 在线成员变化（用户 id → 展示名）。 */
  onPeers?: (peers: Array<{ clientId: number; name: string }>) => void
}

/** 由用户名算出稳定色相：同一个人每次进来颜色一致。 */
export function colorForUser(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) % 360
  return `hsl(${h} 65% 52%)`
}

/**
 * 建立协同连接。
 *
 * 文档名用 `node:<id>` 前缀——服务端靠它分派，不是随便起的。
 */
export function connectCollab(options: ConnectOptions): CollabHandle {
  const ydoc = new Y.Doc()
  const fragment = ydoc.getXmlFragment(PROSEMIRROR_FRAGMENT)

  // WebSocket 地址：开发期走 vite 代理的 /collab，生产同源。
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${window.location.host}/collab`

  const provider = new HocuspocusProvider({
    url,
    name: `node:${options.nodeId}`,
    document: ydoc,
    // 会话在 HttpOnly Cookie 里，浏览器自动带上。
    // 显式不传 token：传了就要在前端拿到会话凭据，那是 XSS 的目标。

    onAuthenticationFailed: ({ reason }) => {
      // 服务端拒绝握手（过期会话 / 无权限 / Origin 不过）
      options.onStatus('denied', reason)
    },
    onStatus: ({ status }) => {
      if (status === 'connected') options.onStatus('connected')
      else if (status === 'connecting') options.onStatus('connecting')
      else options.onStatus('disconnected')
    },
    onDisconnect: () => options.onStatus('disconnected'),
  })

  // 在线状态（谁在编辑）
  if (options.onPeers) {
    const update = () => {
      const states = provider.awareness?.getStates()
      if (!states) return
      const peers: Array<{ clientId: number; name: string }> = []
      states.forEach((state, clientId) => {
        const user = (state as { user?: { id: string; displayName: string } }).user
        if (user) peers.push({ clientId, name: user.displayName })
      })
      options.onPeers!(peers)
    }
    provider.on('awarenessUpdate', update)
    provider.on('awarenessChange', update)
  }

  // 广播"我是谁"，远端光标靠它显示名字与颜色
  const broadcastUser = () => {
    provider.awareness?.setLocalStateField('user', {
      id: options.user.id,
      displayName: options.user.displayName,
      color: colorForUser(options.user.id),
    })
  }
  if (provider.awareness) broadcastUser()

  // 只在"这篇还没进过协同"时灌内容，而且必须是**首次 synced**：
  // 太早会和服务端回放打架（本地先有内容 → 迁移桥不触发 → 内容被丢弃）。
  let seeded = false
  const seed = () => {
    if (seeded || options.seedDoc === null || options.seedDoc === undefined) return
    seeded = true
    seedFragment(fragment, options.seedDoc)
  }
  provider.on('synced', () => {
    seed()
    broadcastUser()
  })

  // 同步环节本身就失败了（服务端拒绝 / 网络断了）：没人会再发 synced。
  // 不在这里兜住的话，界面永远停在"正在与服务器同步…"——那是最糟的状态：
  // 用户以为自己在一篇「正在加载」的文档上编辑。
  provider.on('authenticationFailed', () => options.onStatus('denied'))

  return {
    ydoc,
    provider,
    fragment,
    destroy() {
      // 顺序重要：先断开 provider（触发一次落库），再销毁 Y.Doc
      provider.destroy()
      ydoc.destroy()
    },
  }
}

/**
 * 把 PM JSON 灌进 Y.XmlFragment。
 *
 * 用 Yjs 直接构造 XML 结构，不引编辑器实例与 y-prosemirror——这里只需要
 * "把段落和文字放进去"，服务端迁移桥用的是它自己的那份 Schema。
 */
export function seedFragment(fragment: Y.XmlFragment, doc: unknown): void {
  const blocks = (doc as { content?: unknown } | null)?.content
  if (!Array.isArray(blocks) || fragment.length > 0) return

  fragment.doc?.transact(() => {
    for (const block of blocks) {
      const b = block as { type?: string; content?: unknown; text?: unknown }
      if (typeof b.type !== 'string') continue
      const el = new Y.XmlElement(b.type)
      const inline = Array.isArray(b.content) ? b.content : []
      if (inline.length === 0 && typeof b.text === 'string') {
        el.insert(0, [new Y.XmlText(b.text)])
      } else {
        const children: Array<Y.XmlElement | Y.XmlText> = []
        for (const child of inline) {
          const c = child as { type?: string; text?: string }
          if (typeof c.type === 'string') children.push(new Y.XmlElement(c.type))
          else if (typeof c.text === 'string') children.push(new Y.XmlText(c.text))
        }
        if (children.length > 0) el.insert(0, children)
      }
      fragment.insert(fragment.length, [el])
    }
  })
}
