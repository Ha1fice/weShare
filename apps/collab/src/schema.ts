/**
 * 协同侧的 ProseMirror Schema。
 *
 * 必须与前端编辑器**完全一致**，否则 y-prosemirror 在把数据库里的
 * Y.Doc 还原成 PM JSON 时会丢弃它不认识的节点——表现为"用户写的表格/图片
 * 在重启后消失"，而这在协同过程中完全看不出来。
 *
 * 因此两侧共用同一个构造函数（`@weshare/doc-schema` 指向的这份）。
 */

import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { getSchema } from '@tiptap/core'
import type { Schema } from 'prosemirror-model'
import { LINK_PROTOCOLS, isSafeLinkHref } from '@weshare/doc-schema'

/**
 * 构造 Schema（无编辑器实例，仅结构）。
 *
 * 返回类型必须显式标注 `Schema`：否则 TS 会尝试引用 pnpm 的深层路径
 * （`.pnpm/prosemirror-model@x/node_modules/...`），不可移植。
 */
export function buildProseMirrorSchema(): Schema {
  return getSchema([
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
    Underline,
    Link.configure({
      protocols: [...LINK_PROTOCOLS],
      validate: (href: string) => isSafeLinkHref(href),
    }),
  ])
}
