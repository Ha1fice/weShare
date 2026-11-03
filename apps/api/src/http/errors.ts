/**
 * 统一错误响应体（架构文档附录 A）。
 *
 * 契约：`{ "error": { "code": "FORBIDDEN", "message": "…", "requestId": "…" } }`
 *
 * 语义约定（架构文档 T5.3）：
 * - 无权访问一律返回 404，不区分"不存在"与"无权限"，避免探测。
 * - 错误码来自 @weshare/shared 的 ERROR_CODES，前端按码映射提示文案。
 */

import { ERROR_STATUS, type ErrorCode } from '@weshare/shared'

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  /** 是否把 message 直接返回给客户端。内部错误应传 false，避免泄露细节。 */
  readonly expose: boolean

  constructor(code: ErrorCode, message?: string, options?: { expose?: boolean }) {
    super(message ?? code)
    this.name = 'AppError'
    this.code = code
    this.status = ERROR_STATUS[code]
    this.expose = options?.expose ?? true
  }
}

/** 未认证。 */
export function unauthenticated(message = '未登录或会话已失效'): AppError {
  return new AppError('UNAUTHENTICATED', message)
}

/** 无权限。内部使用时注意：对无权访问的节点应改用 notFound 以免泄露存在性。 */
export function forbidden(message = '无权访问'): AppError {
  return new AppError('FORBIDDEN', message)
}

/**
 * 资源不存在。
 *
 * 无权访问的节点也用这个（架构文档 T5.3）：对外表现一致，无法据此探测资源是否存在。
 */
export function notFound(message = '资源不存在'): AppError {
  return new AppError('NOT_FOUND', message)
}

/** 校验失败。 */
export function validationFailed(message = '请求参数不合法'): AppError {
  return new AppError('VALIDATION_FAILED', message)
}

/** 冲突。 */
export function conflict(message = '操作冲突'): AppError {
  return new AppError('CONFLICT', message)
}

/** 序列化错误响应体。 */
export function toErrorBody(code: ErrorCode, message: string, requestId: string) {
  return { error: { code, message, requestId } }
}
