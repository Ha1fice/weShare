/**
 * 协同服务环境配置（zod 校验）。
 */

import { z } from 'zod'

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  /**
   * 监听端口。`0` 表示由操作系统分配（测试用——并行跑测试时不会撞端口）。
   * 生产环境请显式配置具体端口。
   */
  PORT: z.coerce.number().int().min(0).max(65535).default(3100),

  DB_PATH: z.string().default('data/weshare.db'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * 允许的 WebSocket 握手 Origin 白名单（逗号分隔）。
   *
   * **空 = 一律拒绝**（fail-closed）。Cookie 鉴权的 WebSocket 不受同源策略
   * 保护，放行无 Origin 或任意 Origin 等于把文档暴露给任何能诱骗用户
   * 打开页面的攻击者（架构文档 §13 R15）。
   *
   * 开发期需要显式配：`ALLOWED_ORIGINS=http://127.0.0.1:5173`
   */
  ALLOWED_ORIGINS: z.string().default(''),

  /**
   * 落库节流（毫秒）。
   *
   * 每次改动都落库在 SQLite 上是灾难（单写者，见架构文档 R13）。
   * 1200ms 与前端自动保存的防抖窗口一致——用户感知的丢失窗口不变。
   */
  STORE_DEBOUNCE_MS: z.coerce.number().int().min(100).max(60000).default(1200),

  /** 最长多久必须落一次库（即使一直在输入）。防止长时间不停笔导致一直不落库。 */
  STORE_MAX_DEBOUNCE_MS: z.coerce.number().int().min(1000).max(300000).default(8000),
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

/** 解析 Origin 白名单。空字符串表示"没配置"——不校验的反面，是一律拒绝。 */
export { parseAllowedOrigins } from './auth/origin.js'
