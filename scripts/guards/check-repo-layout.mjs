#!/usr/bin/env node
/**
 * 护栏：仓库布局与必备文件
 *
 * 规则：
 *   1. 开源项目必备文件齐全
 *   2. .gitignore 覆盖运行期数据与敏感文件
 *   3. .gitattributes 统一行尾（Windows 开发 / Linux 部署）
 *   4. 不存在手写 DDL（表结构只能来自迁移）
 *
 * 退出码：0 通过 / 1 违规
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const problems = []

const REQUIRED_FILES = [
  { p: 'README.md', why: '项目门面' },
  { p: 'LICENSE', why: '许可证声明' },
  { p: 'CONTRIBUTING.md', why: '贡献指南' },
  { p: 'CODE_OF_CONDUCT.md', why: '行为准则' },
  { p: 'SECURITY.md', why: '安全策略' },
  { p: '.gitignore', why: '忽略规则' },
  { p: '.gitattributes', why: '行尾与二进制标记' },
  { p: '.editorconfig', why: '跨编辑器一致性' },
  { p: 'docs/architecture/00-项目总体架构与MVP实施方案.md', why: '架构基线' },
  { p: '.github/workflows/ci.yml', why: 'CI 流水线' },
  { p: '.github/PULL_REQUEST_TEMPLATE.md', why: 'PR 模板' },
  { p: 'scripts/verify.mjs', why: '统一验证入口' },
]

for (const f of REQUIRED_FILES) {
  if (!existsSync(path.join(ROOT, f.p))) {
    problems.push(`缺少 ${f.p}（${f.why}）`)
  }
}

// .gitignore 必须忽略的项
const REQUIRED_IGNORE = [
  'node_modules/',
  '.env',
  'data/',
  'uploads/',
  'dist/',
  '.screenshots/',
]

if (existsSync(path.join(ROOT, '.gitignore'))) {
  const gi = readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  for (const item of REQUIRED_IGNORE) {
    if (!gi.includes(item)) {
      problems.push(`.gitignore 未忽略 ${item}`)
    }
  }
}

// .gitattributes 必须统一 LF
if (existsSync(path.join(ROOT, '.gitattributes'))) {
  const ga = readFileSync(path.join(ROOT, '.gitattributes'), 'utf8')
  if (!/\*\s+text=auto\s+eol=lf/.test(ga)) {
    problems.push('.gitattributes 缺少 `* text=auto eol=lf`（Windows 开发 / Linux 部署必须统一行尾）')
  }
}

// 不得存在手写 DDL（表结构只能来自 drizzle-kit 生成的迁移）
const MIGRATION_DIR = path.join(ROOT, 'packages', 'db', 'migrations')
if (existsSync(MIGRATION_DIR)) {
  const { readdirSync, statSync } = await import('node:fs')
  const walk = (d, out = []) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name)
      if (statSync(full).isDirectory()) walk(full, out)
      else out.push(full)
    }
    return out
  }
  for (const f of walk(MIGRATION_DIR)) {
    if (/schema\.sql$|\.ddl$/i.test(f)) {
      problems.push(`存在疑似手写 DDL：${path.relative(ROOT, f)}（表结构只能来自 drizzle-kit 生成的迁移）`)
    }
  }
}

if (problems.length === 0) {
  console.log(`✓ 仓库布局检查通过（${REQUIRED_FILES.length} 个必备文件，${REQUIRED_IGNORE.length} 条忽略规则）`)
  process.exit(0)
}

console.error(`✗ 仓库布局检查发现 ${problems.length} 处问题\n`)
for (const p of problems) console.error('  ' + p)
process.exit(1)
