/**
 * 密码哈希（Argon2id）。
 *
 * 算法选择：**Argon2id**（OWASP Password Storage Cheat Sheet 2025 的首选）。
 * 备选 scrypt 在 OWASP 表里排第二，且实测在本机慢 8.7 倍、内存多 6.7 倍
 * （scrypt N=2^17 需 128 MiB，Argon2id m=19 MiB 只需 19 MiB）。
 * Node 22+ 无内置 Argon2，但 `argon2` 包提供预编译二进制，免 node-gyp 编译。
 *
 * 参数采用 OWASP 2025 最低配置：memoryCost=19456 KiB(19 MiB)、timeCost=2、
 * parallelism=1。本机实测单次哈希约 30 ms。
 *
 * 编码串自带参数（argon2 标准格式 `$argon2id$v=19$m=...,t=...,p=1$...`），
 * 因此将来提高参数时，**旧的哈希仍可被校验**，登录成功后按需重新哈希升级。
 *
 * 安全要点：
 * - 永不记录明文密码；
 * - 校验用 argon2.verify（内部常量时间比较）；
 * - 校验失败与用户不存在返回**同样的错误**，不泄露账号是否存在。
 */

import argon2 from 'argon2'
import { ARGON2_PARAMS, normalizePassword } from '@weshare/shared'

/** OWASP 2025 最低配置：19 MiB 内存、2 轮、并行度 1。 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  ...ARGON2_PARAMS,
} as const

/**
 * 计算密码哈希。
 *
 * **先做 NFKC 规范化再哈希**（NIST SP 800-63B-4 §3.1.1.2 第 4 条）——
 * 规范化必须在哈希前进行，否则全角/半角等价的密码会存成两个不同哈希。
 *
 * @param password 明文密码
 * @returns 自解释编码串（含算法与参数）
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(normalizePassword(password), ARGON2_OPTIONS)
}

/**
 * 校验密码。
 *
 * 用户不存在时**不要**调用本函数——那会让响应时间不同，从而泄露账号是否存在。
 * 正确做法是见 `verifyPasswordOrDummy`：对不存在的用户也跑一次哈希校验，
 * 让耗时一致。
 *
 * @param hash 数据库中存的编码串
 * @param password 用户输入的明文
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, normalizePassword(password))
  } catch {
    // 哈希串损坏或参数不受支持 → 视为校验失败，不抛给调用方
    return false
  }
}

/**
 * 哑哈希：用于"用户不存在"时消耗与真实校验相同的时间。
 *
 * 这是一个**真实生成**的 Argon2id 编码串（参数与线上一致），不是编造的字符串——
 * 编造的串会在解析阶段快速失败，反而暴露"用户不存在"。
 *
 * 对应的明文是 `dummy-password-for-timing-equalization`，无人知道也无人在意；
 * 它只在用户不存在时被校验一次，作用是让耗时与真实校验一致。
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$yP/qKAuepweG4exIuvtc1A$P6aMuuaam9PPCZr1Ry18E7bsNNolyYpX7qRcU1iDdo0'

/**
 * 无论用户是否存在都执行一次校验，让响应时间一致。
 *
 * 这是防"账号枚举"的关键：若用户不存在就直接返回，攻击者能靠响应时间差异
 * 区分出哪些邮箱注册过。
 *
 * @param hash 用户存在时传入真实哈希；不存在时传 undefined
 * @param password 用户输入
 * @returns 用户存在且密码正确时为 true
 */
export async function verifyPasswordOrDummy(
  hash: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (!hash) {
    // 用户不存在：仍然跑一次校验，消耗同等时间
    await verifyPassword(DUMMY_HASH, password)
    return false
  }
  return verifyPassword(hash, password)
}

/**
 * 判断哈希是否需要用当前参数重新生成。
 *
 * 场景：将来把 memoryCost 从 19456 提高到 32768 后，老哈希的参数就偏低了。
 * 用户登录成功时调用本函数，为 true 则用新参数重新哈希并写回数据库。
 *
 * @param hash 数据库中存的编码串
 */
export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, ARGON2_OPTIONS)
  } catch {
    // 无法解析 → 视为需要重哈希
    return true
  }
}
