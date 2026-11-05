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

  /** 日志级别。silent = 完全不输出（测试用）。 */
  LOG_LEVEL: z
    .enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  /** 会话有效期（天）。 */
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /**
   * 是否为生产环境（决定 Cookie 的 Secure 与 `__Host-` 前缀）。
   *
   * `__Host-` 前缀要求 secure=true，本地 http 开发无法使用，
   * 因此不能简单用 NODE_ENV 判断——要显式配置。
   */
  SECURE_COOKIE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  /**
   * 登录失败锁定阈值（同 IP 窗口内的最大失败次数）。
   */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),

  /** 登录失败锁定窗口（秒）。 */
  LOGIN_LOCK_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),

  /**
   * 是否启用免密身份（设备指纹）。
   *
   * 打开后 `POST /api/v1/auth/device` 才注册：用户输入一个名字即进入，
   * 不需要邮箱与密码。这是"简版"形态，适合内网/试用；生产默认关闭，
   * 因为它把身份安全性降到了"知道 deviceKey 即可冒充"的水平。
   */
  DEVICE_IDENTITY: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

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
