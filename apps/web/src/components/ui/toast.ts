/**
 * Toast 的最小实现。
 *
 * 不用 Pinia：消息是瞬时的、不参与业务状态，放进全局 store
 * 只会让 store 变成一个杂物间。
 */
import { reactive } from 'vue'

export interface Toast {
  id: number
  message: string
  tone: 'success' | 'error' | 'info'
}

export const toasts = reactive<Toast[]>([])

let seq = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export function dismissToast(id: number): void {
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
}

export function toast(message: string, tone: Toast['tone'] = 'success', durationMs = 2600): void {
  const id = ++seq
  toasts.push({ id, message, tone })
  timers.set(
    id,
    setTimeout(() => dismissToast(id), durationMs),
  )
}
