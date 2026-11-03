/**
 * 执行数据库迁移。
 *
 * 开发环境用 `prisma migrate dev`（自动生成新迁移 + 应用），
 * 部署环境用 `prisma migrate deploy`（只应用已检入的迁移，不生成新的）。
 *
 * 两者都必须先 `prisma generate`——Prisma 7 的 migrate 命令不再自动触发生成。
 *
 * ⚠️ 本文件被其他脚本 import 时不得有副作用：主流程只在直接运行时执行。
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')

/** 数据库文件路径。默认在仓库根的 data/weshare.db。 */
export const DEFAULT_DB_PATH = path.resolve(PKG_ROOT, '../../data/weshare.db')

/**
 * 把路径转成 Prisma 可用的 file: URL。
 *
 * Windows 必须是 `file:C:/path/to.db`（两斜杠）。三斜杠形式
 * （`file:///C:/...`）会被 Prisma 7 的 schema engine 拒绝，
 * 报 os error 161「指定的路径无效」。
 */
export function toDatabaseUrl(dbPath: string): string {
  if (dbPath === ':memory:') return 'file::memory:'
  const abs = path.resolve(dbPath).replace(/\\/g, '/')
  return `file:${abs}`
}

/**
 * 在 packages/db 目录执行 prisma CLI。
 *
 * Windows 上 npx 是 .cmd 批处理脚本，Node 无法直接 execve它，必须经 shell。
 * 但 `execFileSync(cmd, args, { shell: true })` 会触发 DEP0190 警告
 * （args 未转义就拼进命令字符串，理论上可注入）。
 *
 * 这里改用 `spawn` + `shell: false`：Windows 下把 npx.cmd 换成
 * `cmd.exe /c npx.cmd <args...>`，参数仍以数组传递，由 cmd 负责解析，
 * 不经过字符串拼接。
 */
export function runPrisma(args: string[], dbPath: string = DEFAULT_DB_PATH): void {
  const cwd = PKG_ROOT
  const env = { ...process.env, DATABASE_URL: toDatabaseUrl(dbPath) }

  const isWindows = process.platform === 'win32'
  const command = isWindows ? 'cmd.exe' : 'npx'
  const commandArgs = isWindows
    ? ['/d', '/s', '/c', 'npx.cmd', 'prisma', ...args]
    : ['prisma', ...args]

  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    stdio: 'inherit',
    shell: false,
  })

  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(' ')} 失败，退出码 ${result.status}`)
  }
}

/** 生成 Prisma Client（Prisma 7 的 migrate 命令不再自动触发）。 */
export function generateClient(dbPath: string = DEFAULT_DB_PATH): void {
  runPrisma(['generate'], dbPath)
}

/** 执行迁移。dev=true 时用 migrate dev，否则用 migrate deploy。 */
export function migrate(dbPath: string = DEFAULT_DB_PATH, dev = false): void {
  if (dev) {
    runPrisma(['migrate', 'dev'], dbPath)
  } else {
    runPrisma(['migrate', 'deploy'], dbPath)
  }
}

async function main(): Promise<void> {
  const dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH
  const isDev = process.env.NODE_ENV === 'development'

  console.log(`→ 数据库：${dbPath}`)
  console.log('→ 生成 Prisma Client…')
  generateClient(dbPath)

  if (isDev) {
    console.log('→ 开发模式：prisma migrate dev（生成并应用迁移）')
  } else {
    console.log('→ 部署模式：prisma migrate deploy（只应用已检入的迁移）')
  }
  migrate(dbPath, isDev)

  console.log('✓ 迁移完成')
}

// 直接运行时才执行主流程；被 import 时不产生副作用
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/')

if (invokedDirectly) {
  main().catch((err) => {
    console.error('✗ 迁移失败：', err)
    process.exit(1)
  })
}
