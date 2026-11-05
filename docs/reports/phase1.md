# Phase 1 阶段报告（T6.3）

> 需求分支：`npc/1-phase1-trash-acceptance`　父 Issue：ha1fice/weShare#1　工单：ha1fice/weShare#2（Spec：`docs/specs/phase1-收尾.md`）
> 报告日期：2026-11-05

## 1. 交付范围

| 任务 | 内容 | 状态 |
| --- | --- | --- |
| T5.3-S1 | `ERROR_MESSAGES` 错误码→中文文案全量映射 + `errorMessage()` 兜底（5xx 强制兜底，4xx 信任服务端 message）+ 新增 4 项单测 | ✅ |
| T5.3-S2 | 401 统一跳 `/login?redirect=<fullPath>`（已在登录页不跳，防守卫循环）；登录成功按 redirect 回跳，仅接受站内路径（防开放重定向） | ✅ |
| T5.3-S3 | 回收站页面：路由 `/w/:workspaceId/trash`（requiresAuth）+ 空间页顶栏入口 + 按 `trashRootId` 聚批（空标题「未命名」兜底）+ 加载/空/错误三态 | ✅ |
| T5.3-S4 | 回收站操作：整批还原（422 原样提示）、彻底删除 AlertDialog 二次确认（输入批次根标题精确匹配，不匹配禁用）、purge 入口仅 owner/admin 显隐 | ✅ |
| T5.3-S5 | `docs/acceptance/phase1.md` 手工验收脚本（前置条件 + 6 账号角色矩阵 + 10 节可勾选步骤） | ✅ |
| T5.3-S6 | 本报告 + 架构文档 §14 状态同步（T4.3/T4.5/T4.6/T5.1/T5.3/T6.1/T6.2/T6.3） | ✅ |

**契约变更（最小）**：`NodeView` 增加只读必填字段 `trashRootId: string | null`（软删除批次根，还原按整批；非必填是指旧数据由 `toNodeView` 的 `?? null` 兜底，不是可选输出）；后端删除/还原/purge 权限与批次语义未改动。

## 2. 提交清单

| 提交 | 说明 |
| --- | --- |
| `9d13806` | docs(spec): Phase 1 收尾需求核实与 Spec |
| `d7c4488` | feat(shared): ERROR_MESSAGES 错误文案映射（S1） |
| `cf8b5e0` | feat(web): 401 统一跳登录页带 redirect（S2） |
| `6d062d8` | feat(web): 回收站页面——聚批展示、整批还原、彻底删除二次确认（S3+S4） |
| `f2e3582` | docs: 手工验收脚本 docs/acceptance/phase1.md（S5） |
| （本次） | docs: 阶段报告 + 架构文档 §14 同步（S6） |

## 3. 验证命令与实际输出摘要

环境：Node v22.23.2 / pnpm 9.14.4。

**`pnpm verify:full`（11 步全绿）**：

```
✓ [repo] 仓库结构与必备文件        ✓ [repo] 架构文档硬数字对账
✓ [repo] 数据访问隔离（不变式 I7）  ✓ [repo] 测试清单守卫
✓ [repo] 测试数量守卫              ✓ [repo] 敏感文件检查
✓ [repo] 护栏非空转自检
✓ [code] 类型检查（pnpm -r typecheck）
✓ [code] Lint（pnpm -r lint）
✓ [code] 单元测试
✓ [code] 数据库迁移校验
✅ 全部通过（11 个步骤）
```


**测试数口径说明**：api 例数是 vitest 实跑数——参数化用例（`it.each`）在运行时展开为多条，故大于静态 `it()` 声明数（S6 时点静态 162 vs 实跑 197）。两者口径不同，非虚报。本节出现的历史数字均为**时点快照**，与当前实测的差异是后续返工提交累积的结果，请以下方「当前实测」为准，不要跨时点对账。

**当前实测（F1–F4 返工完成后，`npc/1-phase1-trash-acceptance` 分支）**：web 9 文件 80 例（TrashPage 14 例、LoginPage 15 例）、api 12 文件 229 例、shared 2 文件 21 例；`pnpm verify:full` 11 步全绿，`pnpm -r typecheck` / `lint` 7 包全过。这是本报告的权威数字。

