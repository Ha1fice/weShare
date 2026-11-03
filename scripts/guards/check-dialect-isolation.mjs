#!/usr/bin/env node
/**
 * 护栏：方言隔离（架构文档 §4.2 不变式 I7）
 *
 * 规则：packages/db 之外的业务代码不得出现方言标识。
 *
 * 为什么这条必须机械执行：
 * 架构文档承诺"后期切 PostgreSQL 的工作量上限是新增一个 schema 文件 +
 * 一个 driver 文件"。这个承诺只在业务代码从未直接写过方言 SQL 时成立。
 * 而这类泄漏几乎总是"顺手写的"——查个表用了个 where 条件、
 * 插了个 jsonb 类型——不会有人在写的时候想到"这违反了不变式"。
 * 所以只能靠机器查。
 *
 * 退出码：0 通过 / 1 发现违规 / 2 零覆盖（受检范围为空，不算通过）
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 方言标识清单。新增方言时要同步补充。 */
const DIALECT_TOKENS = [
  { token: 'sqlite', re: /\bsqlite\b/i, why: 'SQLite 方言' },
  { token: 'jsonb', re: /\bjsonb\b/i, why: 'PostgreSQL 专有类型' },
  { token: 'timestamptz', re: /\btimestamptz\b/i, why: 'PostgreSQL 专有类型' },
  { token: 'bytea', re: /\bbytea\b/i, why: 'PostgreSQL 专有类型' },
  { token: 'pg_trgm', re: /\bpg_trgm\b/i, why: 'PostgreSQL 扩展' },
  { token: 'gin_trgm_ops', re: /\bgin_trgm_ops\b/i, why: 'PostgreSQL 索引算子' },
  { token: 'gen_random_uuid', re: /\bgen_random_uuid\s*\(/i, why: 'PostgreSQL 函数' },
  { token: 'now()', re: /\bnow\s*\(\s*\)/i, why: 'PostgreSQL 时间函数（用应用层时间戳）' },
]

/** 允许出现方言标识的目录（相对仓库根）。 */
const ALLOWED_DIRS = ['packages/db', 'node_modules', '.git', 'docs', '.agents', 'scripts']

/** 跳过检查的文件与目录。 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.screenshots',
  '.pnpm-store',
  'data',
  'uploads',
])

/**
 * 受检目录：只有业务代码需要隔离方言。
 * scripts/ 是护栏与工具脚本，它们按定义要讨论方言词汇，不受 I7 约束
 * （I7 约束的是 apps/ 与 packages/ 的业务代码）。
 */
const SCAN_DIRS = ['apps', 'packages']

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

function isTextFile(p) {
  return /\.(ts|tsx|js|jsx|mjs|cjs|vue|json|sql)$/i.test(p)
}

const files = []
for (const d of SCAN_DIRS) {
  walk(path.join(ROOT, d), files)
}

const scannable = files.filter((f) => isTextFile(f) && !isAllowed(path.relative(ROOT, f)))

if (scannable.length === 0) {
  console.log('⚠️  零覆盖：受检范围内没有可扫描的源文件。')
  console.log('   目录 ' + SCAN_DIRS.join('/') + ' 下还没有代码。')
  console.log('   这不是通过——护栏没有检查任何东西。')
  console.log('   Phase 1 工程骨架就位后本护栏才会真正生效。')
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
    // 跳过注释行：护栏自己的说明文字里也会提到这些标识
    const trimmed = line.trim()
    if (
      trimmed.startsWith('*') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('#')
    ) {
      return
    }
    for (const t of DIALECT_TOKENS) {
      if (t.re.test(line)) {
        violations.push({ file: rel, line: i + 1, token: t.token, why: t.why, text: trimmed })
      }
    }
  })
}

if (violations.length === 0) {
  console.log(
    `✓ 方言隔离检查通过（扫描 ${scannable.length} 个文件，${DIALECT_TOKENS.length} 类标识）`,
  )
  process.exit(0)
}

console.error(`✗ 发现 ${violations.length} 处方言泄漏（违反不变式 I7）\n`)
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.token}] ${v.why}`)
  console.error(`      ${v.text.slice(0, 100)}`)
}
console.error('\n修法：把方言相关代码收进 packages/db，业务代码改用仓储接口。')
process.exit(1)
