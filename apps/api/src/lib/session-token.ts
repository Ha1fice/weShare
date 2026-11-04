/**
 * 会话令牌。
 *
 * 设计要点（OWASP Session Management Cheat Sheet）：
 *
 * 1. **明文不落库**。客户端持有的是随机 token（明文），数据库只存它的
 *    sha256 哈希。数据库泄露时，攻击者拿到哈希也无法直接当会话使用——
 *    但仍可用作离线暴力（token 熵足够高，无实际意义）。
 *
 * 2. **熵足够**。token 用 32 字节 CSPRNG（256 位），远超 OWASP 要求的 64 位下限。
 *
 * 3. **查找会话用哈希**。session 表的 token_hash 列有唯一索引，用它定位会话。
 *
 * 4. **登出即删**。服务端删除会话记录，令牌立刻失效。
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** 会话 token 的字节数。32 字节 = 256 位熵。 */
export const TOKEN_BYTES = 32

/**
 * 生成会话 token（明文，交给客户端放进 Cookie）。
 *
 * 用 base64url 编码：URL 安全、无需转义。
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * 计算 token 的哈希（存数据库）。
 *
 * sha256 足够：token 是高熵随机串，不是低熵密码，不需要慢哈希。
 */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

/**
 * 常量时间比较两个哈希。
 *
 * 用于校验 token 哈希时避免时序侧信道。
 */
export function safeEqualHash(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * 判断给定的明文 token 是否对应某个哈希。
 *
 * @param token 客户端带来的明文 token
 * @param expectedHash 数据库中存的哈希
 */
export function tokenMatches(token: string, expectedHash: Buffer): boolean {
  return safeEqualHash(hashToken(token), expectedHash)
}
