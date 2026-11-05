/**
 * 编辑器 Schema（Schema v1）。
 *
 * 只开白名单内的节点与 mark——`@weshare/doc-schema` 里的 BLOCK_NODES / MARKS
 * 是同一份清单的契约侧定义。粘贴进来的非法节点会被 PM 直接丢弃，
 * 这是防 XSS 的第一道门（架构文档 §13 R9），页面渲染永不使用 innerHTML。
 *
 * 刻意不开的东西：表格（Phase 5）、评论锚点（Phase 4）、图片（等附件系统）。
 * 开了就得承担对应的一致性责任，不如先不开。
 */
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import { LINK_PROTOCOLS, isSafeLinkHref } from '@weshare/doc-schema'

export interface SchemaOptions {
  editable: boolean
  placeholder?: string
}

export function buildExtensions(options: SchemaOptions) {
  return [
    StarterKit.configure({
      // 标题只到 3 级：文档工具里 4–6 级标题实际没人用，
      // 留着只会让工具栏多出三个永远不被点的按钮。
      heading: { levels: [1, 2, 3] },
      codeBlock: { HTMLAttributes: { class: 'code-block' } },
      // 历史记录用 PM 自带的 undo/redo，不需要额外扩展
      link: false,
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: [...LINK_PROTOCOLS],
      // 双保险：即使 autolink 抓到了奇怪协议，也在这里拦一道
      validate: (href: string) => isSafeLinkHref(href),
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
    Placeholder.configure({
      placeholder: options.placeholder ?? '开始输入，或按 "/" 选择格式…',
    }),
  ]
}

/** 空文档的最小结构。与 api 侧建文档时写入的一致。 */
export const EMPTY_DOC = { type: 'doc' as const, content: [{ type: 'paragraph' }] }
