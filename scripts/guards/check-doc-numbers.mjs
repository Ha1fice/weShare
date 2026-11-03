#!/usr/bin/env node
/**
 * 护栏：架构文档硬数字与交叉引用对账
 *
 * 规则：架构文档里出现的可计算数字，必须等于现算值。
 *
 * 为什么需要它：
 * 文档里写"§4.2 七条架构不变式"，实际写了八条——读者按"七条"来理解，
 * 会漏掉一条。同类的还有"19 项缺陷"、"Phase 3 验收 11 条"。
 * 这些数字改一次就腐烂，且**没有任何机制会告诉你它错了**。
 *
 * 对账方式：
 *   - 从文档里抠出"§X.Y N条…"这类声明
 *   - 现场数出该章节实际条目数
 *   - 不一致即失败
 *
 * 同时校验 § 交叉引用指向的章节是否存在——指向不存在章节的引用等于没写。
 *
 * 退出码：0 通过 / 1 发现不一致 / 2 零覆盖（文档不存在）
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DOC = path.join(ROOT, 'docs', 'architecture', '00-项目总体架构与MVP实施方案.md')

if (!existsSync(DOC)) {
  console.log('⚠️  零覆盖：架构文档不存在，无法对账。')
  process.exit(2)
}

const raw = readFileSync(DOC, 'utf8')
const lines = raw.split('\n')

/** 取出某个章节的内容（从标题行到下一个同级或更高级标题）。 */
function section(startPattern) {
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (startPattern.test(lines[i])) {
      start = i
      break
    }
  }
  if (start < 0) return null
  const level = (lines[start].match(/^#+/) || ['#'])[0].length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/)
    if (m && m[1].length <= level) {
      end = i
      break
    }
  }
  return { start, end, body: lines.slice(start, end).join('\n') }
}

const problems = []

/**
 * 从标题行抠出章节号。
 * 形如 "## 12. 阶段计划" / "### 4.2 职责" / "### Phase 1：xxx"（无编号）。
 * 注意标题里编号后可能跟中文顿号或英文点号。
 */
