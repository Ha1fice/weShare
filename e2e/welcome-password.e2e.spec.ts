/**
 * 密码模式（免密关）下的 /welcome 行为——工单 #11 第 3 件事的断言 4。
 *
 * login-password-mode.png 由本文件运行时落盘（非手工截图）。
 *
 * 跑在 password project 上：api 的 DEVICE_IDENTITY=false、
 * web 的 VITE_DEVICE_IDENTITY=false（端口 5174）。
 */
import { expect, test } from '@playwright/test'

test.use({ baseURL: 'http://127.0.0.1:5174' })

test.describe('免密关：/welcome 不生效', () => {
  test('身份接口 404，受保护路由回落登录页', async ({ page }) => {
    const res = await page.request.post('/api/v1/auth/device', {
      data: { deviceKey: 'a'.repeat(64), displayName: '不应该成功' },
    })
    expect(res.status()).toBe(404)

    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    // 登录页表单要可见——不是白屏也不是 welcome
    await expect(page.locator('form').first()).toBeVisible()

    // 密码模式登录页截图（工单三张截图口径之一，spec 运行时落盘）
    await page.screenshot({ path: 'e2e/artifacts/login-password-mode.png', fullPage: true })
  })
})
