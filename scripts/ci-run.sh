#!/usr/bin/env bash
#
# CI 执行包装：把一条命令的输出转成 GitHub Actions 注解。
#
# 为什么需要它：
# CI 失败时最需要的是"看到到底哪一行错了"。但 GitHub 的 job 日志页面
# 对匿名访问是关闭的（"Sign in to view logs"），actions/jobs/{id}/logs API
# 匿名访问返回 403。实测三条渠道里只有一条能匿名读到：
#   ① actions/jobs/{id}/logs API  → 匿名 403
#   ② 浏览器 job 日志页            → "Sign in to view logs"
#   ③ check-run 注解               → ✅ 可匿名读
#
# 所以失败诊断必须走注解通道。另一个约束：GitHub 每个 step 只保留约 10 条
# 注解，逐行 emit 会导致真正有用的那几行被 "... ok" 淹没。
# 因此这里把关键行合成"一条多行注解"。
#
# 用法：bash scripts/ci-run.sh "<标签>" <命令> [参数...]

set -uo pipefail

label="${1:-步骤}"
shift || true

log="$(mktemp -t weshare-ci-XXXXXX.log)"
diag="${log}.diag"

# 用 PIPESTATUS 拿真实退出码（tee 会覆盖 $?）
"$@" 2>&1 | tee "${log}"
status=${PIPESTATUS[0]}

{
  echo "[${label}] 退出码 ${status}（输出共 $(wc -l < "${log}") 行）"
  echo ""
  echo "---- 关键行 ----"
  grep -E '✗|❌|FAIL|failed|Error:|error TS|AssertionError|not ok|expected|actual' "${log}" | tail -12
  echo ""
  echo "---- 输出最后 30 行 ----"
  tail -n 30 "${log}"
} > "${diag}"

# 注解语法要求：% 转义成 %%，换行编码为 %0A，\r 去掉
node -e '
  const fs = require("node:fs")
  const msg = fs.readFileSync(process.argv[1], "utf8")
  process.stdout.write(
    "::error::" +
      msg.replace(/%/g, "%%").replace(/\r/g, "").replace(/\n+$/, "").replace(/\n/g, "%0A") +
      "\n"
  )
' "${diag}"

exit "${status}"