function headingNumber(line) {
  const m = line.match(/^#{2,4}\s+(\d+(?:\.\d+)*)\s*[.、．]?\s/)
  return m ? m[1] : null
}

/**
 * 中文数字转阿拉伯数字。文档是中文的，条数声明常写成"七条"。
 * 支持 0-99，覆盖实际用到的范围。
 */
function cnToNumber(s) {
  if (/^\d+$/.test(s)) return Number(s)
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units = { 十: 10, 百: 100 }
  let total = 0
  let section = 0
  let current = 0
  for (const ch of s) {
    if (ch in digits) {
      current = digits[ch]
    } else if (ch in units) {
      section += (current || 1) * units[ch]
      current = 0
    }
  }
  total += section + current
  return total
}

/** 从文本里抠出"N条"式声明的数字，兼容中文数字。 */
function declaredCount(body, suffix) {
  const m = body.match(new RegExp(`([0-9零一二两三四五六七八九十百]+)\\s*${suffix}`))
  if (!m) return null
  const n = cnToNumber(m[1])
  return Number.isFinite(n) ? n : null
}

// ---------- 对账 1：§4.2 架构不变式条数 ----------
const invariants = section(/^###\s+4\.2\s/)
if (invariants) {
  const declared = declaredCount(invariants.body, '条架构不变式')
  const actual = (invariants.body.match(/^- \*\*I\d+\s/gm) || []).length
  if (declared === null) {
    problems.push({
      what: '§4.2 架构不变式条数',
      declared: '未声明',
      actual,
      hint: '标题里没有「N 条架构不变式」的声明，无法自动对账',
    })
  } else if (declared !== actual) {
    problems.push({
      what: '§4.2 架构不变式条数',
      declared,
      actual,
      hint: `文档标题声明 ${declared} 条，实际列出 ${actual} 条`,
    })
  }
}

// 编号连续性：I1, I2, ... 不能跳号或重号
if (invariants) {
  const ids = [...invariants.body.matchAll(/^- \*\*(I\d+)\s/gm)].map((m) =>
    Number(m[1].slice(1)),
  )
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== i + 1) {
      problems.push({
        what: '§4.2 不变式编号连续性',
        declared: `应为 I${i + 1}`,
        actual: ids.join(','),
        hint: '不变式编号必须从 I1 连续递增，插入新条时要同步改号',
      })
      break
    }
  }
}
// ---------- 对账 2：§16.2 已修复缺陷条数 ----------
const fixed = section(/^###\s+16\.2\s/)
if (fixed) {
  const declared = declaredCount(fixed.body, '项')
  // 数表格数据行（以 | 开头且不是表头/分隔行）
  const rows = fixed.body.split('\n').filter((l) => {
    const t = l.trim()
    if (!t.startsWith('|')) return false
    if (/^\|[\s\-:|]+\|$/.test(t)) return false
    if (/^\|\s*#\s*\|/.test(t)) return false
    return true
  })
  if (declared !== null && rows.length > 0 && declared !== rows.length) {
    problems.push({
      what: '§16.2 已修复缺陷条数',
      declared,
      actual: rows.length,
      hint: '表格行数与声明的数字不一致',
    })
  }
}

// ---------- 对账 3：§16.1 决策变更条数 ----------
const decisions = section(/^###\s+16\.1\s/)
if (decisions) {
  const declared = declaredCount(decisions.body, '项')
  const rows = decisions.body.split('\n').filter((l) => {
    const t = l.trim()
    if (!t.startsWith('|')) return false
    if (/^\|[\s\-:|]+\|$/.test(t)) return false
    if (/^\|\s*#\s*\|/.test(t)) return false
    return true
  })
  if (declared !== null && rows.length > 0 && declared !== rows.length) {
    problems.push({
      what: '§16.1 决策变更条数',
      declared,
      actual: rows.length,
      hint: '表格行数与声明的数字不一致',
    })
  }
}

// ---------- 对账 4：各 Phase 验收条数与正文交叉引用 ----------
// 正文里会出现 "Phase 3 验收 7" / "Phase 1 验收第 9 条" 这类引用，
// 引用指向的具体条目必须存在。
const phaseCounts = {}
for (let p = 1; p <= 5; p++) {
  const sec = section(new RegExp(`^###\\s+Phase ${p}[:：]`))
  if (!sec) continue
  const items = sec.body.split('\n').filter((l) => /^\d+\.\s/.test(l.trim()))
  phaseCounts[p] = items.length
}

const refRe = /Phase\s*(\d)\s*验收(?:第\s*)?(\d+)\s*条?/g
let m
while ((m = refRe.exec(raw)) !== null) {
  const phase = Number(m[1])
  const idx = Number(m[2])
  if (phaseCounts[phase] === undefined) {
    problems.push({
      what: `交叉引用：Phase ${phase} 验收第 ${idx} 条`,
      declared: `Phase ${phase}`,
      actual: '该 Phase 章节不存在',
      hint: '引用指向不存在的章节',
    })
    continue
  }
  if (idx > phaseCounts[phase]) {
    problems.push({
      what: `交叉引用：Phase ${phase} 验收第 ${idx} 条`,
      declared: idx,
      actual: phaseCounts[phase],
      hint: `Phase ${phase} 只有 ${phaseCounts[phase]} 条验收标准，引用越界`,
    })
  }
}

// ---------- 对账 5：§ 章节引用有效性 ----------
const headingSet = new Set()
for (const l of lines) {
  const n = headingNumber(l)
  if (n) headingSet.add(n)
}
const secRefRe = /§\s*(\d+(?:\.\d+)*)/g
while ((m = secRefRe.exec(raw)) !== null) {
  const ref = m[1]
  // 只校验带小数点的章节引用，纯数字（§12）也校验
  if (!headingSet.has(ref)) {
    problems.push({
      what: `章节引用 §${ref}`,
      declared: `§${ref}`,
      actual: '该章节不存在',
      hint: '引用指向不存在的章节，读者点过去只会迷路',
    })
  }
}

// ---------- 输出 ----------
if (problems.length === 0) {
  console.log(
    `✓ 架构文档对账通过（不变式 ${phaseCounts ? '✓' : '?'}，Phase 验收 ${Object.entries(phaseCounts)
      .map(([p, c]) => `P${p}=${c}`)
      .join(' ')}）`,
  )
  process.exit(0)
}

console.error(`✗ 架构文档对账发现 ${problems.length} 处不一致\n`)
for (const p of problems) {
  console.error(`  ${p.what}`)
  console.error(`    声明：${p.declared}    实测：${p.actual}`)
  console.error(`    ${p.hint}`)
}
console.error('\n修法：改数字，或改内容——两者必须一致。')
process.exit(1)
