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
