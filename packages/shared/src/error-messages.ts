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
 * 网络层失败的文案。
 *
 * 断网和服务端 5xx 是两回事：把「连不上服务器」说成「服务器开小差了」会把
 * 用户引向错误的排查方向（以为是自己改坏了，其实是本机网络）。文案与
 * `apps/web/src/api/client.ts` 抛错时带的一致。
 */
export const NETWORK_ERROR_MESSAGE = '无法连接服务器，请检查网络后重试'

/**
 * 取展示文案：非空 message 优先，否则按错误码兜底。
 *
 * code 收 `ErrorCode | 'NETWORK_ERROR'`：前端 ApiError 的 code 就是这个联合
 * （网络层失败没有服务端错误码），收进来调用方就不用 as 硬压类型。
 * NETWORK_ERROR 的 message 是 fetch 诊断信息，不是用户文案，必须换成网络提示。
 */
export function errorMessage(err: { code: ErrorCode | 'NETWORK_ERROR'; message?: string }): string {
  if (err.code === 'NETWORK_ERROR') {
    return NETWORK_ERROR_MESSAGE
  }
  if (err.code === 'INTERNAL_ERROR') {
    return ERROR_MESSAGES.INTERNAL_ERROR
  }
  const message = err.message?.trim()
  return message || ERROR_MESSAGES[err.code]
}
