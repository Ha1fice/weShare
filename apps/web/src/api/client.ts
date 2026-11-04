/**
 * API 请求封装。
 *
 * 职责：
 *   1. 统一前缀（`/api/v1`）与 Content-Type；
 *   2. 统一错误处理——把后端的契约化错误体转成 `ApiError`；
 *   3. 401 的统一处理——会话失效时通知上层（由 store 清理状态）。
 *
 * 错误处理的原则：
 *   - 后端返回的错误体是契约（架构文档附录 A），前端**按 error.code 分支**，
 *     不解析 message 文本；
 *   - 网络错误、超时、非 JSON 响应等异常情况统一转成 `ApiError`，
 *     带上 `network: true` 标记，让调用方能区分"服务端说不行"与"根本没连上"。
 */

import type { ErrorBody, ErrorCode } from '@weshare/shared'

const API_BASE = '/api/v1'

export class ApiError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR'
  readonly status: number
  readonly requestId: string | null
  /** true 表示请求根本没到达服务端（网络错误 / 解析失败）。 */
  readonly network: boolean

  constructor(
    code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    status: number,
    requestId: string | null = null,
    network = false,
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
    this.network = network
  }
}

/** 会话失效时的回调。由 session store 注册。 */
type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options
  const url = path.startsWith('/api/') ? path : `${API_BASE}${path}`

  let response: Response
  try {
    response = await fetch(url, {
      method,
      // 会话 Cookie——必须带 credentials
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (err) {
    // 网络层失败：请求没到达服务端。
    // 保留 err 便于将来加诊断日志（当前不记录，避免泄露请求细节到控制台）
    void err
    throw new ApiError(
      'NETWORK_ERROR',
      '无法连接服务器，请检查网络后重试',
      0,
      null,
      true,
    )
  }

  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      // 响应不是 JSON——多半是网关错误页
      if (!response.ok) {
        throw new ApiError(
          'INTERNAL_ERROR',
          `服务器返回了无法解析的响应（${response.status}）`,
          response.status,
          null,
          true,
        )
      }
    }
  }

  if (!response.ok) {
    const body = parsed as ErrorBody | null
    const code = body?.error?.code ?? 'INTERNAL_ERROR'
    const message = body?.error?.message ?? `请求失败（${response.status}）`
    const requestId = body?.error?.requestId ?? null

    // 401 通知上层清理会话状态
    if (response.status === 401) {
      onUnauthorized?.()
    }

    throw new ApiError(code, message, response.status, requestId)
  }

  return parsed as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
