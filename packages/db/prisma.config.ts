import path from 'node:path'
import { defineConfig } from 'prisma/config'

/**
 * Prisma 7 配置。
 *
 * Prisma 7 起连接 URL 不能写在 schema 的 datasource 里，必须放这里；
 * schema 文件路径也必须显式声明。
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx scripts/seed.ts',
  },
  datasource: {
    // 用 process.env 而非 env()：env() 在变量缺失时抛错，
    // 而 `pnpm install` 的 postinstall（prisma generate）阶段通常没有
    // DATABASE_URL。给一个默认值兜底，迁移命令会显式传入真实 URL。
    url: process.env.DATABASE_URL ?? 'file:../../data/weshare.db',
  },
})
