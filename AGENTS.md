# AGENTS.md

任何模型/代理接手本仓库，**先读 [CODEX_GUIDANCE.md](./CODEX_GUIDANCE.md) 顶部的「交接区」**。
那一节是唯一权威：当前分支、最后验证、未推送项、下一步、文档地图、硬规则、已知坑。

## 开工

```bash
cd D:/origin/code/weShare
git status && git log --oneline -5
pnpm install && pnpm verify:full
```

`verify:full` 红了先修，别在新红的地基上盖楼。

## 收工（缺一项就算没交付）

1. `pnpm verify:full` 全绿，记下实际结果；
2. 更新 `CODEX_GUIDANCE.md` 交接区的「最后验证 / 未推送 / 下一步」；
3. 说清楚哪些提交只在本地、没推远端。

## 不要做

- 不跨阶段实现；不手写 DDL；ORM 不得泄漏出 `packages/db`。
- 权限判定只在 `apps/api/src/domain/{workspace,node}-service.ts`，前端不做安全判断。
- 未经明确授权不推任何远端（GitHub / CNB 都一样）。
- 不把自动化通过说成"真实用户流程已验收"——没在真实浏览器里跑过的事，如实写没跑过。
