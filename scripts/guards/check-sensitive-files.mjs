#!/usr/bin/env node
/**
 * 护栏：敏感文件不得被追踪
 *
 * 规则：
 *   - `.env` 及其变体（.env.local、.env.production 等）不得入库
 *   - 私钥与证书文件（.pem、.key、.p12、.pfx、id_rsa）不得入库
 *   - **`.env.example` 是例外**——它是模板文件，不含真实密钥，必须入库
 *
 * 为什么要有这条：密钥一旦推到远端，即使后续删除，git 历史里仍然存在。
 * 这条检查在 CI 上跑，能在推送后立刻发现，而不是等到出事。
 *
 * 退出码：0 通过 / 1 发现违规 / 2 零覆盖（无 git 仓库或无法读取文件列表）
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 允许入库的例外。 */
const ALLOWED = [
  // 模板文件：只有占位值，没有真实密钥
  '.env.example',
  '.env.sample',
  // 试用环境模板（免密模式打开）。是模板不是配置，里面不写真实地址与凭据。
  '.env.trial.example',
]

/** 匹配规则。 */
const PATTERNS = [
  { re: /^\.env$/, why: '环境变量文件' },
  { re: /^\.env\..+$/, why: '环境变量文件变体' },
  { re: /\.(pem|key|p12|pfx)$/i, why: '私钥或证书' },
  { re: /^id_rsa/i, why: 'SSH 私钥' },
  { re: /\.keystore$/i, why: '密钥库' },
]

const r = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })

if (r.error || r.status !== 0) {
  console.log('⚠️  零覆盖：无法读取 git 文件列表（不是 git 仓库或 git 不可用）。')
  process.exit(2)
}

const files = r.stdout.split('\n').filter(Boolean)

if (files.length === 0) {
  console.log('⚠️  零覆盖：仓库里没有已追踪的文件，无从检查。')
  process.exit(2)
}

const violations = []
for (const file of files) {
  const base = path.basename(file)
  if (ALLOWED.includes(base)) continue

  for (const p of PATTERNS) {
    if (p.re.test(base)) {
      violations.push({ file, why: p.why })
      break
    }
  }
}

if (violations.length === 0) {
  console.log(
    `✓ 敏感文件检查通过（${files.length} 个已追踪文件，无密钥类文件；例外：${ALLOWED.join('、')}）`,
  )
  process.exit(0)
}

console.error(`✗ 发现 ${violations.length} 个疑似敏感文件被追踪\n`)
for (const v of violations) console.error(`  ${v.file}  —— ${v.why}`)
console.error('\n密钥一旦推送就永远留在 git 历史里。即使删除文件也无效。')
console.error('请从仓库移除，并轮换该凭据。')
process.exit(1)
