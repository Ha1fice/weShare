import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
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
 * 容器里装不上浏览器时（离线/体积受限），用 PW_SKIP_BROWSER=1 跳过执行，
 * 交付报告按工单「说明」走手动清单降级路径。
 */

// playwright CLI 安装的浏览器位置；找不到就视为"本环境无法跑 e2e"
const BROWSER_DIR = join(homedir(), '.cache', 'ms-playwright')
export const browserAvailable = existsSync(BROWSER_DIR)

export default defineConfig({
  testDir: 'e2e',
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
          // 协同服务：打开文档页一律走 Y.Doc（DocPage「一律走协同」分支），
          // 不起它页面状态就是「已断线」，回收站用例会被文档页卡住
          command:
            // 不用 pnpm --filter dev（tsx watch）：watcher 在 CI 容器里会让整条
            // 命令静默退出。改用一次性启动——start() 返回后 server 还挂着，
            // 进程不退出，正好当 webServer 用。LOG_LEVEL 用 debug 是因为
            // collab 的 zod 配置不认 silent。
            'cd apps/collab && PORT=3111 DB_PATH=data/weshare-e2e-device.db ALLOWED_ORIGINS=http://127.0.0.1:5173 LOG_LEVEL=debug node_modules/.bin/tsx scripts-dev-serve.mts',
          port: 3111,
          reuseExistingServer: false,
          stdout: 'ignore',
          stderr: 'pipe',
        },
        {
          command:
            'VITE_DEVICE_IDENTITY=true API_PROXY_TARGET=http://127.0.0.1:3101 COLLAB_PROXY_TARGET=ws://127.0.0.1:3111 WEB_PORT=5173 pnpm --filter @weshare/web dev',
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
