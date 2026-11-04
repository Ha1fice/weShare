/**
 * 会话 Cookie。
 *
 * 属性依据（OWASP Session Management Cheat Sheet + 架构文档 T2.1）：
 *
 * - **httpOnly** —— JS 读不到，XSS 无法窃取会话。
 * - **sameSite=Lax** —— 防 CSRF。`Lax` 允许顶级导航的 GET 带上 Cookie
 *   （用户从外链点进来时仍是登录态），但跨站 POST 不带。
 * - **secure** —— 仅 HTTPS 传输。生产必须开；开发走 http 本机时关掉。
 * - **path=/** —— 覆盖全站。
 * - **__Host- 前缀** —— 强制 name 以 `__Host-` 开头、path 必须为 `/`、
 *   不得有 domain 属性、必须 secure。浏览器会拒绝不合规的 Cookie，
 *   这样子域无法覆盖或伪造会话 Cookie（防 session fixation 的重要一环）。
 * - **maxAge** —— 绝对过期时间，与服务端会话有效期一致。
 *
 * 会话轮换（OWASP）：登录成功后必须**新建**会话 ID，不能沿用登录前的
 * （防会话固定攻击）。登出时删除 Cookie。
 */

/** Cookie 名称。`__Host-` 前缀强制 path=/ 且无 domain。 */
export const SESSION_COOKIE_NAME = '__Host-weshare_session'

/** 开发环境（http 本机）用的 Cookie 名——`__Host-` 要求 secure，本地 http 无法使用。 */
export const SESSION_COOKIE_NAME_DEV = 'weshare_session'

export interface CookieOptions {
  /** 是否生产环境（决定 Secure 与 __Host- 前缀）。 */
  secure: boolean
  /** 有效期（秒）。 */
  maxAgeSeconds: number
}

/**
 * 构造会话 Cookie 的 Set-Cookie 头。
 *
 * @param token 会话 token（明文）
 */
export function buildSessionCookie(token: string, options: CookieOptions): string {
  const name = options.secure ? SESSION_COOKIE_NAME : SESSION_COOKIE_NAME_DEV

  const parts = [
    `${name}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAgeSeconds}`,
  ]

  if (options.secure) {
    // __Host- 前缀要求 Secure
    parts.push('Secure')
  }

  return parts.join('; ')
}

/**
 * 构造清除会话 Cookie 的 Set-Cookie 头。
 *
 * Max-Age=0 让浏览器立即删除它。属性必须与设置时一致，
 * 否则浏览器会当作另一个 Cookie 留着。
 */
export function clearSessionCookie(options: CookieOptions): string {
  const name = options.secure ? SESSION_COOKIE_NAME : SESSION_COOKIE_NAME_DEV

  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']

  if (options.secure) {
    parts.push('Secure')
  }

  return parts.join('; ')
}

/**
 * 从请求头解析 Cookie。
 *
 * 不引第三方库：格式简单，自己解析更可控（也避免为一个 Cookie 增加依赖）。
 *
 * @param header `Cookie` 请求头的值
 * @returns 键值对
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out

  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue

    const key = part.slice(0, idx).trim()
    if (!key) continue

    const value = part.slice(idx + 1).trim()
    // Cookie 值里的百分号编码（token 是 base64url，实际不需要，但保持稳健）
    out[key] = decodeURIComponent(value)
  }

  return out
}
