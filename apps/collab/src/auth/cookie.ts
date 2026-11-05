/**
 * 会话 Cookie 解析（collab 侧）。
 *
 * 与 api 侧的 `session-cookie.ts` 是同一份协议的两端：**解析格式必须一致**，
 * 但不需要把整个 Set-Cookie 构造能力搬过来。这里只做"从 Cookie 头里取出
 * 会话 token"这一件事，并接受两种 Cookie 名（生产 `__Host-` 前缀 / 开发裸名）。
 */

/** 生产环境（HTTPS）的 Cookie 名。 */
export const SESSION_COOKIE_NAME = '__Host-weshare_session'

/** 开发环境（http 本机）的 Cookie 名。 */
export const SESSION_COOKIE_NAME_DEV = 'weshare_session'

/** 从 `Cookie` 头里取会话 token。两种名字都认，避免部署环境变化导致掉线。 */
export function readSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null

  const cookies: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    if (!key) continue
    try {
      cookies[key] = decodeURIComponent(part.slice(idx + 1).trim())
    } catch {
      // 畸形百分号编码：跳过这一个 Cookie，不影响其它
      continue
    }
  }

  return cookies[SESSION_COOKIE_NAME] ?? cookies[SESSION_COOKIE_NAME_DEV] ?? null
}