**测试分布（S6 时点快照）**：web 5 文件 48 例（含 TrashPage 11 例、session 3 例、LoginPage 14 例）、api 10 文件 197 例、shared 2 文件 20 例。其中 shared 的 20 例里 16 例是既有 password-policy 用例，S1 实际新增 4 例（见上表）；此处为 S6 时点的全量数字，非 S1 单项产出。

**合流更新（PR #13 合入 main 后的返工提交）**：
- `session.ts` 401 统一跳转目标按 `deviceMode` 分流：免密模式送 `welcome`（带 redirect），密码模式送 `login`——免密用户没有"登录"这回事，一刀切跳 login 会送进不该出现的下车口。新增 2 项单测（免密分流 + welcome 页防循环），session 用例 3→5。
- `errorMessage()` **目前只有回收站页面（`TrashPage.vue`）接入** shared 兜底，S1 不是全站覆盖。其余页面仍是 `err instanceof ApiError ? err.message : '…'` 的写法，**共 12 处绕开兜底待统一改造（另开工单）**：`WorkspacePage.vue` 5 处、`DocPage.vue` 3 处、`AccountPage.vue`/`LoginPage.vue`/`NewWorkspacePage.vue`/`WorkspaceSettingsPage.vue`/`WelcomePage.vue` 各 1 处。此处曾写成"已接入全部错误出口，S1 为全站覆盖"，不成立，已更正。
- web 用例数：S6 时点为 5 文件 48 例，合流后曾为 9 文件 76 例，均已并入上方「当前实测」，不再单列。

**`pnpm -r typecheck` / `pnpm -r lint`**：全部包通过（verify:full 的 code 组已含，独立复跑亦绿）。

## 4. 已知限制（引用架构文档 §15.3）

本阶段未新增待复核项；以下沿用 §15.3 既有登记：

1. 密码规范化 NFKC → NFC（§15.3 #1，部署前改）
2. 密码黑名单未实现（§15.3 #2，投产前补）
3. 会话无绝对过期（§15.3 #3，投产前补）
4. 无密码找回流程（§15.3 #4，需先确认部署环境邮件服务）
5. 树的权限过滤在内存而非 SQL（§15.3 #5，单空间约 5000 节点触发时改）

## 5. 遗留风险

- **浏览器人工验收未执行**：验收脚本（`docs/acceptance/phase1.md`）已就绪但未逐节跑过。组件测试用 happy-dom，无法覆盖真实 Dialog 焦点陷阱、真实滚动与视觉布局。
- **TrashPage 的 session 依赖**：`canPurge` 依赖 `session.workspaces`，若用户直接刷新 `/w/:id/trash`，守卫会先 `fetchMe()` 再放行，数据已就位——但该时序依赖守卫行为，浏览器验收时应专项确认。
- **批次内子项不可展开查看**：当前聚批只显示批次根标题与项数，子项明细需展开查看的场景留待反馈后再做（服务端数据已含全部子项）。

## 6. 「单独确认后再做」6 项（只分析，未实现）

详见 Spec §10 与架构文档 §15.3，摘要：

1. **最近访问**：无「访问」事件可记，Phase 2 随编辑器接入再做。
2. **T5.1 列表过滤 SQL 化**：现状不泄露（同一判定函数），5000 节点触发前先加基准测试。
3. **密码黑名单**：投产前内置离线 Top-N 名单比对（避免 Have I Been Pwned 出网依赖）。
4. **NFKC → NFC**：改一个常量 + 补测试，依赖已有重哈希路径兼容旧密码；建议纳入收尾后的安全批次。
5. **会话绝对过期**：补 `SESSION_ABSOLUTE_TTL`（如 30 天封顶），滑动续期不得突破。
6. **密码找回**：先确认部署环境有无邮件服务；无则做管理员重置（一次性令牌 + 强制改密）。

## 7. 下一步建议

1. 按 `docs/acceptance/phase1.md` 跑一轮浏览器人工验收（重点：回收站全链路 §7、401 跳转 §9）。
2. 验收通过后合入 `main`，Phase 1 收口。
3. 启动 Phase 2：Tiptap + Yjs 编辑器与自动保存（届时一并实现「最近访问」）。
