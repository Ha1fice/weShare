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

export type CollabStatus = 'connecting' | 'connected' | 'disconnected' | 'denied'

export interface CollabHandle {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  fragment: Y.XmlFragment
  destroy(): void
}

export interface ConnectOptions {
  nodeId: string
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
  provider.on('synced', broadcastUser)

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
