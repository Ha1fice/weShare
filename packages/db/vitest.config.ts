import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 测试库目录由 globalSetup 管理（setup + teardown 都在该文件里导出）
    globalSetup: ['./test/global-setup.ts'],
    // 各测试文件用独立的库文件（见 fixture.ts），可以并行跑
    include: ['test/**/*.test.ts'],
    // 必须用独立进程（forks），不能用线程池：
    //   libsql 的文件句柄在 worker 进程退出后才释放。线程池下 worker
    //   与主进程同生共死，teardown 时句柄仍被占用，删目录必然 EPERM。
    pool: 'forks',
    // libsql 的文件句柄释放有延迟，给足超时
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
