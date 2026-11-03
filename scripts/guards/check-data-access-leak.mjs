#!/usr/bin/env node
/**
 * 护栏：数据访问隔离（架构文档不变式 I7）
 *
 * 规则（v1.2 修订版）：
 *   1. 业务代码（apps/*、packages/* 除 packages/db 外）**不得**直接 import：
 *      - @prisma/client
 *      - @prisma/adapter-*（数据库驱动适配器）
 *      - @libsql/client、better-sqlite3、pg 等数据库驱动
 *      - packages/db 的内部路径（src/client、src/repo/implementations）
 *   2. packages/db 的**对外导出**（src/index.ts）不得暴露 Prisma 类型或驱动类型。
 *   3. 数据库专属 SQL 与迁移定制只允许存在于 packages/db 内。
 *
 * 为什么要机械执行：
 *   「Service 层不直接依赖 Prisma Client」这条约束靠人自觉必然失效——
 *   一次 import 就能绕过去，而且测试照样绿。隔离一旦破功，
 *   「换数据库只改 packages/db」的承诺就变成谎言。
 *
 * 退出码：0 通过 / 1 发现违规 / 2 零覆盖（业务代码尚不存在）
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 禁止在业务代码中 import 的模块。 */
const FORBIDDEN_IMPORTS = [
  { pattern: /@prisma\/client/, why: 'Prisma Client（必须经 packages/db 的 Repository）' },
  { pattern: /@prisma\/adapter-/, why: 'Prisma 数据库驱动适配器' },
  { pattern: /@libsql\/client/, why: '数据库驱动' },
  { pattern: /better-sqlite3/, why: '数据库驱动' },
  { pattern: /from ['"]pg['"]/, why: '数据库驱动' },
  { pattern: /node:sqlite/, why: '数据库驱动' },
]

/** 禁止 import 的 packages/db 内部路径。 */
const FORBIDDEN_DB_PATHS = [
  { pattern: /@weshare\/db\/src\//, why: 'packages/db 的内部实现' },
  { pattern: /from ['"].*packages\/db\/src\//, why: 'packages/db 的内部实现' },
  { pattern: /@weshare\/db\/generated/, why: 'Prisma 生成的 Client' },
]

/** 受检的业务代码目录。 */
const SCAN_DIRS = ['apps', 'packages']

/** 允许出现上述 import 的位置。 */
const ALLOWED_DIRS = ['packages/db']

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.screenshots',
  'generated', // Prisma 生成产物，不是人写的代码
  '.pnpm-store',
])

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|vue)$/i

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const full = path.join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function isAllowed(relPath) {
  const norm = relPath.replace(/\\/g, '/')
  return ALLOWED_DIRS.some((d) => norm === d || norm.startsWith(d + '/'))
}

const files = []
for (const d of SCAN_DIRS) {
  walk(path.join(ROOT, d), files)
}

const scannable = files.filter((f) => {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/')
  return TEXT_EXT.test(f) && !isAllowed(rel)
})

if (scannable.length === 0) {
  console.log('⚠️  零覆盖：业务代码目录（apps/、packages/ 除 db 外）下没有可扫描的源文件。')
  console.log('   这不是通过——护栏没有检查任何东西。')
  console.log('   Phase 1 的 apps/api、apps/web 等落地后本护栏才会真正生效。')
  process.exit(2)
}

const violations = []

for (const file of scannable) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    // 只看 import 语句，注释里提到不算
    if (!/\b(from|import|require)\b/.test(line)) return
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) return

    for (const f of FORBIDDEN_IMPORTS) {
      if (f.pattern.test(line)) {
        violations.push({
          file: rel,
          line: i + 1,
          why: f.why,
          text: line.trim().slice(0, 100),
        })
      }
    }
    for (const f of FORBIDDEN_DB_PATHS) {
      if (f.pattern.test(line)) {
        violations.push({
          file: rel,
          line: i + 1,
          why: f.why,
          text: line.trim().slice(0, 100),
        })
      }
    }
  })
}

// packages/db 的对外导出不得暴露 Prisma / 驱动类型
const dbIndex = path.join(ROOT, 'packages/db/src/index.ts')
if (existsSyncSafe(dbIndex)) {
  const text = readFileSync(dbIndex, 'utf8')
  const exportLines = text.split('\n').filter((l) => /^\s*export/.test(l))
  for (const line of exportLines) {
    if (/prisma|libsql|driver/i.test(line)) {
      violations.push({
        file: 'packages/db/src/index.ts',
        line: 0,
        why: '对外导出暴露了 Prisma / 驱动类型',
        text: line.trim().slice(0, 100),
      })
    }
  }
}

function existsSyncSafe(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

if (violations.length === 0) {
  console.log(
    `✓ 数据访问隔离检查通过（扫描 ${scannable.length} 个业务源文件，无 ORM / 驱动泄漏）`,
  )
  process.exit(0)
}

console.error(`✗ 发现 ${violations.length} 处数据访问越界（违反不变式 I7）\n`)
for (const v of violations) {
  console.error(`  ${v.file}${v.line ? ':' + v.line : ''}  —— ${v.why}`)
  console.error(`      ${v.text}`)
}
console.error('\n修法：业务代码经 packages/db 暴露的 Repository 接口访问数据。')
console.error('Repository 接口用业务领域类型，不暴露 Prisma Model 或驱动类型。')
process.exit(1)
