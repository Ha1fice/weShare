#!/usr/bin/env node
/**
 * weShare 统一验证入口
 *
 * 设计原则（借鉴 gosslan 项目的 scripts/verify.mjs）：
 *
 * 1. 单源步骤表 —— 步骤只有一份定义，CI 与本地跑的是同一张表。
 *    历史上 CI 文件与本地脚本各抄一份步骤，改了一边忘了另一边，
 *    结果是"本地有这条门禁、CI 永远不跑"，而且没人发现。
 *
 * 2. group 强制声明 —— 每个步骤必须写明属于哪一组。漏写就在加载时
 *    直接 exit 1，而不是默默归到某个默认组。
 *
 * 3. 分层 —— 快速层（秒级）与重门禁层（分钟级）分开。--group 只跑指定组，
 *    --fast 只跑快速层。分层不是省时间，是让"日常提交"能立刻拿到反馈，
 *    而"合入 main 前"必须跑完全部。
 *
 * 4. 零覆盖 ≠ 通过 —— 选中的一组如果一条可执行步骤都没有，退出码是 2，
 *    不是 0。受检范围为空时输出"⚠️ 零覆盖"，绝不显示 ✅。
 *    这是最容易被忽略的一种失败：门禁看起来绿了，其实什么都没查。
 *
 * 5. 不静默省略 —— 一轮结束时点名列出没跑的组与重门禁项。
 *
 * 用法：
 *   node scripts/verify.mjs                      # 跑快速层全部组
 *   node scripts/verify.mjs --group repo         # 只跑某组
 *   node scripts/verify.mjs --group repo,docs    # 跑多组
 *   node scripts/verify.mjs --fast               # 只跑快速层
 *   node scripts/verify.mjs --list               # 列出所有步骤
 *   node scripts/verify.mjs --full               # 跑全部（含重门禁层）
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NODE = process.execPath

/** 已知分组。步骤的 group 必须在其中，否则视为配置错误。 */
const KNOWN_GROUPS = ['repo', 'docs', 'code', 'e2e']

/**
 * 重门禁判定：这些步骤慢（>30s 量级），归入重门禁层。
 * 判定依据是"跑一次要多久"，不是"跑不跑"。
 */
function isHeavyStep(step) {
  return step.heavy === true || /migrate|audit|licenses|e2e|playwright|build\b/i.test(step.name)
}

/**
 * 步骤表 —— 唯一真源。
 * 新增门禁只改这里；CI 不重复写步骤。
 */
const steps = [
  {
    group: 'repo',
    name: '仓库结构与必备文件',
    why: '开源项目的最低要求：README / LICENSE / 贡献指南等文件齐全，.gitignore 覆盖运行期数据',
    cmd: NODE,
    args: ['scripts/guards/check-repo-layout.mjs'],
  },
  {
    group: 'repo',
    name: '架构文档硬数字对账',
    why: '文档里的条数必须等于现算值——手抄的第二份数字必然腐烂',
    cmd: NODE,
    args: ['scripts/guards/check-doc-numbers.mjs'],
  },
  {
    group: 'repo',
    name: '数据访问隔离（不变式 I7）',
    why: '业务层直接 import Prisma Client 或数据库驱动，会让"换数据库只改 packages/db"变成谎言',
    enabled: () => exists(path.join(ROOT, 'apps')) || exists(path.join(ROOT, 'packages')),
    cmd: NODE,
    args: ['scripts/guards/check-data-access-leak.mjs'],
  },
  {
    group: 'repo',
    name: '测试清单守卫',
    why: '挡住"新增测试文件但忘了登记进 package.json 的 test 脚本"这类静默不跑',
    enabled: () => exists(path.join(ROOT, 'package.json')),
    cmd: NODE,
    args: ['scripts/guards/check-test-manifest.mjs'],
  },
  {
    group: 'repo',
    name: '敏感文件检查',
    why: '密钥一旦推到远端就永远留在 git 历史里——即使删除文件也无效',
    cmd: NODE,
    args: ['scripts/guards/check-sensitive-files.mjs'],
  },
  {
    group: 'repo',
    name: '护栏非空转自检',
    why: '每条守门测试都必须证明它真的会失败——否则它只是一段会永远通过的代码',
    cmd: NODE,
    args: ['scripts/guards/selfcheck.mjs'],
  },

  // ---- 以下步骤在 Phase 1 工程骨架就位后启用 ----
  // 届时把 code 组的 CI job 的 if 条件去掉即可，步骤表已就位。
  {
    group: 'code',
    name: '类型检查',
    why: '跨包类型契约的第一道门禁',
    heavy: false,
    enabled: () => exists(path.join(ROOT, 'package.json')),
    cmd: 'pnpm',
    args: ['-r', 'typecheck'],
  },
  {
    group: 'code',
    name: 'Lint',
    why: '风格与常见错误',
    heavy: false,
    enabled: () => exists(path.join(ROOT, 'package.json')),
    cmd: 'pnpm',
    args: ['-r', 'lint'],
  },
  {
    group: 'code',
    name: '单元测试',
    why: '全部单元断言',
    heavy: false,
    enabled: () => exists(path.join(ROOT, 'package.json')),
    cmd: 'pnpm',
    args: ['-r', 'test'],
  },
  {
    group: 'code',
    name: '数据库迁移校验',
    why: '空库执行一次得完整结构，二次执行无副作用',
    heavy: true,
    enabled: () => exists(path.join(ROOT, 'package.json')),
    cmd: 'pnpm',
    args: ['-r', 'db:verify'],
  },
]

