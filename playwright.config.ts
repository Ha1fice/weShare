import { defineConfig, devices } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

/**
 * e2e 配置（免密身份真机链路，工单 #11）。
 *
 * 放在仓库根：要同时拉起 api（两种模式）+ vite，跨 workspace 的编排
 * 不适合塞进 apps/web。两组用例靠文件名分流：
 *   - *.device.e2e.spec.ts  → DEVICE_IDENTITY=1 / VITE_DEVICE_IDENTITY=true
 *   - *.password.e2e.spec.ts → 两边关（免密关，/welcome 不生效）
 *
 * 容器里装不上浏览器时（离线/体积受限），testDir 指到空目录，
 * 用例自动归零而不是起跑即崩；交付报告按工单「说明」走手动清单降级路径。
 */

// playwright CLI 安装的浏览器位置；找不到就视为"本环境无法跑 e2e"
const BROWSER_DIR = join(homedir(), '.cache', 'ms-playwright')
export const browserAvailable = existsSync(BROWSER_DIR)

// 无浏览器时把 testDir 指到空目录：playwright 对空目录报 "no tests found"，
// 这是受控跳过，而不是 5 条用例逐一起跑崩在 launch 上
const EMPTY_TEST_DIR = 'e2e/artifacts/.tmp/no-browser'
if (!browserAvailable) mkdirSync(EMPTY_TEST_DIR, { recursive: true })

export default defineConfig({
  testDir: browserAvailable ? 'e2e' : EMPTY_TEST_DIR,
  testMatch: /.*\.e2e\.spec\.ts/,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'e2e/artifacts/.tmp',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'device', testIgnore: /password/ },
    { name: 'password', testIgnore: /device/ },
  ],
  webServer: browserAvailable
    ? [
        {
          command: 'DB_PATH=data/weshare-e2e-device.db pnpm --filter @weshare/db db:migrate && DB_PATH=data/weshare-e2e-password.db pnpm --filter @weshare/db db:migrate && touch data/.e2e-migrated',
          cwd: process.cwd(),
          reuseExistingServer: false,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command:
            'DEVICE_IDENTITY=true DB_PATH=data/weshare-e2e-device.db PORT=3101 LOG_LEVEL=silent pnpm --filter @weshare/api dev',
          port: 3101,
          reuseExistingServer: false,
          stdout: 'ignore',
          stderr: 'pipe',
        },
        {
          command:
            'VITE_DEVICE_IDENTITY=true API_PROXY_TARGET=http://127.0.0.1:3101 WEB_PORT=5173 pnpm --filter @weshare/web dev',
          port: 5173,
          reuseExistingServer: false,
          stdout: 'ignore',
          stderr: 'pipe',
        },
        {
          command:
            'DEVICE_IDENTITY=false DB_PATH=data/weshare-e2e-password.db PORT=3102 LOG_LEVEL=silent pnpm --filter @weshare/api dev',
          port: 3102,
          reuseExistingServer: false,
          stdout: 'ignore',
          stderr: 'pipe',
        },
        {
          command:
            'VITE_DEVICE_IDENTITY=false API_PROXY_TARGET=http://127.0.0.1:3102 WEB_PORT=5174 pnpm --filter @weshare/web dev',
          port: 5174,
          reuseExistingServer: false,
          stdout: 'ignore',
          stderr: 'pipe',
        },
      ]
    : [],
})
