import { describe, expect, it } from 'vitest'
import {
  ARGON2_OPTIONS,
  hashPassword,
  needsRehash,
  verifyPassword,
  verifyPasswordOrDummy,
} from './password.js'

describe('hashPassword', () => {
  it('产出自解释的 Argon2id 编码串', async () => {
    const hash = await hashPassword('correct horse battery staple')

    expect(hash.startsWith('$argon2id$')).toBe(true)
    // 参数必须写在串里——将来提高参数时旧哈希仍可校验
    expect(hash).toContain('$v=19$')
    expect(hash).toContain(`$m=${ARGON2_OPTIONS.memoryCost},t=${ARGON2_OPTIONS.timeCost},p=${ARGON2_OPTIONS.parallelism}$`)
  })

  it('相同密码两次哈希结果不同（盐是随机的）', async () => {
    const a = await hashPassword('correct horse battery staple')
    const b = await hashPassword('correct horse battery staple')
    expect(a).not.toBe(b)
  })

  it('不同密码哈希结果不同', async () => {
    const a = await hashPassword('password one')
    const b = await hashPassword('password two')
    expect(a).not.toBe(b)
  })
})

describe('verifyPassword', () => {
  it('正确密码校验通过', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true)
  })

  it('错误密码校验失败', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword(hash, 'wrong password')).toBe(false)
  })

  it('大小写敏感', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword(hash, 'Correct Horse Battery Staple')).toBe(false)
  })

  it('哈希串损坏时返回 false 而不是抛错', async () => {
    expect(await verifyPassword('not-a-valid-hash', 'anything')).toBe(false)
    expect(await verifyPassword('', 'anything')).toBe(false)
  })

  it('规范化后再校验：全角密码与半角等价', async () => {
    // 注册时用全角，登录时用半角——NFKC 规范化后应视为同一个密码
    const hash = await hashPassword('ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯ')
    expect(await verifyPassword(hash, 'ABCDEFGHIJKLMNO')).toBe(true)
  })
})

describe('verifyPasswordOrDummy', () => {
  it('用户存在且密码正确 → true', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPasswordOrDummy(hash, 'correct horse battery staple')).toBe(true)
  })

  it('用户存在但密码错误 → false', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPasswordOrDummy(hash, 'wrong')).toBe(false)
  })

  it('用户不存在 → false（不是抛错）', async () => {
    expect(await verifyPasswordOrDummy(null, 'anything')).toBe(false)
    expect(await verifyPasswordOrDummy(undefined, 'anything')).toBe(false)
  })

  it('用户不存在与存在但密码错误的耗时应当接近（防账号枚举）', async () => {
    const hash = await hashPassword('correct horse battery staple')

    const timeOf = async (h: string | null) => {
      const t0 = performance.now()
      await verifyPasswordOrDummy(h, 'some candidate password')
      return performance.now() - t0
    }

    // 各跑 3 次取最小值——最小值受噪声影响最小
    const realTimes: number[] = []
    const dummyTimes: number[] = []
    for (let i = 0; i < 3; i++) {
      realTimes.push(await timeOf(hash))
      dummyTimes.push(await timeOf(null))
    }

    const real = Math.min(...realTimes)
    const dummy = Math.min(...dummyTimes)
    const ratio = Math.max(real, dummy) / Math.min(real, dummy)

    // 允许 2 倍差异（CI 机器噪声较大），但不能是数量级差异
    expect(ratio).toBeLessThan(2)
  })
})

describe('needsRehash', () => {
  it('当前参数生成的哈希不需要重哈希', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(needsRehash(hash)).toBe(false)
  })

  it('参数偏低的旧哈希需要重哈希', async () => {
    // 模拟"参数后来被提高"的情况：哈希串里的参数低于当前配置
    const old = '$argon2id$v=19$m=1024,t=1,p=1$c29tZXNhbHRzYWx0c2FsdA$Y2hhb2R1c2FsdHNhbHRzYWx0c2FsdA'
    expect(needsRehash(old)).toBe(true)
  })

  it('无法解析的哈希视为需要重哈希', () => {
    expect(needsRehash('garbage')).toBe(true)
  })
})
