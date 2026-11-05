/**
 * WebSocket 握手的 Origin 校验。
 *
 * 为什么必须有（架构文档 §13 R15）：
 *   Cookie 鉴权的 WebSocket **不会**受同源策略保护——浏览器会带着 Cookie
 *   发起跨站握手。攻击者只要在自己页面里 `new WebSocket('wss://你的域名/collab')`，
 *   就能以受害者的身份连上并读走文档。这不是理论风险，是真实的跨站
 *   WebSocket 劫持（CSWSH）。
 *
 * 防线就是这条：握手时校验 Origin 白名单。白名单为空时**默认拒绝**
 * （fail-closed）——为空表示"没配置"，不表示"允许所有"。
 * 开发期要在 `.env` 里显式写 `http://127.0.0.1:5173`。
 */

/** 白名单解析：逗号分隔，去空白，去空项，统一小写、去尾斜杠。 */
export function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\/+$/, ''))
    .filter((s) => s.length > 0)
}

export type OriginCheckResult =
  | { ok: true }
  | { ok: false; reason: 'missing-origin' | 'not-allowed' | 'not-configured' }

/**
 * 判定 Origin 是否被允许。
 *
 * 注意 **Origin 缺失也拒绝**：非浏览器客户端不带 Origin，但本产品只服务
 * 浏览器场景；放行"无 Origin"等于给挂在别人页面上的本机脚本开后门。
 */
export function checkOrigin(origin: string | null | undefined, allowed: string[]): OriginCheckResult {
  if (allowed.length === 0) return { ok: false, reason: 'not-configured' }
  if (!origin) return { ok: false, reason: 'missing-origin' }

  const normalized = origin.trim().toLowerCase().replace(/\/+$/, '')
  return allowed.includes(normalized) ? { ok: true } : { ok: false, reason: 'not-allowed' }
}
