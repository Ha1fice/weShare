/**
 * Vitest 全局钩子：管理测试库目录。
 *
 * 为什么只在 setup 里清理，不在 teardown 里清理：
 *   libsql 的 `close()` 在 Windows 上不立即释放文件句柄——即便 worker
 *   进程退出后，句柄仍在本进程存活期间被占用。Vitest 的 teardown 阶段
 *   worker 尚未完全退出，此时删目录必然 EPERM。
 *   而 setup 阶段是新一轮运行的开始，上一轮的进程早已退出，句柄已释放，
 *   此时删除必定成功。
 *
 *   代价：测试库文件最多残留一个运行周期，下次运行前自动清掉。
 *   目录在 data/ 下，已被 .gitignore 覆盖，不会入库。
 *
 * Vitest 5 只提供 `globalSetup` 一个文件钩子，
 * `setup` 与 `teardown` 都从这里导出。
 */

import { mkdirSync, rmSync } from 'node:fs'
import { TEST_DB_DIR } from './fixture.js'

/** 运行前：清掉上次残留的测试库。 */
export function setup(): void {
  rmSync(TEST_DB_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  mkdirSync(TEST_DB_DIR, { recursive: true })
}

/**
 * 运行后：只做尽力而为的清理。
 *
 * 大概率会失败（句柄未释放），失败不影响测试结果——
 * 残留由下一次运行的 setup 清掉。刻意不抛错：
 * 清理失败不是测试失败。
 */
export function teardown(): void {
  try {
    rmSync(TEST_DB_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  } catch {
    // 句柄仍被占用——留给下一次运行的 setup 处理
  }
}
