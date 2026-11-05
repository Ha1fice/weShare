import { describe, expect, it } from 'vitest'
import {
  coarseUserAgent,
  readOrCreateSalt,
  resolveDeviceKey,
  serializeTraits,
  type DeviceTraits,
} from '@/lib/device-key.js'

/** 设备指纹的两个要求：同输入同输出、不同输入不同输出。 */

const TRAITS: DeviceTraits = {
  timezone: 'Asia/Shanghai',
  language: 'zh-CN',
  screen: '1920x1080x24',
  hardwareConcurrency: 8,
  touchPoints: 0,
  userAgent: 'Chrome/120',
}

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage
}

describe('device-key', () => {
  it('sha256 输出 64 位 hex，且同输入稳定', async () => {
    const a = await resolveDeviceKey(TRAITS, 'salt')
    const b = await resolveDeviceKey(TRAITS, 'salt')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)
  })

  it('盐或指纹不同都得到不同 key', async () => {
    const base = await resolveDeviceKey(TRAITS, 'salt-1')
    expect(await resolveDeviceKey(TRAITS, 'salt-2')).not.toBe(base)
    expect(await resolveDeviceKey({ ...TRAITS, screen: '2560x1440x24' }, 'salt-1')).not.toBe(base)
  })

  it('序列化不依赖对象键序', () => {
    const reordered = {
      userAgent: TRAITS.userAgent,
      touchPoints: TRAITS.touchPoints,
      hardwareConcurrency: TRAITS.hardwareConcurrency,
      screen: TRAITS.screen,
      language: TRAITS.language,
      timezone: TRAITS.timezone,
    }
    expect(serializeTraits(reordered)).toBe(serializeTraits(TRAITS))
  })

  it('盐只生成一次，之后复用', () => {
    const storage = fakeStorage()
    const first = readOrCreateSalt(storage)
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(readOrCreateSalt(storage)).toBe(first)
  })

  it('storage 不可用时退化为空盐而不是抛错', () => {
    expect(readOrCreateSalt(undefined)).toBe('')
  })

  it('UA 只取大版本：升级小版本不该换身份', () => {
    const v120 = coarseUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.6099.109 Safari/537.36',
    )
    const v120again = coarseUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.6100.2 Safari/537.36',
    )
    expect(v120).toBe('Chrome/120')
    expect(v120again).toBe(v120)
  })
})
