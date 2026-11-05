/**
 * 设备指纹 → 身份 key。
 *
 * 目标只有一个：**同一台设备、同一个浏览器再次打开页面，能拿到同一个 key**，
 * 这样服务端就能把它映射回同一个账号，不需要任何登录流程。
 *
 * 采集的是"稳定但无害"的几项：时区、语言、屏幕尺寸与色深、CPU 核数、UA、
 * 触摸点数。刻意**不采集** canvas/WebGL 指纹与字体列表——那类指纹精度更高，
 * 但会让人脸识别式的追踪成本降到零，而这里根本不需要那么高的精度：
 * 我们只需要"能把自己认出来"，认错了也只是换了个新身份，不会串到别人。
 *
 * 精度不够的部分用 localStorage 里的随机盐补足（见 resolveDeviceKey）：
 * 指纹负责跨"存储被清空"的场景，盐负责把同型号设备区分开。
 */

/** 指纹采集结果（纯函数所需的最小输入，便于单测）。 */
export interface DeviceTraits {
  timezone: string
  language: string
  screen: string
  hardwareConcurrency: number
  touchPoints: number
  userAgent: string
}

/** 从浏览器读取指纹要素。非浏览器环境（测试/SSR）返回空值。 */
export function readDeviceTraits(win: Window | undefined = globalThis.window): DeviceTraits {
  if (!win) {
    return {
      timezone: '',
      language: '',
      screen: '',
      hardwareConcurrency: 0,
      touchPoints: 0,
      userAgent: '',
    }
  }

  const nav = win.navigator
  return {
    timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone, ''),
    language: nav?.language ?? '',
    screen: safe(
      () => `${win.screen.width}x${win.screen.height}x${win.screen.colorDepth}`,
      '',
    ),
    hardwareConcurrency: nav?.hardwareConcurrency ?? 0,
    // UA 只取粗粒度信息，避免把浏览器小版本号带进身份（升级浏览器不该换身份）
    userAgent: coarseUserAgent(nav?.userAgent ?? ''),
    touchPoints: nav?.maxTouchPoints ?? 0,
  }
}

/**
 * UA 粗化：只留"平台 + 引擎 + 大版本"。
 *
 * 浏览器升级会改小版本号，若参与指纹，Chromium 每六周升级一次就要换一次身份。
 */
export function coarseUserAgent(ua: string): string {
  const browser = /Edg\/(\d+)/.exec(ua)
  if (browser) return `Edge/${browser[1]}`
  const chrome = /Chrome\/(\d+)/.exec(ua)
  if (chrome) return `Chrome/${chrome[1]}`
  const firefox = /Firefox\/(\d+)/.exec(ua)
  if (firefox) return `Firefox/${firefox[1]}`
  const safari = /Version\/(\d+).*Safari/.exec(ua)
  if (safari) return `Safari/${safari[1]}`
  return 'Unknown'
}

/** 把指纹要素序列化成稳定字符串——键序固定，不能依赖对象遍历顺序。 */
export function serializeTraits(t: DeviceTraits): string {
  return [
    t.timezone,
    t.language,
    t.screen,
    String(t.hardwareConcurrency),
    String(t.touchPoints),
    t.userAgent,
  ].join('|')
}

/** 取（或首次生成）localStorage 里的设备盐。 */
export function readOrCreateSalt(storage: Storage | undefined): string {
  if (!storage) return ''
  try {
    const existing = storage.getItem('weshare.device.salt')
    if (existing) return existing
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)
    const salt = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    storage.setItem('weshare.device.salt', salt)
    return salt
  } catch {
    // 隐私模式下 localStorage 可能直接抛错——退化为纯指纹，仍能用，只是稳定性差些
    return ''
  }
}

/** sha256 → 64 位 hex（服务端契约见 shared 的 DeviceKeySchema）。 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 算出当前的设备 key。
 *
 * 组成：指纹 + localStorage 盐。盐让"同型号同配置的两台机器"不会撞成同一个身份，
 * 指纹则在盐丢失（清缓存、换存储分区）后仍能把人认回来。
 */
export async function resolveDeviceKey(
  traits?: DeviceTraits,
  salt?: string,
): Promise<string> {
  const resolvedTraits = traits ?? readDeviceTraits()
  const resolvedSalt = salt ?? readOrCreateSalt(safeStorage())
  return sha256Hex(`weshare-device-v1|${serializeTraits(resolvedTraits)}|${resolvedSalt}`)
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    return undefined
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}
