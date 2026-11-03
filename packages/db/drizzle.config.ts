import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit 配置。
 *
 * 表结构的唯一真源是 packages/db/src/schema/sqlite.ts，
 * 迁移由 `drizzle-kit generate` 产出并检入 packages/db/migrations/。
 *
 * 禁止手写 DDL（不变式 I7 + 架构文档 Phase 1 验收第 8 条）。
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/sqlite.ts',
  out: './migrations',
  dbCredentials: {
    // 相对仓库根，与 driver.sqlite.ts 的 DEFAULT_DB_PATH 保持一致
    url: `file:${process.env.DB_PATH ?? '../../data/weshare.db'}`,
  },
  strict: true,
  verbose: true,
})
