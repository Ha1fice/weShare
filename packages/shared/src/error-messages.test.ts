import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from './index.js'
import { ERROR_MESSAGES, NETWORK_ERROR_MESSAGE, errorMessage } from './error-messages.js'

/** S1 验收：每个错误码都有非空中文文案（兜底用，后端 message 优先）。 */
describe('ERROR_MESSAGES', () => {
  it('每个错误码都有映射项', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_MESSAGES[code], `缺少 ${code} 的文案`).toBeTruthy()
    }
  })

  it('每个文案都是非空中文', () => {
    for (const code of ERROR_CODES) {
      const msg = ERROR_MESSAGES[code]
      expect(msg.trim().length).toBeGreaterThan(0)
      // 诊断信息（如 requestId）不该出现在兜底文案里
      expect(msg).not.toMatch(/undefined|null|NaN/)
    }
  })

  it('errorMessage：NETWORK_ERROR 用网络文案，不透传诊断信息，也不冒充服务端 5xx', () => {
    expect(errorMessage({ code: 'NETWORK_ERROR' })).toBe(NETWORK_ERROR_MESSAGE)
    expect(errorMessage({ code: 'NETWORK_ERROR', message: 'Failed to fetch (diagnostic)' })).toBe(
      NETWORK_ERROR_MESSAGE,
    )
    // 断网 ≠ 服务器故障：两者文案必须不同，否则用户会往错误方向排查
    expect(NETWORK_ERROR_MESSAGE).not.toBe(ERROR_MESSAGES.INTERNAL_ERROR)
  })

  it('errorMessage：有 message 用 message，空/缺失用兜底', () => {
    expect(errorMessage({ code: 'FORBIDDEN', message: '仅空间所有者或管理员可彻底删除' })).toBe(
      '仅空间所有者或管理员可彻底删除',
    )
    expect(errorMessage({ code: 'FORBIDDEN', message: '' })).toBe(ERROR_MESSAGES.FORBIDDEN)
    expect(errorMessage({ code: 'NOT_FOUND' })).toBe(ERROR_MESSAGES.NOT_FOUND)
  })

  it('5xx 与网络错误用兜底文案', () => {
    expect(errorMessage({ code: 'INTERNAL_ERROR', message: 'stack trace: ...' })).toBe(
      ERROR_MESSAGES.INTERNAL_ERROR,
    )
  })
})
