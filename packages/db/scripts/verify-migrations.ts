/**
 * 迁移校验（T1.3 判据）。
 *
 * 1. 从空库执行全部迁移 → 不报错
 * 2. 再执行一次 → 无副作用（幂等）
 * 3. 结构与原设计逐项一致（对照基准见 verify-structure.ts）
 * 4. 运行时行为正确：级联删除、软删除、email 大小写唯一
 */

import { rmSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPrisma, toDatabaseUrl } from './migrate.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')

/**
 * 执行一条本地命令。
 *
 * Windows 上 npx 是 .cmd 批处理，必须经 cmd.exe；参数以数组传递，
 * 不做字符串拼接（避免 DEP0190 注入警告）。
 */
function runNode(args: string[], extraEnv: Record<string, string>): void {
  const isWindows = process.platform === 'win32'
  const command = isWindows ? 'cmd.exe' : 'npx'
  const commandArgs = isWindows
    ? ['/d', '/s', '/c', 'npx.cmd', ...args]
    : args

  const result = spawnSync(command, commandArgs, {
    cwd: PKG_ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: false,
  })

  if (result.status !== 0) {
    fail(`命令 ${args.join(' ')} 失败，退出码 ${result.status}`)
  }
}

function fail(message: string): never {
  console.error(`✗ 迁移校验失败：${message}`)
  process.exit(1)
}

async function main(): Promise<void> {
  // 校验库放在仓库的 data/ 下，而不是系统临时目录——
  // 实测 Prisma 7 的 schema engine 无法在 %LOCALAPPDATA%\Temp 下创建 SQLite 文件
  // （报 os error 161「指定的路径无效」），但同目录下的相对/绝对路径都正常。
  const dir = path.resolve(PKG_ROOT, '../../data/verify-tmp')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const dbPath = path.join(dir, 'verify.db')

  try {
    // --- 1. 首次迁移 ---
    console.log('→ 首次执行迁移…')
    runPrisma(['migrate', 'deploy'], dbPath)

    // --- 2. 幂等：再执行一次 ---
    console.log('→ 二次执行迁移（幂等检查）…')
    try {
      runPrisma(['migrate', 'deploy'], dbPath)
    } catch (err) {
      fail(`二次执行迁移报错，说明迁移不幂等：\n${String(err)}`)
    }

    // --- 3 & 4. 结构与行为对照 ---
    console.log('→ 结构与行为对照…')
    runNode(['tsx', path.join(HERE, 'verify-structure.ts')], {
      VERIFY_DB_PATH: dbPath,
    })

    // --- 5. 迁移状态检测（漂移检查）---
    console.log('→ 迁移状态…')
    runNode(['prisma', 'migrate', 'status'], {
      DATABASE_URL: toDatabaseUrl(dbPath),
    })

    console.log('\n✓ 迁移校验全部通过')
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

main().catch((err) => {
  console.error('✗ 迁移校验异常：', err)
  process.exit(1)
})
