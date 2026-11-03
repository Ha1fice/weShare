#!/usr/bin/env node
/**
 * 护栏：测试清单守卫
 *
 * 规则：磁盘上的测试文件必须都被 package.json 的 test 脚本覆盖。
 *
 * 为什么需要它：
 * 最常见的静默失败是——开发者新增了 xxx.test.ts，测试跑起来是绿的，
 * 因为 test 脚本里手工枚举的路径没加上这个文件。于是这个测试从写下那天起
 * 就从来没有执行过，而 CI 全绿，没有任何信号。
 *
 * 两种实现路线：
 *   A. 手工枚举测试路径（本守卫适用）
 *   B. 用 glob 通配（如 vitest 默认收集所有 .test.ts 文件）
 * 路线 B 不需要这个守卫，因为 glob 天然覆盖新文件。
 * 本项目 Phase 1 起步时用 Vitest 默认收集，届时本守卫会自动判定为不适用。
 *
 * 退出码：0 通过 / 1 发现漏登记 / 2 零覆盖（尚无测试基础设施）
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.screenshots',
  'data',
  'uploads',
])

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

const isTestFile = (p) =>
  /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(p) ||
  /(^|[\\/])__tests__[\\/]/i.test(p)

const allFiles = walk(ROOT)
const testFiles = allFiles.filter(isTestFile).map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))

// 找到所有 package.json，收集它们的 test 脚本
const pkgFiles = allFiles.filter((f) => path.basename(f) === 'package.json')
const manifests = []
for (const p of pkgFiles) {
  try {
    const raw = readFileSync(p, 'utf8')
    const json = JSON.parse(raw)
    manifests.push({
      rel: path.relative(ROOT, p).replace(/\\/g, '/'),
      testScript: json.scripts?.test ?? null,
    })
  } catch {
    /* 解析失败忽略，由 lint 负责 */
  }
}

const withTest = manifests.filter((m) => m.testScript)

if (testFiles.length === 0 && withTest.length === 0) {
  console.log('⚠️  零覆盖：尚未建立测试基础设施（无 package.json test 脚本，无测试文件）。')
  console.log('   Phase 1 T0.3 提交工程骨架、T0.x 接入测试框架后本守卫才生效。')
  process.exit(2)
}

// 收集所有 test 脚本里出现过的路径片段
const covered = new Set()
for (const m of withTest) {
  const script = m.testScript
  // 判断是否用了 glob 通配——用了就不需要逐个登记
  if (/[*?[\]]/.test(script)) {
    covered.add('*GLOB*')
  }
  for (const token of script.split(/\s+/)) {
    if (!token || token.startsWith('-')) continue
    if (/[*?[\]]/.test(token)) continue
    const cleaned = token.replace(/^['"]|['"]$/g, '')
    if (cleaned.includes('/') || cleaned.includes('.')) {
      covered.add(path.basename(cleaned))
    }
  }
}

if (covered.has('*GLOB*')) {
  console.log(
    `✓ 测试清单检查通过：test 脚本使用 glob 通配，新测试文件自动纳入（${manifests.length} 个 manifest）`,
  )
  process.exit(0)
}

// 没有 glob 时，逐个文件比对
const missing = testFiles.filter((f) => {
  const base = path.basename(f)
  const dir = path.dirname(f)
  return ![...covered].some((c) => c === base || c === f || c === dir || dir.endsWith(c))
})

if (missing.length === 0) {
  console.log(`✓ 测试清单检查通过：${testFiles.length} 个测试文件均已登记`)
  process.exit(0)
}

console.error(`✗ 发现 ${missing.length} 个测试文件未被 test 脚本覆盖\n`)
for (const m of missing) console.error(`  ${m}`)
console.error('\n这些测试从写下起就从未被执行过——CI 会一直绿。')
console.error('修法：把文件加进对应 package.json 的 test 脚本，或改用 glob 通配。')
process.exit(1)

// 保持 has 引用，避免 lint 报未使用
void existsSync
