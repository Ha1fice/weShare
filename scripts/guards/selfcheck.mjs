#!/usr/bin/env node
/**
 * 护栏自检：证明每条守门测试真的会失败
 *
 * 规则：对每条护栏施加一次最小破坏，断言它必须失败；恢复后再断言它必须通过。
 *
 * 为什么需要它：
 * 一条永远通过的守门测试，比没有守门测试更危险——它给出"已检查"的假信号。
 * 典型成因：
 *   - 路径写错了，扫的是空目录，恒定 0 条违规
 *   - 正则写错了，永远匹配不上
 *   - 阈值设得太松
 *   - 被 try/catch 吞掉了异常
 * 这些 bug 都不会让 CI 变红，只会让它一直绿。
 *
 * 本自检的做法：把仓库复制到临时目录 → 施加破坏 → 跑护栏 →
 * 断言退出码非 0 → 恢复 → 再跑 → 断言退出码为 0。
 *
 * 退出码：0 全部通过 / 1 有护栏无法被证明失败 / 2 无护栏可检
 */

import { mkdtempSync, cpSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const NODE = process.execPath

/**
 * 每条护栏的"破坏用例"。
 * breakIt 在副本里施加破坏，restore 撤销破坏。
 */
const CASES = [
  {
    guard: 'scripts/guards/check-repo-layout.mjs',
    label: '删掉 README.md，仓库布局护栏必须失败',
    breakIt(dir) {
      rmSync(path.join(dir, 'README.md'), { force: true })
    },
  },
  {
    guard: 'scripts/guards/check-doc-numbers.mjs',
    label: '把 §4.2 声明的条数改成错的，文档对账护栏必须失败',
    breakIt(dir) {
      const p = path.join(dir, 'docs', 'architecture', '00-项目总体架构与MVP实施方案.md')
      const text = readFileSync(p, 'utf8')
      // 标题里的条数可能是中文数字（"七条"），两种写法都要能破坏
      const broken = text
        .replace(/### 4\.2 (\d+)条架构不变式/, (_, n) => `### 4.2 ${Number(n) + 1}条架构不变式`)
        .replace(/### 4\.2 ([零一二两三四五六七八九十百]+)条架构不变式/, (m, cn) => {
          const table = { 零: '零', 一: '二', 二: '三', 三: '四', 四: '五', 五: '六', 六: '七', 七: '八', 八: '九', 九: '十' }
          return `### 4.2 ${table[cn] ?? cn}条架构不变式`
        })
      if (broken === text) {
        throw new Error('破坏用例未能匹配到 §4.2 标题，破坏用例本身失效')
      }
      writeFileSync(p, broken, 'utf8')
    },
  },
  {
    guard: 'scripts/guards/check-dialect-isolation.mjs',
    label: '在业务代码里写入 jsonb，方言隔离护栏必须失败',
    breakIt(dir) {
      const dir2 = path.join(dir, 'apps', 'api', 'src')
      mkdirSync(dir2, { recursive: true })
      writeFileSync(path.join(dir2, 'leak.ts'), "export const bad = 'jsonb'\n", 'utf8')
    },
  },
  {
    guard: 'scripts/guards/check-test-manifest.mjs',
    label: '新增测试文件但不登记进 test 脚本，清单护栏必须失败',
    breakIt(dir) {
      const pkgDir = path.join(dir, 'apps', 'api')
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'api', scripts: { test: 'node --test src/a.test.ts' } }, null, 2),
        'utf8',
      )
      const srcDir = path.join(pkgDir, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(path.join(srcDir, 'a.test.ts'), '// test\n', 'utf8')
      writeFileSync(path.join(srcDir, 'b.test.ts'), '// test\n', 'utf8')
    },
  },
]

/**
 * 复制仓库内容到临时目录。
 *
 * 注意：cpSync(ROOT, dir) 在 dir 已存在时会把 ROOT 复制成 dir/<basename>，
 * 那样护栏按自身位置解析出的 ROOT 就会错位。必须逐项复制内容。
 */
function copyRepoContents(dest) {
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const src = path.join(ROOT, entry.name)
    const dst = path.join(dest, entry.name)
    cpSync(src, dst, { recursive: true })
  }
}

function runGuard(root, guard) {
  const r = spawnSync(NODE, [path.join(root, guard)], {
    cwd: root,
    encoding: 'utf8',
  })
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const available = CASES.filter((c) => existsSync(path.join(ROOT, c.guard)))

if (available.length === 0) {
  console.log('⚠️  零覆盖：没有可自检的护栏。')
  process.exit(2)
}

const failures = []

for (const c of available) {
  const dir = mkdtempSync(path.join(tmpdir(), 'weshare-selfcheck-'))
  try {
    copyRepoContents(dir)

    // 施加破坏
    c.breakIt(dir)

    const broken = runGuard(dir, c.guard)
    if (broken.code === 0) {
      failures.push({
        guard: c.guard,
        why: '施加破坏后护栏仍然通过——这条护栏没有真正生效',
        label: c.label,
      })
      continue
    }

    // 恢复：重跑未破坏的副本
    const dir2 = mkdtempSync(path.join(tmpdir(), 'weshare-selfcheck-ok-'))
    let okCode = null
    try {
      copyRepoContents(dir2)
      const ok = runGuard(dir2, c.guard)
      okCode = ok.code
      // 未破坏时退出码可以是 0（通过）也可以是 2（零覆盖，如尚无测试基础设施），
      // 但绝不能是 1（报违规）。
      if (ok.code === 1) {
        failures.push({
          guard: c.guard,
          why: '未破坏时护栏就报违规——判据本身有误（误报）',
          label: c.label,
        })
        continue
      }
    } finally {
      rmSync(dir2, { recursive: true, force: true })
    }

    console.log(`✓ ${c.guard}`)
    console.log(`    ${c.label}`)
    console.log(
      `    破坏后退出码 ${broken.code}（期望非 0），未破坏时退出码 ${okCode}（期望 0 或 2）`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (failures.length === 0) {
  console.log(`\n✓ ${available.length} 条护栏均通过非空转验证`)
  process.exit(0)
}

console.error(`\n✗ ${failures.length} 条护栏未能通过非空转验证\n`)
for (const f of failures) {
  console.error(`  ${f.guard}`)
  console.error(`    ${f.why}`)
  console.error(`    用例：${f.label}`)
}
process.exit(1)