function exists(p) {
  return existsSync(p)
}

// ---------- 参数解析 ----------
const argv = process.argv.slice(2)
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(name)

if (has('--help') || has('-h')) {
  console.log(
    [
      '用法: node scripts/verify.mjs [选项]',
      '',
      '  --group <组名>   只跑指定组（逗号分隔）。可用组: ' + KNOWN_GROUPS.join(', '),
      '  --fast           只跑快速层（跳过重门禁）',
      '  --full           跑所有层',
      '  --list           列出所有步骤，不执行',
      '  --json           以 JSON 输出结果（供 CI 消费）',
    ].join('\n'),
  )
  process.exit(0)
}

const selectedGroups = opt('--group')
const onlyFast = has('--fast') && !has('--full')
const asJson = has('--json')

// ---------- 配置自检：group 必须声明 ----------
const BAD_GROUPS = steps.filter((s) => !s.group).map((s) => s.name)
if (BAD_GROUPS.length > 0) {
  console.error('::error::以下步骤未声明 group：' + BAD_GROUPS.join('、'))
  console.error('后果是"本地有这条门禁、CI 永远不跑"。请补上 group 字段。')
  process.exit(1)
}
const UNKNOWN_GROUPS = steps.filter((s) => !KNOWN_GROUPS.includes(s.group))
if (UNKNOWN_GROUPS.length > 0) {
  console.error(
    '::error::以下步骤的 group 不在 KNOWN_GROUPS 中：' +
      UNKNOWN_GROUPS.map((s) => `${s.name}(${s.group})`).join('、'),
  )
  process.exit(1)
}

// ---------- 分层自证 ----------
// 会碰重门禁（慢）却没被归入重门禁层的步骤 = 分类错误。
// 这类错误会让 --fast 悄悄跳过本该快的检查，或让重门禁混进日常反馈。
const MISCLASSIFIED = steps.filter((s) => {
  const slowButLight = !s.heavy && /migrate|audit|licenses|e2e|playwright/i.test(s.name)
  return slowButLight
})
if (MISCLASSIFIED.length > 0) {
  console.error(
    '::error::以下步骤看起来是重门禁但未标记 heavy=true：' +
      MISCLASSIFIED.map((s) => s.name).join('、'),
  )
  process.exit(1)
}

// ---------- 选步骤 ----------
let selected = steps.filter((s) => {
  if (selectedGroups) {
    const set = new Set(selectedGroups.split(',').map((g) => g.trim()))
    if (!set.has(s.group)) return false
  }
  if (onlyFast && isHeavyStep(s)) return false
  return true
})

// enabled() 为假的步骤（依赖尚未就位）不算"可执行"，也不该让本组变成零覆盖。
const notReady = selected.filter((s) => typeof s.enabled === 'function' && !s.enabled())
selected = selected.filter((s) => typeof s.enabled !== 'function' || s.enabled())

