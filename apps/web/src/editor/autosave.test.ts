/**
 * 自动保存调度器的时序测试。
 *
 * 用假定时器（vi.useFakeTimers）精确控制时间——这类测试如果用
 * 真实等待，要么慢要么偶发失败。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Autosave, type AutosaveState, type SaveOutcome } from './autosave.js'

function makeAutosave(outcomes: SaveOutcome[] = ['saved'], delayMs = 1000) {
  const states: AutosaveState[] = []
  let calls = 0
  const save = vi.fn(async () => {
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)] ?? 'saved'
    calls += 1
    return outcome
  })
  const auto = new Autosave({
    delayMs,
    save,
    onStateChange: (s) => states.push(s),
  })
  return { auto, states, save }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Autosave', () => {
  it('防抖窗口内只发一次保存', async () => {
    const { auto, save } = makeAutosave()
    auto.markDirty()
    auto.markDirty()
    auto.markDirty()

    await vi.advanceTimersByTimeAsync(999)
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('保存成功后状态是 saved', async () => {
    const { auto, states } = makeAutosave()
    auto.markDirty()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runAllTimersAsync()

    expect(states.at(-1)?.kind).toBe('saved')
  })

  it('没有改动时 flush 不发请求', async () => {
    const { auto, save } = makeAutosave()
    await auto.flush()
    expect(save).not.toHaveBeenCalled()
  })

  it('保存期间的新输入会在本次结束后补发（不丢内容）', async () => {
    // 第一次保存慢一点：用 never-resolving 的 promise 手动控制
    let resolveFirst: ((v: SaveOutcome) => void) | null = null
    const states: AutosaveState[] = []
    let calls = 0
    const save = vi.fn(async () => {
      calls += 1
      if (calls === 1) return new Promise<SaveOutcome>((res) => (resolveFirst = res))
      return 'saved' as SaveOutcome
    })
    const auto = new Autosave({ delayMs: 1000, save, onStateChange: (s) => states.push(s) })

    auto.markDirty()
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)

    // 第一次还没回来时又改了内容：状态仍是 saving（不该闪回 dirty）
    auto.markDirty()
    expect(auto.getState().kind).toBe('saving')

    // 第一次完成 → 应立即补发第二次
    resolveFirst!('saved')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(save).toHaveBeenCalledTimes(2)
    expect(states.at(-1)?.kind).toBe('saved')
  })

  it('失败后保留待保存内容，重试能再发', async () => {
    const { auto, states, save } = makeAutosave(['failed', 'saved'])
    auto.markDirty()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runAllTimersAsync()

    expect(states.at(-1)?.kind).toBe('failed')

    await auto.retry()
    expect(save).toHaveBeenCalledTimes(2)
    expect(auto.getState().kind).toBe('saved')
  })

  it('冲突时进入 conflict 状态，不自动重试', async () => {
    const { auto, states, save } = makeAutosave(['conflict'])
    auto.markDirty()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runAllTimersAsync()

    expect(states.at(-1)?.kind).toBe('conflict')
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('只读模式下不启动定时器', async () => {
    const { auto, states, save } = makeAutosave()
    auto.markDirty(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
    expect(states.at(-1)?.kind).toBe('readonly')
  })

  it('dispose 后不再回写状态', async () => {
    const { auto, states } = makeAutosave()
    auto.markDirty()
    const countAfterDirty = states.length
    auto.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(states.length).toBe(countAfterDirty)
  })

  it('discard 之后 flush 不发请求（用户选了载入最新）', async () => {
    const { auto, save } = makeAutosave()
    auto.markDirty()
    auto.discard()
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).not.toHaveBeenCalled()
  })
})
