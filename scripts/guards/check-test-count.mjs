#!/usr/bin/env node
/**
 * 护栏：测试不得被悄悄删光
 *
 * 规则：仓库中必须有测试文件，且数量不少于阈值（当前 8）。
 *
 * 为什么需要它：
 *   `vitest run --passWithNoTests` 在没有测试文件时返回 0。
 *   也就是说，**把全部测试文件删掉，CI 依然全绿**——
 *   这正是 §17.3「零覆盖 ≠ 通过」要防的那类失败。
 *
 *   `check-test-manifest.mjs` 防的是另一个方向："新增测试文件但没登记，
 *   从未执行过"。它管"文件在不在收集范围里"，不管"文件还在不在"。
 *   两条护栏互补：一条防漏跑，一条防删光。
 *
 * 阈值从实际文件数取（向下取整到 8），留出余量：
 *   新增测试 → 数量上升，通过；
 *   合并测试文件 → 数量略降但仍 ≥ 阈值，通过；
 *   意外删光或大幅删减 → 失败。
 *
 * 退出码：0 通过 / 1 违规
 */

import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 测试文件数量的下限。
 *
 * 当前实际 17 个。这个下限留了余量：新增测试 → 数量上升，通过；
 * 合并测试文件 → 略降但仍 ≥ 下限，通过；**意外删光或大幅删减 → 失败**。
 *
 * 调整这个数字时要连带更新 selfcheck.mjs 里的破坏用例。
 */
const MIN_TEST_FILES = 12

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.screenshots',
  'data',
  'uploads',
  'generated',
])

const isTestFile = (p) =>
  /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(p) || /(^|[\\/])__tests__[\\/]/i.test(p)

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

const allFiles = walk(ROOT)
const testFiles = allFiles
  .filter(isTestFile)
  .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))
  .sort()

if (testFiles.length < MIN_TEST_FILES) {
  console.error(
    `✗ 测试文件数量不足：${testFiles.length} 个，低于下限 ${MIN_TEST_FILES} 个\n`,
  )
  for (const f of testFiles) console.error(`  ${f}`)
  console.error(
    '\n把测试文件删光后，`vitest run --passWithNoTests` 仍返回 0，CI 会一直绿。',
  )
  console.error(`修法：恢复被删的测试文件，或同时下调本护栏的阈值（当前 ${MIN_TEST_FILES}）。`)
  process.exit(1)
}

console.log(
  `✓ 测试文件数量检查通过：${testFiles.length} 个（下限 ${MIN_TEST_FILES} 个）`,
)
process.exit(0)
