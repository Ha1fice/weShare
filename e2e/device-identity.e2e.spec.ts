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
 * 受管环境装不上浏览器时，verify.mjs 的 e2e 步骤会明确跳过并打印原因
 * （不静默变绿），交付报告里改附手动清单。
 *
 * 截图口径（e2e/artifacts/ 下的 png 全部由本文件与 welcome-password
 * spec 在运行时落盘，属于可复现产物，不是手工截图）：
 *   welcome.png              /welcome 首屏（未交互，不应有校验红）
 *   welcome-filled.png       填好名字、提交前
 *   workspace-home.png       进入后的工作区首页
 *   trash-empty.png          回收站空态（新建→删除→进回收站）
 *   login-password-mode.png  密码模式登录页（见 welcome-password.e2e.spec.ts）
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

    // 未交互不标红：无 aria-invalid（R2 口径，第一屏不能是报错态）
    await expect(page.locator('#display-name')).not.toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('先给自己起个名字')).toHaveCount(0)
    await page.screenshot({ path: 'e2e/artifacts/welcome.png', fullPage: true })

    await page.getByPlaceholder('例如：张三').fill('验收员甲')
    // 填好名字、提交前：同样不标红
    await expect(page.getByText('先给自己起个名字')).toHaveCount(0)
    await page.screenshot({ path: 'e2e/artifacts/welcome-filled.png', fullPage: true })

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

test.describe('回收站空态截图（工单三张截图之一）', () => {
  // 空态的取得方式：全新 context（新身份、新空间）→ 建一篇文档 → 删掉 → 进回收站。
  // 全程走 UI 与真实 API，不改任何回收站语义；截图是运行时产物，可复现。
  test('新建文档 → 删除 → 回收站空态', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()

    await page.goto('/welcome')
    await page.getByPlaceholder('例如：张三').fill('回收站验收员')
    await page.getByRole('button', { name: '进入' }).click()
    await expect(page).not.toHaveURL(/\/welcome/, { timeout: 15_000 })

    // 登录后落在首页（空间列表），先进空间
    await page.getByRole('button', { name: /回收站验收员 的空间/ }).click()
    await expect(page.getByRole('button', { name: '新建', exact: true })).toBeVisible({ timeout: 10_000 })

    // 新建一篇文档
    await page.getByRole('button', { name: '新建', exact: true }).click()
    await page.locator('#create-title').fill('删除演练文档')
    await page.getByRole('button', { name: '创建' }).click()
    // 创建成功会打开文档页：标题框的值就是新标题、协同已连上
    await expect(page.getByRole('textbox', { name: '文档标题' })).toHaveValue('删除演练文档', { timeout: 10_000 })
    await page.getByRole('link', { name: '回到首页' }).click()
    await page.getByRole('button', { name: /回收站验收员 的空间/ }).click()
    await expect(page.getByRole('row', { name: /删除演练文档/ })).toBeVisible({ timeout: 10_000 })

    // 悬停行 → 删除 → 确认弹窗
    const row = page.getByRole('row', { name: /删除演练文档/ })
    await row.hover()
    await row.getByRole('button', { name: '删除' }).click()
    await page.getByRole('button', { name: '移入回收站' }).click()
    await expect(page.getByText('已移入回收站')).toBeVisible({ timeout: 10_000 })

    // 进回收站：应该看到一条待还原批次
    await page.getByRole('link', { name: '回收站' }).first().click()
    await expect(page.getByTestId('trash-batch').first()).toBeVisible({ timeout: 10_000 })

    // 还原整批 → 列表清空 → 空态
    await page.getByRole('button', { name: '还原' }).first().click()
    await expect(page.getByTestId('trash-empty')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('回收站是空的')).toBeVisible()

    await page.screenshot({ path: 'e2e/artifacts/trash-empty.png', fullPage: true })
  })
})
