/**
 * 环境配置（zod 校验）。
 *
 * 配置错误必须在启动时暴露，而不是等到第一次请求——所以用 zod 在启动时解析。
 */

import { z } from 'zod'

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /** 数据库文件路径。测试用 ':memory:'。 */
  DB_PATH: z.string().default('data/weshare.db'),

  /** 附件存储根目录。 */
  UPLOAD_DIR: z.string().default('uploads'),

  /** 允许的跨域来源。生产必须显式配置。 */
  CORS_ORIGINS: z.string().default(''),

  /** 日志级别。 */
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** 会话有效期（天）。 */
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /** 是否开放注册。生产应关闭。 */
  ALLOW_REGISTER: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
})

export type AppConfig = z.infer<typeof ConfigSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`环境配置校验失败：\n${issues}`)
  }
  return parsed.data
}
