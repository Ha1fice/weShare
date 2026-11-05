/**
 * 错误码 → 用户文案兜底映射。
 *
 * 后端返回的 `error.message` 始终优先（它是具体上下文的中文文案）；
 * 本表只在 message 缺失/为空时兜底，保证页面上不会出现
 * 「请求失败（500）」这类裸状态码（架构文档附录 A）。
 */
import type { ErrorCode } from './index.js'

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: '登录状态已失效，请重新登录',
  FORBIDDEN: '没有执行此操作的权限',
  NOT_FOUND: '内容不存在或已被删除',
  CONFLICT: '操作冲突，请刷新后重试',
  COLLAB_ENABLED: '该文档已启用多人协同，请在协同模式下编辑',
  COLLAB_BUSY: '协同服务繁忙，请稍后重试',
  VALIDATION_FAILED: '提交的内容不合法，请检查后重试',
  RATE_LIMITED: '操作过于频繁，请稍后再试',
  PAYLOAD_TOO_LARGE: '内容过大，请拆分后再提交',
  UNSUPPORTED_MEDIA_TYPE: '不支持的文件类型',
  INTERNAL_ERROR: '服务器开小差了，请稍后重试',
}

/**
 * 取展示文案：非空 message 优先，否则按错误码兜底。
 *
 * 5xx（服务端内部错误）的 message 通常是诊断信息而非用户文案，
 * 统一走兜底；4xx 信任后端 message。
 */
export function errorMessage(err: { code: ErrorCode; message?: string }): string {
  if (err.code === 'INTERNAL_ERROR') return ERROR_MESSAGES.INTERNAL_ERROR
  const message = err.message?.trim()
  return message || ERROR_MESSAGES[err.code]
}
