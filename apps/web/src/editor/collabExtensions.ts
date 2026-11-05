/**
 * 协同模式下的 Tiptap 扩展集。
 *
 * 与单机模式的差别只有两处，但都很关键：
 *
 *   1. **关掉 `undoRedo`（即 PM 的 history）**。Yjs 自带 undo manager，
 *      两套撤销栈并存会让 Ctrl+Z 出现"回退掉别人刚改的内容"这种灵异行为。
 *   2. **正文由 Collaboration 接管**。协同模式下不能再 `setContent`——
 *      内容来自 Y.Doc，本地覆写会和远端更新打架。
 */

import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import type * as Y from 'yjs'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { LINK_PROTOCOLS, isSafeLinkHref } from '@weshare/doc-schema'
import { colorForUser } from './collab.js'

export interface CollabExtensionOptions {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  user: { id: string; displayName: string }
  /** 只读用户不广播自己的光标。 */
  readOnly: boolean
}

export function buildCollabExtensions(options: CollabExtensionOptions) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: { HTMLAttributes: { class: 'code-block' } },
      link: false,
      // 必须有：否则 Yjs 的 undo manager 与 PM 的 history 两套栈打架
      undoRedo: false,
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: [...LINK_PROTOCOLS],
      validate: (href: string) => isSafeLinkHref(href),
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
    Placeholder.configure({ placeholder: '开始输入，同事会实时看到…' }),
    Collaboration.configure({ document: options.ydoc, field: 'prosemirror' }),
    CollaborationCaret.configure({
      provider: options.provider,
      user: {
        name: options.user.displayName,
        color: colorForUser(options.user.id),
      },
      // 只读用户不渲染自己的光标：对别人没有意义，也省一点流量
      ...(options.readOnly
        ? {
            render: () => {
              const el = document.createElement('span')
              el.style.display = 'none'
              return el
            },
          }
        : {}),
    }),
  ]
}
