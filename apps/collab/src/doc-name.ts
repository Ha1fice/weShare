/**
 * 文档名 ⇄ 节点 id 的映射。
 *
 * Hocuspocus 的 `documentName` 是客户端传的字符串。两种做法：
 *   A. 直接把它当节点 id 用；
 *   B. 加固定前缀，例如 `node:<uuid>`。
 *
 * 选 B：将来同一套协同服务如果要承载别的东西（工作区级在线状态、
 * 表格的 workbook），前缀就是天然的分派点，不用改协议。
 * 同时前缀也让日志里一眼能看出这是什么东西。
 */

const PREFIX = 'node:'

/** 节点 id → 文档名。 */
export function toDocumentName(nodeId: string): string {
  return `${PREFIX}${nodeId}`
}

/** 文档名 → 节点 id。格式不对返回 null（不抛错：这是外部输入）。 */
export function parseDocumentName(documentName: string): string | null {
  if (!documentName.startsWith(PREFIX)) return null
  const id = documentName.slice(PREFIX.length).trim()
  if (id.length === 0 || id.length > 64) return null
  return id
}
