/**
 * 免密身份真机链路端到端验收（工单 #11 第 3 件事）。
 *
 * 与组件测试的边界：这里跑的是真浏览器 + 真 api + 真数据库，
 * 验证的是"一台设备输个名字 → 进工作区 → 刷新仍是同一个人 →
 * 换浏览器是新身份"这条用户实际会走的路。
 *
 * 前置：
 *   - api 以 DEVICE_IDENTITY=1 启动（playwright.config 的 webServer 负责）
 *   - vite 以 VITE_DEVICE_IDENTITY=true 启动（同上）
 *
 * 受管环境装不上浏览器时，本文件不会被收集执行（playwright.config 里
 * 检测到无浏览器则把 testDir 指到空目录），交付报告里改附手动清单。
 */
import { expect, test, type Page } from '@playwright/test'

/** 从 /api/v1/me 读当前 userId（带页面 Cookie）。 */
async function fetchMeUserId(page: Page): Promise<string | null> {
  const res = await page.request.get('/api/v1/me')
  if (!res.ok()) return null
  const body = (await res.json()) as { user?: { id?: string } }
  return body.user?.id ?? null
}

test.describe('免密身份真机链路', () => {
  test('首屏输名字 → 进工作区 → 自动建好「<名字>的空间」', async ({ page }) => {
    await page.goto('/welcome')

    // 首屏只有一个名字输入，没有密码框
    const inputs = page.locator('input:not([type="hidden"])')
    await expect(inputs).toHaveCount(1)
    await expect(page.locator('input[type="password"]')).toHaveCount(0)

    await page.getByPlaceholder('例如：张三').fill('验收员甲')
    await page.getByRole('button', { name: '进入' }).click()

    // 进工作区：标题栏里能看到「验收员甲 的空间」
    await expect(page).not.toHaveURL(/\/welcome/)
    await expect(page.getByText('验收员甲 的空间').first()).toBeVisible({ timeout: 15_000 })

    // 工作区首页截图
    await page.screenshot({ path: 'e2e/artifacts/workspace-home.png', fullPage: true })
  })

  test('同一 browser context 刷新 → /api/v1/me 返回同一个 userId', async ({ page }) => {
    await page.goto('/welcome')
    await page.getByPlaceholder('例如：张三').fill('验收员乙')
    await page.getByRole('button', { name: '进入' }).click()
    await expect(page).not.toHaveURL(/\/welcome/)

    const before = await fetchMeUserId(page)
    expect(before).toBeTruthy()

    // 同一 context 刷新：localStorage 盐还在，指纹相同 → 同一身份
    await page.reload()
    await expect(page).not.toHaveURL(/\/welcome/)
    const after = await fetchMeUserId(page)
    expect(after).toBe(before)
  })

  test('新 browser context（模拟换浏览器）→ 不同 userId 与新空间', async ({ browser }) => {
    const pageA = await browser.newContext().then((c) => c.newPage())
    await pageA.goto('/welcome')
    await pageA.getByPlaceholder('例如：张三').fill('验收员丙')
    await pageA.getByRole('button', { name: '进入' }).click()
    await expect(pageA).not.toHaveURL(/\/welcome/)
    const userA = await fetchMeUserId(pageA)
    expect(userA).toBeTruthy()
    await expect(pageA.getByText('验收员丙 的空间').first()).toBeVisible()

    // 全新 context：没有 Cookie、没有 localStorage 盐 → 必须是新身份
    const pageB = await browser.newContext().then((c) => c.newPage())
    await pageB.goto('/welcome')
    await pageB.getByPlaceholder('例如：张三').fill('验收员丁')
    await pageB.getByRole('button', { name: '进入' }).click()
    await expect(pageB).not.toHaveURL(/\/welcome/)
    const userB = await fetchMeUserId(pageB)
    expect(userB).toBeTruthy()
    expect(userB).not.toBe(userA)
    await expect(pageB.getByText('验收员丁 的空间').first()).toBeVisible()
  })
})

test.describe('隐私模式退化路径', () => {
  // 隐私窗口 = 无 Cookie 无 localStorage，但指纹仍在。用全新 context + 拦截 localStorage。
  // Safari 隐私窗语义：localStorage 可读不可写（setItem 抛 QuotaExceeded），
  // device-key 的 safeStorage 在此退化成纯指纹，页面必须照常可用。
  test('localStorage 只读（隐私窗）→ 盐写入失败不炸、页面照常可用', async ({ browser }) => {
    const ctx = await browser.newContext()
    await ctx.addInitScript(() => {
      const mem = new Map<string, string>()
      const fake = {
        getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
        setItem: () => {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        },
        removeItem: (k: string) => void mem.delete(k),
        clear: () => void mem.clear(),
        key: () => null,
        get length() {
          return 0
        },
      }
      Object.defineProperty(window, 'localStorage', { get: () => fake, configurable: true })
    })
    const page = await ctx.newPage()
    await page.goto('/welcome')
    // 页面必须正常渲染出输入框（device-key 的 safeStorage 已兜底：退化为纯指纹）
    await expect(page.getByPlaceholder('例如：张三')).toBeVisible()
    // 免密模式页脚有身份提示文案——"不静默失败"的可读面
    await expect(page.getByText('身份记在这台机器上', { exact: false })).toBeVisible()

    // 提交仍应能建立身份（纯指纹兜底），而不是白屏或未知错误
    await page.getByPlaceholder('例如：张三').fill('隐私模式员')
    await page.getByRole('button', { name: '进入' }).click()
    await expect(page).not.toHaveURL(/\/welcome/, { timeout: 15_000 })
  })
})
