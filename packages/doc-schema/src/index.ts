/**
 * ProseMirror Schema v1（架构文档 §5.2）。
 *
 * 本包是**纯逻辑**：不碰业务权限、不碰导航、不碰通知（架构文档 §4.1）。
 * PM Schema 的权威定义在 Phase 2 由 Tiptap 建立，此处先固定契约与不变量。
 */

/** 当前 Schema 版本。写入正文时带在 content_schema_version 上。 */
export const CONTENT_SCHEMA_VERSION = 1

/**
 * Y.Doc 结构版本。
 *
 * 与 CONTENT_SCHEMA_VERSION 是**两条独立的演进线**（架构文档 §5.5）：
 * 前者可在线惰性迁移，后者只能离线批处理。共用一个字段会让"镜像迁移了
 * 但协同结构没迁"变成无法区分的歧义。
 */
export const YJS_SCHEMA_VERSION = 1

/** 块级节点类型。 */
export const BLOCK_NODES = [
  'doc',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'image',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
] as const
export type BlockNodeName = (typeof BLOCK_NODES)[number]

/** 行内 mark 类型。 */
export const MARKS = ['bold', 'italic', 'underline', 'strike', 'code', 'link', 'textStyle'] as const
export type MarkName = (typeof MARKS)[number]

/** 标题层级。仅三级，够 MVP（架构文档 §5.2）。 */
export const HEADING_LEVELS = [1, 2, 3] as const
export type HeadingLevel = (typeof HEADING_LEVELS)[number]

/** 链接允许的协议白名单。 */
export const LINK_PROTOCOLS = ['http', 'https', 'mailto'] as const

/**
 * 校验链接 href 是否安全。
 *
 * 拒绝 `javascript:`、`data:` 等——它们是 XSS 载体（架构文档 §12 Phase 2 验收 5）。
 */
export function isSafeLinkHref(href: string): boolean {
  const trimmed = href.trim()
  // 相对路径与锚点是安全的
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return true
  const colon = trimmed.indexOf(':')
  if (colon < 0) return true
  const scheme = trimmed.slice(0, colon).toLowerCase()
  return (LINK_PROTOCOLS as readonly string[]).includes(scheme)
}

/**
 * 校验图片 src。
 *
 * 只允许平台附件 URL（架构文档 §3.3 C、§5.2）。外链图片必须先转存为附件，
 * 服务端不得代抓任意外部 URL（SSRF）。
 */
export function isAllowedImageSrc(src: string): boolean {
  return /^\/api\/v1\/attachments\/[0-9a-f-]{36}$/i.test(src.trim())
}

/** 空文档的初始内容。新建文档时的 content_json 初值。 */
export const EMPTY_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
} as const
