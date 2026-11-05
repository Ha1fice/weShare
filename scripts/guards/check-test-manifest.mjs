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
  /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(p) || /(^|[\\/])__tests__[\\/]/i.test(p)

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
    // e2e 是独立运行器（playwright），与 test 互补而非替代——一起算进覆盖面
    if (json.scripts?.e2e) {
      manifests.push({
      rel: path.relative(ROOT, p).replace(/\\/g, '/'),
        testScript: json.scripts.e2e,
      })
    }
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

if (testFiles.length === 0) {
  console.log('⚠️  零覆盖：存在 test 脚本但磁盘上没有任何测试文件。')
  console.log('   有测试基础设施却没有测试，等于没有防护——这不是通过。')
  process.exit(2)
}

/**
 * 判断 test 脚本是否使用了"自动发现"的测试运行器。
 *
 * vitest / jest 默认收集所有 .test.ts 与 .spec.ts 文件，不需要在脚本里枚举路径。
 * 这类运行器下，本护栏不适用（新测试文件自动纳入）。
 *
 * 关键点：自动发现是**相对于包根目录**的——`vitest run` 在 packages/authz 下
 * 运行时，只收集 packages/authz 内部的测试文件。所以一个位于仓库根的
 * 测试文件不属于任何包，永远不会被执行——这正是本护栏要抓的情况。
 *
 * 因此这里返回包根目录，判定时用"文件是否在该包目录内"来过滤。
 */
function autoDiscoveryIncludes(script, pkgDir) {
  const runners = /\b(vitest|jest|playwright)\b/
  if (!runners.test(script)) return null

  // 读配置文件里的 include 模式
  const configCandidates = [
    'vitest.config.ts',
    'vitest.config.js',
    'vitest.config.mts',
    'jest.config.js',
    'jest.config.ts',
    'playwright.config.ts',
  ]
  for (const name of configCandidates) {
    const p = path.join(pkgDir, name)
    if (!existsSync(p)) continue
    let text
    try {
      text = readFileSync(p, 'utf8')
    } catch {
      continue
    }
    if (name === 'playwright.config.ts') {
      // playwright 没有 include 数组，用 testDir（默认 'e2e'）圈定收集范围
      const d = text.match(/testDir:\s*['"]([^'"]+)['"]/)
      const dir = d?.[1] ?? 'e2e'
      return { patterns: [dir + '/**'], config: name, pkgDir }
    }
    const m = text.match(/include:\s*\[([^\]]*)\]/s)
    if (!m) {
      // 没有显式 include → 用运行器默认（覆盖该包下所有 .test/.spec）
      return { patterns: null, config: name, pkgDir }
    }
    const patterns = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
    if (patterns.length === 0) return { patterns: null, config: name, pkgDir }
    return { patterns, config: name, pkgDir }
  }

  // 配置文件都没有 → 用默认收集规则（仍然只限该包目录内）
  return { patterns: null, config: null, pkgDir }
}

/**
 * 判断文件路径是否匹配 glob 模式。
 *
 * 单遍扫描把 glob 转成正则，不使用占位符——占位符方案需要用控制字符
 * 或易冲突的字符串，历史上在这里踩过坑。
 * 支持 **（跨目录）、*（不跨目录）、?（单字符）。
 */
function matchesPattern(filePath, pattern) {
  let regex = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // ** 跨目录
        if (pattern[i + 2] === '/') {
          regex += '(?:.*/)?'
          i += 3
        } else {
          regex += '.*'
          i += 2
        }
      } else {
        // * 不跨目录
        regex += '[^/]*'
        i += 1
      }
    } else if (ch === '?') {
      regex += '[^/]'
      i += 1
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      regex += '\\' + ch
      i += 1
    } else {
      regex += ch
      i += 1
    }
  }
  return new RegExp('^' + regex + '$').test(filePath)
}

/**
 * 判定每个测试文件是否被某个 manifest 的 test 脚本覆盖。
 *
 * 两条路径：
 *   A. 自动发现（vitest/jest）——检查配置文件里的 include 是否覆盖该文件
 *   B. 手工枚举——检查脚本里是否出现该文件
 */
function isCovered(fileRelPath) {
  for (const m of withTest) {
    const script = m.testScript
    const pkgDir = path.dirname(path.join(ROOT, m.rel))

    // A. 自动发现
    const auto = autoDiscoveryIncludes(script, pkgDir)
    if (auto) {
      // 文件必须位于该包的目录内——自动发现只收集包内的测试
      const absFile = path.join(ROOT, fileRelPath)
      const relToPkg = path.relative(auto.pkgDir, absFile).replace(/\\/g, '/')
      if (relToPkg.startsWith('..')) {
        // 不属于这个包，继续看下一个 manifest
        continue
      }
      if (auto.patterns === null) {
        // 默认收集规则：包内任意 .test/.spec 文件都会被纳入
        return { covered: true, by: `${m.rel} (${auto.config ?? '默认收集规则'})` }
      }
      // 配置文件里设了 include，必须逐个模式匹配
      for (const pattern of auto.patterns) {
        if (matchesPattern(relToPkg, pattern) || matchesPattern(fileRelPath, pattern)) {
          return { covered: true, by: `${m.rel} (${auto.config})` }
        }
      }
      continue
    }

    // B. 手工枚举
    for (const token of script.split(/\s+/)) {
      if (!token || token.startsWith('-')) continue
      const cleaned = token.replace(/^['"]|['"]$/g, '')
      if (cleaned === fileRelPath) return { covered: true, by: m.rel }
      const base = path.basename(cleaned)
      if (base === path.basename(fileRelPath) && cleaned.includes('/')) {
        return { covered: true, by: m.rel }
      }
    }
  }
  return { covered: false }
}

const uncovered = []
for (const f of testFiles) {
  const result = isCovered(f)
  if (!result.covered) uncovered.push(f)
}

if (uncovered.length === 0) {
  console.log(
    `✓ 测试清单检查通过：${testFiles.length} 个测试文件均被 test 脚本覆盖（${withTest.length} 个 manifest）`,
  )
  process.exit(0)
}

console.error(`✗ 发现 ${uncovered.length} 个测试文件未被 test 脚本覆盖\n`)
for (const m of uncovered) console.error(`  ${m}`)
console.error('\n这些测试从写下起就从未被执行过——CI 会一直绿。')
console.error('修法：把文件加进对应 package.json 的 test 脚本，或改用 vitest/jest 的默认收集。')
process.exit(1)
