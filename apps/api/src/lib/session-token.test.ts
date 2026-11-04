import { describe, expect, it } from 'vitest'
import { generateToken, hashToken, safeEqualHash, tokenMatches } from './session-token.js'

describe('generateToken', () => {
  it('每次生成不同的 token', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()))
    expect(tokens.size).toBe(50)
  })

  it('长度足够（32 字节 = 256 位熵，base64url 后 43 字符）', () => {
    const token = generateToken()
    expect(token.length).toBe(43)
  })

  it('是 URL 安全的（base64url：无 + / =）', () => {
    for (let i = 0; i < 20; i++) {
      const token = generateToken()
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })
})

describe('hashToken', () => {
  it('是 sha256（32 字节）', () => {
    const hash = hashToken('some-token')
    expect(hash).toHaveLength(32)
  })

  it('相同 token 得到相同哈希', () => {
    expect(hashToken('abc').equals(hashToken('abc'))).toBe(true)
  })

  it('不同 token 得到不同哈希', () => {
    expect(hashToken('abc').equals(hashToken('abd'))).toBe(false)
  })
})

describe('tokenMatches', () => {
  it('匹配的 token 通过', () => {
    const token = generateToken()
    expect(tokenMatches(token, hashToken(token))).toBe(true)
  })

  it('不匹配的 token 不通过', () => {
    const token = generateToken()
    expect(tokenMatches(generateToken(), hashToken(token))).toBe(false)
  })

  it('不泄露明文——哈希里不含 token 本身', () => {
    const token = generateToken()
    const hash = hashToken(token)
    expect(hash.toString('utf8')).not.toContain(token)
    expect(hash.toString('hex')).not.toContain(token)
  })
})

describe('safeEqualHash', () => {
  it('相同内容通过', () => {
    const h = hashToken('x')
    expect(safeEqualHash(h, hashToken('x'))).toBe(true)
  })

  it('不同长度直接 false（不抛错）', () => {
    expect(safeEqualHash(Buffer.alloc(32), Buffer.alloc(16))).toBe(false)
  })

  it('不同内容 false', () => {
    expect(safeEqualHash(hashToken('a'), hashToken('b'))).toBe(false)
  })
})
