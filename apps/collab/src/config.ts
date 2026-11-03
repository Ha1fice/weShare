/**
 * 协同服务环境配置（zod 校验）。
 */

import { z } from 'zod'

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),

  DB_PATH: z.string().default('data/weshare.db'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * 允许的 WebSocket 握手 Origin 白名单（逗号分隔）。
   *
   * 空表示不校验——这只在开发期允许，生产必须显式配置。
   * Cookie 鉴权的 WebSocket 若不校验 Origin，攻击者页面可直连并带上
   * 浏览器自动携带的 Cookie，构成跨站 WebSocket 劫持（架构文档 §8.3）。
   */
  ALLOWED_ORIGINS: z.string().default(''),
})

export type CollabConfig = z.infer<typeof ConfigSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollabConfig {
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`环境配置校验失败：\n${issues}`)
  }
  return parsed.data
}

/** 解析 Origin 白名单。空字符串表示不校验（仅开发期允许）。 */
export function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}
