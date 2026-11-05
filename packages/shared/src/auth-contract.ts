/**
 * 认证接口的请求契约（zod）。
 *
 * 放在 shared 包：前端与后端用**同一份**校验规则，
 * 避免"前端放行、后端拒绝"的错位（架构文档 §10）。
 */

import { z } from 'zod'
import { PASSWORD_MAX_LENGTH, PasswordSchema } from './password-policy.js'

/**
 * 邮箱格式。
 *
 * 刻意宽松：只排除明显不可能的形式，不试图用正则完整实现 RFC 5322。
 * 过度严格的邮箱校验会拒绝合法地址，而真正需要防的是"枚举"，
 * 那由错误信息统一 + 限流解决（见 auth 路由）。
 */
export const EmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email('邮箱格式不正确')

/**
 * 显示名。
 *
 * 允许中日韩 emoji 与组合字符——但**要规范化**，
 * 否则视觉相同的名字会存成两个。
 */
export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, '显示名不能为空')
  .max(64, '显示名不能超过 64 个字符')

/**
 * 密码。
 *
 * 复用 password-policy.ts 里的定义（只做长度检查，**不要求字符类型组合**——
 * NIST SP 800-63B-4 §3.1.1.2 第 5 条明确禁止强加组合规则）。
 * 复杂度判断交给密码强度提示器（前端）与黑名单（后续）。
 */
export { PasswordSchema }

/** 注册请求体。 */
export const RegisterBodySchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: DisplayNameSchema,
})
export type RegisterBody = z.infer<typeof RegisterBodySchema>

/** 登录请求体。 */
export const LoginBodySchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, '请输入密码').max(PASSWORD_MAX_LENGTH),
})
export type LoginBody = z.infer<typeof LoginBodySchema>

/** 修改显示名请求体。 */
export const UpdateMeBodySchema = z.object({
  displayName: DisplayNameSchema,
})
export type UpdateMeBody = z.infer<typeof UpdateMeBodySchema>

/** 当前用户信息（GET /me 的响应）。 */
export interface CurrentUser {
  id: string
  email: string
  displayName: string
  avatarKey: string | null
  status: 'active' | 'disabled'
  createdAt: string
}

/** GET /me 的响应。 */
export interface MeResponse {
  user: CurrentUser
  workspaces: Array<{
    id: string
    name: string
    ownerId: string
    defaultRole: 'view' | 'comment' | 'edit'
    role: 'owner' | 'admin' | 'member' | 'viewer'
  }>
}

/** 登录/注册的响应。 */
export interface AuthResponse {
  user: CurrentUser
}

// ---------------------------------------------------------------- 免密身份（设备指纹）

/**
 * 设备指纹对应的身份标识。
 *
 * 客户端算好指纹后只发它的哈希（hex），服务端由它派生稳定账号：
 * 同一浏览器再次打开页面自动回落到同一身份，不需要登录流程。
 *
 * 选 64 位 hex 而不是 sha256 全量，是为了在"指纹碰撞概率"与"存储/日志体积"
 * 之间取一个够用的点：64 位随机碰撞在单机部署规模（万级设备）可忽略，
 * 同时它仍然是可以低成本伪造的标识——因此**它的安全边界只有"不泄露他人 key"**，
 * 不能当成凭证使用（详见 docs/specs/weshare-1.0.md 的身份约定）。
 */
export const DeviceKeySchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/, '设备标识格式不正确')

/** 还没有登录时，用设备标识 + 名字建立身份（同一设备再次调用即回到同一账号）。 */
export const DeviceIdentityBodySchema = z.object({
  deviceKey: DeviceKeySchema,
  displayName: DisplayNameSchema,
})
export type DeviceIdentityBody = z.infer<typeof DeviceIdentityBodySchema>

/** 会话建立后给设备标识绑定名字（改名时同步，供换浏览器找回）。 */
export const BindIdentityBodySchema = z.object({
  deviceKey: DeviceKeySchema,
  displayName: DisplayNameSchema,
})
export type BindIdentityBody = z.infer<typeof BindIdentityBodySchema>

/** 设备身份约定的环境开关名——api 与 web 用同一份，避免两侧判断不一致。 */
export const DEVICE_IDENTITY_FLAG = 'VITE_DEVICE_IDENTITY'