if (has('--list')) {
  console.log('步骤表（' + steps.length + ' 条）\n')
  for (const s of steps) {
    const heavy = isHeavyStep(s) ? ' [重]' : '    '
    const ready = typeof s.enabled === 'function' && !s.enabled() ? ' [待就位]' : ''
    console.log(`${s.group.padEnd(6)}${heavy}${s.name}${ready}`)
  }
  process.exit(0)
}

// ---------- 执行 ----------
const results = []
let failed = 0
let zeroCoverage = 0

if (selected.length === 0) {
  console.log('\n⚠️  零覆盖：选中的范围内没有任何可执行步骤。')
  console.log('   这不是通过。任何一条门禁都没跑，等于没检查。')
  if (notReady.length > 0) {
    console.log('   以下步骤因前置条件未就位被跳过：')
    for (const s of notReady) console.log('     - ' + s.name + '：' + (s.why || ''))
  }
  if (asJson) {
    console.log(JSON.stringify({ status: 'zero-coverage', results: [] }, null, 2))
  }
  process.exit(2)
}

console.log(
  `\n开始验证：${selected.length} 个步骤` +
    (selectedGroups ? `（组：${selectedGroups}）` : '') +
    '\n',
)

for (const s of selected) {
  const label = `[${s.group}] ${s.name}`
  const t0 = Date.now()
  console.log(`▶ ${label}`)
  if (s.why) console.log(`  为什么：${s.why}`)

  const r = spawnSync(s.cmd, s.args, {
    cwd: s.cwd ?? ROOT,
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
  })

  const ms = Date.now() - t0
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const code = r.status ?? 1
  const ok = code === 0

  if (code === 2) {
    // 零覆盖：受检范围为空。这不是通过，也不能算失败——
    // 它是一个独立的结论："这条门禁没有检查任何东西"。
    zeroCoverage++
    console.log(`⚠️ ${label} —— 零覆盖（退出码 2，${ms}ms）`)
    const lines = out.trim().split('\n').filter(Boolean)
    for (const l of lines.slice(-10)) console.log('    ' + l)
  } else if (!ok) {
    failed++
    console.log(`✗ ${label} —— 退出码 ${code}（${ms}ms）`)
    const lines = out.trim().split('\n').filter(Boolean)
    for (const l of lines.slice(-25)) console.log('    ' + l)
  } else {
    console.log(`✓ ${label} —— ${ms}ms`)
  }

  results.push({ group: s.group, name: s.name, ok, code, ms, output: out })
}

const skippedGroups = KNOWN_GROUPS.filter((g) => !selected.some((s) => s.group === g))

console.log('\n' + '─'.repeat(60))
if (failed === 0 && zeroCoverage === 0) {
  console.log(`✅ 全部通过（${results.length} 个步骤）`)
} else if (failed === 0) {
  console.log(`⚠️  ${results.length} 个步骤中 ${zeroCoverage} 个为零覆盖，0 个失败`)
  console.log('   零覆盖意味着这些门禁没有检查任何内容——不算通过。')
} else {
  console.log(
    `❌ ${failed} / ${results.length} 个步骤失败` +
      (zeroCoverage ? `，另有 ${zeroCoverage} 个零覆盖` : ''),
  )
}

// 不静默省略：点名没跑的组与重门禁项
const skippedHeavy = steps.filter((s) => isHeavyStep(s) && !results.some((r) => r.name === s.name))
if (skippedGroups.length > 0) {
  console.log(`本轮未跑的组：${skippedGroups.join('、')}`)
}
if (skippedHeavy.length > 0) {
  console.log('本轮未跑的重门禁项：')
  for (const s of skippedHeavy) console.log(`  - [${s.group}] ${s.name}`)
}
if (notReady.length > 0) {
  console.log('因前置条件未就位而跳过的步骤：')
  for (const s of notReady) console.log(`  - [${s.group}] ${s.name}`)
}
console.log('─'.repeat(60) + '\n')

if (asJson) {
  console.log(
    JSON.stringify(
      { status: failed === 0 ? (zeroCoverage ? 'zero-coverage' : 'pass') : 'fail', results },
      null,
      2,
    ),
  )
}
// 零覆盖不阻塞退出码（它是前置条件未就位的正常状态），
// 但失败一定阻塞。
process.exit(failed === 0 ? 0 : 1)
