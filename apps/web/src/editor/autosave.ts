/**
 * 自动保存调度器。
 *
 * 抽成一个纯逻辑类而不是写在组件里，是为了能单独测：
 * "防抖 1.2 秒""保存中又来了新输入，要在当前请求结束后补一次"
 * 这类时序 bug 靠手点很难复现，靠单测却很容易钉住。
 *
 * 三条规则（架构文档 §9.1）：
 *
 *   1. **防抖 1.2 s**：连续输入只在停顿后发一次。
 *   2. **不并发**：一次只有一个请求在飞。保存期间的新输入记成 `pending`，
 *      当前请求回来后立刻补发——否则用户在等待期打的字会被悄悄丢掉。
 *   3. **失败不清 pending**：网络断了就留着，等下次输入或手动重试时再发。
 *      清掉 pending 等于承认"这段内容不要了"。
 */

export type SaveOutcome = 'saved' | 'conflict' | 'failed' | 'readonly'

export interface AutosaveOptions {
  /** 延迟毫秒数。默认 1200（架构文档 §9.1 的 RPO 边界）。 */
  delayMs?: number
  /** 实际写库动作。返回结果决定状态机走向。 */
  save: () => Promise<SaveOutcome>
  /** 状态变化回调（供 UI 渲染）。 */
  onStateChange: (state: AutosaveState) => void
}

export type AutosaveState =
  | { kind: 'idle' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'conflict' }
  | { kind: 'failed'; message: string }
  | { kind: 'readonly' }

export class Autosave {
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false
  private pending = false
  private disposed = false
  private state: AutosaveState = { kind: 'idle' }

  constructor(private readonly options: AutosaveOptions) {}

  private get delay(): number {
    return this.options.delayMs ?? 1200
  }

  /** 当前状态（只读快照）。 */
  getState(): AutosaveState {
    return this.state
  }

  private setState(next: AutosaveState): void {
    if (this.disposed) return
    this.state = next
    this.options.onStateChange(next)
  }

  /**
   * 内容变了。
   *
   * 只读模式下直接进入 readonly 状态，连定时器都不启——省得
   * "明明没权限还一直尝试写"刷出一串 403。
   */
  markDirty(isReadonly = false): void {
    if (this.disposed) return
    if (isReadonly) {
      this.setState({ kind: 'readonly' })
      return
    }
    this.pending = true
    // 保存进行中时不把状态打回 dirty：否则用户会看到"保存中"闪成
    // "未保存"再闪回来。当前请求结束后会自动补发一轮。
    if (!this.inFlight) this.setState({ kind: 'dirty' })
    this.schedule()
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.delay)
  }

  /**
   * 立刻保存（不等防抖）。失焦、切标签页、关闭编辑器都会调它。
   *
   * 没有待保存内容时直接返回——避免"什么都没改也发一个请求"。
   */
  async flush(): Promise<void> {
    if (this.disposed) return
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.pending) return

    // 已有请求在飞：把 pending 留着，它回来后会自动补发
    if (this.inFlight) return

    this.inFlight = true
    this.pending = false
    this.setState({ kind: 'saving' })

    let outcome: SaveOutcome
    try {
      outcome = await this.options.save()
    } catch (err) {
      outcome = 'failed'
      void err
    } finally {
      this.inFlight = false
    }

    if (outcome === 'saved') {
      // 保存期间又来新输入 → 立刻再存一轮
      if (this.pending) {
        this.setState({ kind: 'dirty' })
        void this.flush()
      } else {
        this.setState({ kind: 'saved', at: new Date() })
      }
      return
    }

    if (outcome === 'conflict') {
      this.setState({ kind: 'conflict' })
      return
    }

    if (outcome === 'readonly') {
      this.pending = false
      this.setState({ kind: 'readonly' })
      return
    }

    // 失败：保留 pending，下次输入或重试时再试
    this.pending = true
    this.setState({ kind: 'failed', message: '保存失败，内容仍在本地' })
  }

  /**
   * 回到初始态（内容刚被整体替换，没有待保存内容）。
   *
   * 装载服务端内容后必须调它：编辑器装载时的 update 事件会把状态打成
   * dirty，而实际上什么都没改——界面上就会一直挂着"未保存的改动"。
   */
  reset(): void {
    if (this.inFlight) return
    this.pending = false
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.setState({ kind: 'idle' })
  }

  /** 手动重试（UI 上的"重试"按钮）。 */
  async retry(): Promise<void> {
    this.pending = true
    await this.flush()
  }

  /** 丢弃待保存内容（用户选了"载入最新版本"时）。 */
  discard(): void {
    this.pending = false
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** 组件卸载时调用：清定时器，避免向已卸载组件回写状态。 */
  dispose(): void {
    this.disposed = true
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
