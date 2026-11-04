import { describe, expect, it } from 'vitest'
import { LoginRateLimiter } from './login-rate-limit.js'

describe('LoginRateLimiter', () => {
  it('初始不锁定', () => {
    const limiter = new LoginRateLimiter()
    expect(limiter.isLocked('1.2.3.4')).toBe(false)
    expect(limiter.remainingAttempts('1.2.3.4')).toBe(5)
  })

  it('允许 5 次尝试，第 5 次失败后锁定', () => {
    const limiter = new LoginRateLimiter({ maxAttempts: 5, windowMs: 60_000 })

    // 前 4 次失败后仍未锁定
    for (let i = 1; i <= 4; i++) {
      limiter.recordFailure('ip')
      expect(limiter.isLocked('ip')).toBe(false)
      expect(limiter.remainingAttempts('ip')).toBe(5 - i)
    }

    // 第 5 次失败 → 锁定生效，第 6 次请求被拒
    limiter.recordFailure('ip')
    expect(limiter.isLocked('ip')).toBe(true)
    expect(limiter.remainingAttempts('ip')).toBe(0)
  })

  it('不同 IP 互不影响', () => {
    const limiter = new LoginRateLimiter({ maxAttempts: 2, windowMs: 60_000 })

    limiter.recordFailure('ip-a')
    limiter.recordFailure('ip-a')
    limiter.recordFailure('ip-a')

    expect(limiter.isLocked('ip-a')).toBe(true)
    expect(limiter.isLocked('ip-b')).toBe(false)
  })

  it('登录成功后清零计数', () => {
    const limiter = new LoginRateLimiter({ maxAttempts: 3, windowMs: 60_000 })

    limiter.recordFailure('ip')
    limiter.recordFailure('ip')
    expect(limiter.remainingAttempts('ip')).toBe(1)

    limiter.recordSuccess('ip')
    expect(limiter.remainingAttempts('ip')).toBe(3)
    expect(limiter.isLocked('ip')).toBe(false)
  })

  it('窗口结束后自动解锁', () => {
    const limiter = new LoginRateLimiter({ maxAttempts: 1, windowMs: 50 })

    limiter.recordFailure('ip')
    limiter.recordFailure('ip')
    expect(limiter.isLocked('ip')).toBe(true)

    // 等待窗口过去
    const until = Date.now() + 80
    while (Date.now() < until) {
      /* 忙等——测试里用真实时间流逝验证过期行为 */
    }

    expect(limiter.isLocked('ip')).toBe(false)
    expect(limiter.remainingAttempts('ip')).toBe(1)
  })

  it('retryAfterMs 给出剩余锁定时间', () => {
    const limiter = new LoginRateLimiter({ maxAttempts: 1, windowMs: 10_000 })

    limiter.recordFailure('ip')
    limiter.recordFailure('ip')

    const remaining = limiter.retryAfterMs('ip')
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThanOrEqual(10_000)
  })

  it('未锁定时 retryAfterMs 为 0', () => {
    const limiter = new LoginRateLimiter()
    expect(limiter.retryAfterMs('ip')).toBe(0)
  })

  it('prune 清掉过期条目', () => {
    const limiter = new LoginRateLimiter({ maxAttempts: 1, windowMs: 30 })

    limiter.recordFailure('ip-1')
    limiter.recordFailure('ip-1')

    const until = Date.now() + 50
    while (Date.now() < until) {
      /* 忙等 */
    }

    limiter.prune()
    // 过期后不再锁定
    expect(limiter.isLocked('ip-1')).toBe(false)
  })
})
