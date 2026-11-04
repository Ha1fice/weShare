/**
 * 密码策略。
 *
 * 独立成模块而不是放在 index.ts——auth-contract.ts 要用它，
 * 若两者互相导入就形成循环依赖（ESM 下会拿到 undefined）。
 */

import { z } from 'zod'

/**
 * 密码长度下限。
 *
 * NIST SP 800-63B-4：验证者 **SHALL** 要求至少 8 字符，**SHOULD** 要求至少 15。
 * 这里取 15（推荐值）——8 是底线而非目标。
 */
export const PASSWORD_MIN_LENGTH = 15

/**
 * 密码长度上限。
 *
 * NIST SP 800-63B-4：验证者 **SHOULD** 允许至少 64 字符。
 * 取 64，且**不做更长的截断**——超出即拒绝，而不是静默截断
 * （静默截断会让 "A"×100 与 "A"×64 等价，削弱长密码短语）。
 */
export const PASSWORD_MAX_LENGTH = 64

/**
 * Unicode 规范化形式。
 *
 * NIST SP 800-63B-4 §3.1.1.2 第 4 条：接受 Unicode 密码时，
 * 验证者 **SHOULD** 应用"稳定字符串规范化"（NFKC 或 NFKD），
 * 且必须在**哈希之前**执行。
 *
 * 为什么必要：同一个视觉字符可能有多种码点序列。
 * 例如 "ｱ"（全角片假名 U+FF71）与 "ア"（U+30A2）视觉相同但码点不同；
 * 带组合重音的 "é" 可能是 U+00E9 单字符，也可能是 "e" + U+0301 两字符。
 * 不规范化就会出现"密码明明一样却登录失败"，或同一密码存成两个哈希。
 */
export const PASSWORD_NORMALIZATION = 'NFKC' as const

/**
 * 规范化密码字符串。
 *
 * **必须在哈希前调用**，注册与校验走同一函数。
 */
export function normalizePassword(password: string): string {
  return password.normalize(PASSWORD_NORMALIZATION)
}

/**
 * 密码策略的判定结果。
 */
export type PasswordPolicyResult =
  | { ok: true }
  | { ok: false; reason: 'too_short' | 'too_long' }

/**
 * 判定密码是否符合策略。
 *
 * **不要求字符类型组合**（大小写 + 数字 + 符号各一）。NIST SP 800-63B-4 明确
 * "不得对密码强加其他组成规则"——这类规则会迫使用户发明
 * "BigToe@1" 这类可预测的密码，反而削弱安全性。
 *
 * 长度按 **Unicode 码点**计（而非 UTF-16 单元或字节），因此中文密码
 * 不会被算成双倍长度。
 */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  // [...str] 按码点切分，正确处理代理对（emoji 等）
  const length = [...password].length

  if (length < PASSWORD_MIN_LENGTH) return { ok: false, reason: 'too_short' }
  if (length > PASSWORD_MAX_LENGTH) return { ok: false, reason: 'too_long' }
  return { ok: true }
}

/** 密码策略失败时的用户可读提示（前端直接用）。 */
export function passwordPolicyMessage(result: PasswordPolicyResult): string {
  if (result.ok) return ''
  switch (result.reason) {
    case 'too_short':
      return `密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符`
    case 'too_long':
      return `密码不能超过 ${PASSWORD_MAX_LENGTH} 个字符`
    default:
      // 穷尽检查：新增 reason 时这里会编译报错
      return '密码不符合要求'
  }
}

/**
 * 密码的 zod schema（API 边界校验）。
 *
 * 只做长度检查，**不要求字符类型组合**。
 */
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符`)
  .max(PASSWORD_MAX_LENGTH, `密码不能超过 ${PASSWORD_MAX_LENGTH} 个字符`)
