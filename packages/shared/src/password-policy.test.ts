import { describe, expect, it } from 'vitest'
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  checkPasswordPolicy,
  normalizePassword,
  passwordPolicyMessage,
} from './index.js'

describe('checkPasswordPolicy', () => {
  it('接受 15 字符（下限）', () => {
    expect(checkPasswordPolicy('a'.repeat(PASSWORD_MIN_LENGTH)).ok).toBe(true)
  })

  it('拒绝 14 字符（下限减一）', () => {
    const r = checkPasswordPolicy('a'.repeat(PASSWORD_MIN_LENGTH - 1))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('too_short')
  })

  it('接受 64 字符（上限）', () => {
    expect(checkPasswordPolicy('a'.repeat(PASSWORD_MAX_LENGTH)).ok).toBe(true)
  })

  it('拒绝 65 字符（上限加一）', () => {
    const r = checkPasswordPolicy('a'.repeat(PASSWORD_MAX_LENGTH + 1))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('too_long')
  })

  it('不要求字符类型组合——纯小写长句也应通过', () => {
    expect(checkPasswordPolicy('this is a long passphrase').ok).toBe(true)
  })

  it('不要求字符类型组合——纯数字也应通过', () => {
    expect(checkPasswordPolicy('1234567890123456').ok).toBe(true)
  })

  it('接受中文密码', () => {
    // 15 个汉字（码点计数，不是字节数——UTF-8 下是 45 字节）
    expect(checkPasswordPolicy('这是一段足够长的中文密码示例啊').ok).toBe(true)
  })

  it('长度按 Unicode 码点计而非 UTF-16 单元', () => {
    // 15 个 emoji：UTF-16 下是 30 个单元，码点是 15 个
    const emoji = '😀'.repeat(15)
    expect(checkPasswordPolicy(emoji).ok).toBe(true)
  })

  it('不静默截断超长密码——而是明确拒绝', () => {
    // 若静默截断，"A"×100 与 "A"×64 会等价，削弱长密码短语
    const r = checkPasswordPolicy('A'.repeat(100))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('too_long')
  })

  it('空密码被拒绝', () => {
    expect(checkPasswordPolicy('').ok).toBe(false)
  })
})

describe('passwordPolicyMessage', () => {
  it('给出可读提示', () => {
    const short = checkPasswordPolicy('a')
    expect(short.ok === false && passwordPolicyMessage(short)).toContain(
      String(PASSWORD_MIN_LENGTH),
    )

    const long = checkPasswordPolicy('a'.repeat(200))
    expect(long.ok === false && passwordPolicyMessage(long)).toContain(
      String(PASSWORD_MAX_LENGTH),
    )
  })
})

describe('normalizePassword', () => {
  it('全角字符被规范化为半角', () => {
    // ＡＢＣ → ABC
    expect(normalizePassword('ＡＢＣ')).toBe('ABC')
  })

  it('全角数字被规范化为半角', () => {
    expect(normalizePassword('１２３')).toBe('123')
  })

  it('兼容分解形式被规范化为合成形式', () => {
    // 用码点构造，避免源码里的字面量被编辑器/工具链预先规范化
    const decomposed = String.fromCharCode(0x65, 0x0301) // e + U+0301 组合重音
    const composed = String.fromCharCode(0x00e9) // U+00E9 预组合
    expect([...decomposed]).toHaveLength(2)
    expect([...composed]).toHaveLength(1)
    expect(normalizePassword(decomposed)).toBe(normalizePassword(composed))
  })

  it('ASCII 密码不变', () => {
    expect(normalizePassword('correct horse battery staple')).toBe(
      'correct horse battery staple',
    )
  })

  it('规范化是幂等的', () => {
    const s = 'ＡＢＣ é １２３'
    expect(normalizePassword(normalizePassword(s))).toBe(normalizePassword(s))
  })
})
