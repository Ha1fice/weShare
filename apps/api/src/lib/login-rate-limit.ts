/**
 * 登录失败限流（按 IP）。
 *
 * 架构文档 T2.2：同 IP 5 次/分钟。
 *
 * 为什么按 IP 而不是按账号：
 *   按账号锁定会被攻击者用来**锁死他人账号**（知道邮箱就能让人登不进去）。
 *   按 IP 限流只限制来源，不影响目标账号的可用性。
 *   代价是攻击者可用代理池绕过——但那需要大量资源，且本项目是私有化部署、
 *   一般在内网，威胁模型与公网 SaaS 不同。
 *
 * 为什么不引入 Redis：单机部署不需要共享状态（架构文档 §3.4）。
 * 多实例部署时这个限流器需要换成共享实现——记在 R19 一类的风险里。
 *
 * 实现要点：
 *   - 计数按**时间窗口**（固定窗口），不是滑动窗口——实现简单且够用；
 *   - 窗口内失败次数达到阈值即锁定，直到窗口结束；
 *   - 登录成功即清零该 IP 的计数（正常用户不该被前一次误操作拖累）；
 *   - 定时清理过期条目，避免内存无限增长。
 */

export interface RateLimitOptions {
  /** 窗口内的最大失败次数。超过即锁定。 */
  maxAttempts: number
  /** 窗口长度（毫秒）。 */
  windowMs: number
}

export const DEFAULT_LOGIN_LIMIT: RateLimitOptions = {
  maxAttempts: 5,
  windowMs: 60_000,
}

interface Bucket {
  count: number
  /** 窗口结束时间戳（毫秒）。 */
  expiresAt: number
}

export class LoginRateLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly options: RateLimitOptions

  constructor(options: RateLimitOptions = DEFAULT_LOGIN_LIMIT) {
    this.options = options
  }

  /**
   * 记录一次失败。
   *
   * @param key 通常是 IP 地址
   */
  recordFailure(key: string): void {
    const now = Date.now()
    const bucket = this.buckets.get(key)

    if (!bucket || bucket.expiresAt <= now) {
      // 新窗口
      this.buckets.set(key, { count: 1, expiresAt: now + this.options.windowMs })
      return
    }

    bucket.count += 1
  }

  /**
   * 登录成功后清零计数。
   *
   * 正常用户不该因为之前的误操作被继续限流。
   */
  recordSuccess(key: string): void {
    this.buckets.delete(key)
  }

  /**
   * 当前是否被锁定。
   *
   * 语义：**允许 maxAttempts 次失败尝试，第 maxAttempts 次失败后即锁定**，
   * 也就是第 maxAttempts+1 次请求被拒（429）。
   *
   * 因此判定条件是 `count >= maxAttempts`——
   * 用 `>` 会多给一次机会：第 maxAttempts 次失败后仍然放行，
   * 攻击者实际能试 maxAttempts+1 次。
   *
   * @param key 通常是 IP 地址
   */
  isLocked(key: string): boolean {
    const bucket = this.buckets.get(key)
    if (!bucket) return false

    if (bucket.expiresAt <= Date.now()) {
      this.buckets.delete(key)
      return false
    }

    return bucket.count >= this.options.maxAttempts
  }

  /**
   * 剩余锁定时间（毫秒）。未锁定时返回 0。
   *
   * 用于给客户端一个明确的"请在 N 秒后重试"，而不是笼统的 429。
   */
  retryAfterMs(key: string): number {
    const bucket = this.buckets.get(key)
    if (!bucket) return 0
    if (bucket.expiresAt <= Date.now()) {
      this.buckets.delete(key)
      return 0
    }
    return bucket.expiresAt - Date.now()
  }

  /**
   * 剩余可尝试次数。用于测试与诊断。
   *
   * 与 isLocked 保持同一语义：还有 maxAttempts 次机会时返回该值。
   */
  remainingAttempts(key: string): number {
    const bucket = this.buckets.get(key)
    if (!bucket || bucket.expiresAt <= Date.now()) return this.options.maxAttempts
    return Math.max(0, this.options.maxAttempts - bucket.count)
  }

  /**
   * 清理过期条目。
   *
   * 定期调用，避免长期运行后 Map 无限增长（每个 IP 一个条目）。
   */
  prune(): void {
    const now = Date.now()
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) this.buckets.delete(key)
    }
  }

  /**
   * 清空所有计数。
   *
   * 供测试隔离使用——计数是进程内状态，不在数据库里，
   * 重建测试库不会清掉它。
   */
  reset(): void {
    this.buckets.clear()
  }
}
