/**
 * 文档正文的 API 契约（架构文档 §5.4、§9.1）。
 *
 * 两条规则是这个契约的全部重点：
 *
 *   1. **正文是 JSON，不是 HTML。** 服务端永不接受、也永不返回 HTML——
 *      否则就等于把 XSS 的防线交给"渲染时记得转义"。
 *   2. **写入必须带 revision。** 不带就是"盲写"，两个人同时编辑时后写的人
 *      会静默覆盖前一个人的内容。冲突时返回 409，由前端给出明确出口。
 */

import { z } from 'zod'

/**
 * ProseMirror 文档的最小结构校验。
 *
 * 不做完整 schema 校验：PM Schema 的真源在编辑器侧（`@weshare/doc-schema`
 * 与 Tiptap），在 API 层重写一遍必然漂移。这里只挡住**明显不是 PM JSON** 的东西，
 * 保护的是"数据库里别存进去一个 `{"hello":"world"}"。
 */
export const ProseMirrorDocSchema = z
  .object({
    type: z.literal('doc'),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough()
export type ProseMirrorDoc = z.infer<typeof ProseMirrorDocSchema>

/** 保存正文请求体。 */
export const SaveContentBodySchema = z.object({
  /** 必须带，用于乐观锁。 */
  revision: z.number().int().min(0),
  doc: ProseMirrorDocSchema,
})
export type SaveContentBody = z.infer<typeof SaveContentBodySchema>

/** 正文响应。 */
export interface ContentView {
  nodeId: string
  /** PM JSON。旧文档可能是 null（建文档时写入，正常不会）。 */
  doc: ProseMirrorDoc | null
  /** 当前版本号。0 表示从未保存过。 */
  revision: number
  contentSchemaVersion: number
  /** 纯文本预览（列表摘要用），服务端派生。 */
  textPreview: string | null
  charCount: number
  updatedAt: string
  /**
   * true 表示这篇文档已启用协同（yjs_state 非空）。
   *
   * 此时 REST 写入会返回 409 COLLAB_ENABLED——同一文档永不允许
   * 同时存在两条写入路径（架构文档不变式 I2）。
   */
  collabEnabled: boolean
}

/** 单文档体积上限（字节）。序列化后超过即拒绝。 */
export const CONTENT_SIZE_LIMIT_BYTES = 20 * 1024 * 1024

/**
 * 从 PM JSON 里提取纯文本。
 *
 * 递归遍历 `text` 字段。用于列表摘要与字符数——不追求格式保留，
 * 只要"能看出这篇讲什么"。
 */
export function extractPlainText(doc: unknown): string {
  const out: string[] = []
  let guard = 0

  const walk = (node: unknown): void => {
    // 防御异常深的文档（粘贴来的畸形 JSON）：超过 20000 个节点就停
    if (guard++ > 20000) return
    if (node === null || typeof node !== 'object') return

    const n = node as { text?: unknown; content?: unknown }
    if (typeof n.text === 'string') out.push(n.text)
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child)
      // 块级节点之间补一个空格，避免"第一段第二段"粘在一起
      out.push(' ')
    }
  }

  walk(doc)
  return out.join('').replace(/\s+/g, ' ').trim()
}
