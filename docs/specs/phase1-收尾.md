# Spec：Phase 1 收尾——回收站页面（T4.6）+ 验收材料（T6.2/T6.3）

> 需求分支：`npc/1-phase1-trash-acceptance`
> 父 Issue：ha1fice/weShare#1　本工单：ha1fice/weShare#2
> 本 Spec 的所有结论均以 `main@3e94684` 的代码为准，逐条附文件 + 行号证据。

---

## 1. 问题陈述

Phase 1 主体功能已交付（T0/T1/T2/T3.1–T3.3/T4.1/T4.2/T4.4），但存在两类缺口：

1. **用户可见缺口**：回收站后端能力完整，前端没有任何入口和页面——用户删除文件后无法自助找回或彻底清除。
2. **验收材料缺口**：`docs/acceptance/phase1.md` 与阶段报告不存在；架构文档 §14 的任务状态与代码实际进度漂移。

## 2. 目标

- 补齐回收站前端页面（T4.6），走真实 API。
- 产出 `docs/acceptance/phase1.md` 手工验收脚本（T6.2）与阶段报告（T6.3）。
- 同步架构文档 §14 / §15.3、`CODEX_GUIDANCE.md` 的任务状态，消除文档漂移。

## 3. 非目标

- **不做「最近访问」聚合视图**（父 Issue 已明确排除，T4.3 只算部分完成，见 §6）。
- 不做 Phase 2 内容：Tiptap/Yjs 编辑器、自动保存、附件、版本快照。
- 不改后端业务逻辑（回收站三个接口现状可用，见 §5）。
- 「单独确认后再做」6 项只做分析不实现（见 §10）。

## 4. 必须核实点的证据清单（结论：与代码一致）

### 4.1 回收站后端：三个接口均已存在且语义完整

| 能力 | 证据 | 结论 |
|---|---|---|
| 回收站列表 | `apps/api/src/http/node-routes.ts:92-98`（GET `/api/v1/workspaces/:id/trash`）；`apps/api/src/domain/node-service.ts:229-253`（`listTrash`）；`packages/db/src/repo/nodes.repo.ts:125-131`（按 `workspaceId + deletedAt not null` 倒序） | **已实现，不需重做** |
| 还原 | `apps/api/src/http/node-routes.ts:181-188`；`node-service.ts:468-493`（`restore`） | 已实现 |
| 彻底删除 | `apps/api/src/http/node-routes.ts:190-197`；`node-service.ts:496-521`（`purge`） | 已实现 |

**权限语义**（`node-service.ts` 顶部表 1-15 行 + 各方法）：

- 查看：回收站内节点需 effectiveRole ≥ manage 才可见（`listTrash` 247 行注释 + 逐节点 `effectiveRole(ctx, node, 'read')`）；manage 不足者看到**空列表而非报错**（测试 `apps/api/test/node-service.test.ts:543-558`）。
- 还原/软删除：effectiveRole ≥ manage（`restore` 469 行 `requireRole(nodeId, userId, 'manage', 'restore')`）。
- 彻底删除：仅空间 owner/admin（`purge` 499-514 行，authz purge 分支）；非 owner/admin 且不可读 → 404（防探测），可读但无权 → 403。对未进回收站的节点 purge 返回 422（513-516 行；测试 `node.test.ts:473-483`）。
- 跨空间隔离：所有查询按 `workspaceId` 收敛；非成员访问节点 404（`node.test.ts:128-141`、`253-271`）。

**restore 的「批次」语义**（关键）：

- 软删除时整棵子树统一写 `trashRootId = 被删节点自身 id`（`node-service.ts:452-465`；`nodes.repo.ts:85-103` `collectSubtreeIds` 批量标记）。
- 还原按 `trashRootId` 整批还原：`nodes.repo.ts:104-111`，`updateMany({ where: trashRootId })`。
- 即：**还原回收站中的父目录，整个删除批次（含当时一起被删的子树）一起回来**；`node.trashRootId ?? node.id` 兜底（473-475 行）。
- 防悬空：父目录已不存在或已在回收站时还原报 422「上级目录已被删除，请先还原上级目录」（478-486 行）。
- 测试证据：`node-service.test.ts:486-540`（整批标记、整批还原、子树不悬空）、`node.test.ts:433-471`（HTTP 全链路：删除→回收站可见→还原→回收站清空）。

### 4.2 前端：API 封装已有，页面与入口完全缺失

- 封装已就绪：`apps/web/src/api/nodes.ts:29-30`（`trash`）、`52-53`（`restore`）、`55`（`purge`）。
- 路由无回收站页面：`apps/web/src/app/router.ts:12-46` 仅 6 条路由（home/login/healthz/workspace/settings/doc）。
- 导航无入口：`apps/web/src/pages/WorkspacePage.vue:189-195` 头部只有「成员与设置」链接；左侧栏只有「+ 文档 / + 文件夹」（209-227 行）。全仓 `.vue` 文件 grep "trash/回收站" 仅命中删除确认文案（`WorkspacePage.vue:128`：`window.confirm('…可在回收站还原。')`）——**提示了回收站，却没有回收站**。
- 删除用的是原生 `window.confirm`（128 行）。
- **结论：T4.6 页面完全缺失，是本次主要交付物。**

### 4.3 错误码与 401：解析已完成，本地化映射与跳转有缺口

- 错误码解析**已完成**：`apps/web/src/api/client.ts:101-113` 按 `body.error.code` 分支构造 `ApiError`，不解析 message 文本；网络错误统一 `NETWORK_ERROR`（60-71 行）；401 触发 `onUnauthorized` 回调（116-118 行）。
- **本地化映射缺口**：`packages/shared/src/index.ts:46-70` 只有 `ERROR_CODES` 枚举与 `ERROR_STATUS` 状态映射，**没有错误码→文案映射表**；前端目前直接展示后端 message（如 `WorkspacePage.vue:80`、`DocPage.vue:35`）。后端 message 是中文可直接用，但若要求「前端按 code 本地化」则缺一张表。**建议：本次补一张 `ERROR_MESSAGES` 映射（shared 或 web 侧均可），作为兜底文案；后端 message 仍优先。**
- **401 跳转缺口**：`session.ts:88-92` 的 unauthorized handler 只 `clear()` 清状态，**不跳转**；路由守卫（`router.ts:56-88`）只在「导航时」检查，用户停在页面中会话过期**不会**被送回登录页，页面停在无响应状态。**建议：在 handler 里带 `redirect` query 跳登录页（注意避免守卫循环、当前路由已是 login 时不重复跳）。**

### 4.4 DocPage vs T4.5：壳已具备，文档漂移

- `apps/web/src/pages/DocPage.vue`（117 行）：标题、面包屑路径、角色徽标、私密标记、改名（仅 edit/manage，42-47 行）、明确占位「正文编辑器在 Phase 2 接入」。
- 架构 §14 T4.5 要求「标题输入、只读/可编辑态、正文占位、保存状态的 UI 位置」——现状已覆盖标题展示与占位；「标题输入」「保存状态 UI 位置」是 Phase 2 编辑器接入时才有意义，当前壳不违背。
- **结论：T4.5 应标「已完成（文档壳部分）」，注明编辑器与保存状态 UI 属 Phase 2；文档 §14:1128 目前未标状态，需要更新。**

### 4.5 架构文档 §14 与代码的漂移

| 任务 | §14 现状 | 代码实况 | 结论 |
|---|---|---|---|
| T4.3 | 未标状态（§14:1126） | 树/面包屑/标题搜索已实现（`node-routes.ts:63-90,131`）；**最近访问无任何代码**（全仓无 recent 相关实现） | 应标「部分完成（最近访问除外）」 |
| T4.5 | 未标状态（:1128） | 见 4.4 | 应标「已完成（文档壳）」 |
| T4.6 | 未标状态（:1129） | 后端完成、前端缺失 | 本次补齐后标完成 |
| T5.1 | 未标状态（:1132） | 所有节点接口走 `effectiveRole`；但列表过滤在**内存**非 SQL（`node-service.ts:167-173` 明确注释，已登记 §15.3 #5） | 应标「已完成（SQL 过滤按 §15.3 #5 待数据量触发）」 |
| T6.1 | 未标状态（:1137） | 集成测试已有回收站全链路（`node.test.ts:433-537`） | 基本可标完成，随验收材料复核 |
| T6.2/T6.3 | 未标状态（:1138-1139） | `docs/acceptance/` 目录不存在；无阶段报告 | 本次交付 |

### 4.6 测试现状与 verify 基线

- 后端：`apps/api/test/` 7 个测试文件，回收站领域断言（`node-service.test.ts:486-593`）与 HTTP 断言（`node.test.ts:433-537`）已覆盖批次语义、权限、422/403/404 分支。
- 前端：3 个测试文件（`NodeTree.test.ts` 12 项、`LoginPage.test.ts`、`WorkspaceSettingsPage.test.ts` 8 项）；**无回收站页面测试**（页面本身不存在）。
- `scripts/verify.mjs`：11 步单源步骤表（repo 7 + code 4），`--list` 确认；docs 组 0 步骤（`--group docs` 报「零覆盖」是预期行为，非故障）。
- 基线实测（本机 Node v22 / pnpm 9）：`verify.mjs --group repo` 7 步全绿；`--group code` 4 步全绿（含类型检查/Lint/单元测试/迁移校验）。**`pnpm verify:full` 基线可用**，重门禁留给编码阶段复跑。

## 5. 已实现、不需重做（避免编码阶段重复实现）

1. 回收站三个 REST 接口及其权限/批次/隔离语义（4.1）。
2. `nodes.ts` 的 trash/restore/purge API 封装（4.2）。
3. 错误码解析、ApiError 契约、NETWORK_ERROR 区分（4.3）。
4. 会话层 401 清状态回调机制（`setUnauthorizedHandler`）。
5. 目录树、列表、面包屑、空间切换、软删除入口（T4.4，`2d448c5`）。
6. DocPage 文档壳（T4.5）。
7. 后端回收站测试（领域 + HTTP）。

## 6. 回收站用户故事与验收标准（T4.6）

**US-1 查看回收站**：作为对删除批次有 manage 权限的用户，我能在空间内打开回收站，看到被删节点的标题、类型、删除时间、删除人，按删除时间倒序、按删除批次聚组。

- AC-1.1 访问 `/w/:workspaceId/trash` 渲染回收站页面，数据来自 GET trash 接口（是/否）。
- AC-1.2 列表项展示标题（未命名兜底）、类型（文档/文件夹）、删除时间、批次根标记（是/否）。
- AC-1.3 加载中有加载态；接口失败展示错误信息且可重试（是/否）。
- AC-1.4 无权看到任何已删节点（如 viewer）时展示空态文案而非报错（是/否）。

**US-2 还原整批**：作为 manage 用户，我能还原一个删除批次，其整棵子树一起恢复。

- AC-2.1 点击「还原」调用 POST restore，成功后列表刷新、目录树刷新（是/否）。
- AC-2.2 UI 明示「还原将恢复整个删除批次（含子树）」（是/否）。
- AC-2.3 批次父目录已不在或仍在回收站时，展示后端 422 的「请先还原上级目录」提示，不崩溃（是/否）。

**US-3 彻底删除（高危）**：作为空间 owner/admin，我能彻底删除回收站中的批次，不可恢复。

- AC-3.1 无 purge 权限的用户看不到「彻底删除」入口（是/否；前端隐藏，服务端强制）。
- AC-3.2 点击后出现二次确认；确认文案说明后果（是/否）。
- AC-3.3 需输入批次标题精确匹配才能执行；不匹配时按钮禁用（是/否）。
- AC-3.4 成功后条目消失；失败（403/404/422）展示对应错误提示（是/否）。

**US-4 权限拒绝与隔离**：

- AC-4.1 manage 以下用户打开回收站页面得到空列表（服务端语义），前端无报错（是/否）。
- AC-4.2 空间 A 的回收站不出现空间 B 的节点（接口按 workspaceId 收敛，测试断言）（是/否）。
- AC-4.3 对他人空间节点发起 restore/purge 得到 404，前端展示「不存在」类提示（是/否）。

## 7. 验收材料验收标准

**T6.2 `docs/acceptance/phase1.md`**：

- AC-D.1 文件存在，含前置条件（启动命令、种子账号）、测试账号矩阵（owner/admin/member/viewer ≥4 角色）（是/否）。
- AC-D.2 覆盖：登录/登出、注册防枚举、空间与成员管理、目录节点 CRUD+拖放、文档壳、权限边界（403/404 语义）、回收站全链路（删除→查看→还原→彻底删除→确认交互）、跨用户隔离（是/否，逐节可勾选）。
- AC-D.3 每步有「步骤 → 预期结果 → 实际结果」三列；未进入 Phase 1 的能力显式标注「不在 Phase 1」（是/否）。

**T6.3 阶段报告**（`docs/reports/phase1.md`）：

- AC-R.1 含 8 项规则要求：交付范围、提交清单、验证命令与实际输出摘要、已知限制（§15.3 引用）、遗留风险、下一步建议等（是/否）。
- AC-R.2 记录 `pnpm verify:full` 实际运行结果（是/否）。
- AC-R.3 「单独确认 6 项」各有一节：代码证据 + 影响分析 + 建议，未擅自实现（是/否）。

**文档同步**：

- AC-S.1 架构 §14 标注 T4.3/T4.5/T4.6/T5.1/T6.1/T6.2/T6.3 状态且与 4.5 表一致（是/否）。
- AC-S.2 `CODEX_GUIDANCE.md` 状态段落更新（是/否）。

## 8. 实现决策（建议）

1. **路由**：`/w/:workspaceId/trash`，name `workspace-trash`，`requiresAuth: true`；页面组件 `apps/web/src/pages/TrashPage.vue`。
2. **入口**：WorkspacePage 头部（「成员与设置」旁）加「回收站」链接；viewer 也可见入口（页面内是空态，避免暴露角色信息）。
3. **批次聚组**：服务端返回平铺列表（含 `trashRootId`），前端按 `trashRootId`（兜底自身 id）聚组，组头=批次根，组内可展开查看子项。
4. **确认交互**：彻底删除用 **Reka UI AlertDialog**（`reka-ui ^2.11.0` 已在依赖中，`apps/web/package.json:17`）；输入标题确认放 Dialog 内 input + 主按钮 disabled 直至精确匹配。还原无需输入确认，仅普通确认或直接执行。
5. **权限显隐**：`purge` 入口按列表项返回的 `role` 与当前用户空间角色判断（owner/admin）；逻辑收敛到一个 computed，服务端仍强制（401/403 兜底）。
6. **状态处理**：复用现有模式（`loading` / `errorMessage` / `role=alert`）；错误文案优先后端 message，取不到时用本地化映射兜底。
7. **401 跳转**：session 的 unauthorized handler 中 `router.push({ name: 'login', query: { redirect: 当前 fullPath } })`；守卫已处理 redirect 回跳，无需新机制。

## 9. 测试决策

- **页面组件测试**（Vitest + happy-dom，沿用现有 `*.test.ts` 模式）：mock `nodesApi`（vi.mock 模块级），断言：渲染列表/聚组、空态、错误态、还原调用参数、purge 确认门槛（标题不匹配按钮禁用、匹配后调用）、无 purge 权限隐藏入口。happy-dom 无法验证真实 Dialog 焦点陷阱，标注需人工验收。
- **路由/导航**：TrashPage 挂载后调用 trash 接口的断言；导航入口存在性断言。
- **401 跳转**：模拟 `setUnauthorizedHandler` 触发，断言跳转 login 且带 redirect。
- **API 侧**：后端已有测试足够（4.1）；如编码阶段动了后端（预期不动），才补集成断言。
- **错误码本地化映射**：对映射表做纯函数单测（每个 ERROR_CODE 有非空中文文案）。

## 10. 「单独确认后再做」6 项：证据与建议（只分析）

1. **最近访问视图/API（T4.3 缺口）**：全仓无 recent 实现（grep 无命中）；架构 §14:1126 与 §964 提及。影响：用户找回「刚编辑的文档」要靠树浏览。建议：Phase 2 随编辑器接入时做（那时才有真正的「访问」事件可记），现做无数据可聚合。
2. **T5.1 列表权限过滤改 SQL**：现为内存过滤（`node-service.ts:167-173`），§15.3 #5 登记触发阈值约单空间 5000 节点。影响：万级节点时内存开销明显；当前不泄露（同一判定函数）。建议：维持现状，触发前先加基准测试。
3. **密码黑名单**：`packages/shared/src/password-policy.ts` 只有长度策略（`:16,71`）；auth-contract.ts:42 明示黑名单是后续项。NIST 要求 SHALL。建议：投产前内置离线 Top-N 名单比对（注册+改密时），避免 Have I Been Pwned 出网依赖（私有化未必允许出网）。
4. **NFKC → NFC**：`password-policy.ts:39` 用 NFKC；§15.3 #1 已登记（NIST 正式版推荐 NFC），登录侧已有参数升级重哈希路径（`apps/api/src/lib/password.ts:100`）。影响：NFKC 归并范围更大，可能造成语义改变（`＄`→`$`）。建议：改一个常量 + 补测试 + 依赖已有重哈希路径兼容旧密码；改动小，可纳入收尾后的安全批次。
5. **会话绝对过期**：`session-service.ts:12-13,101-102` 只有滑动续期；§15.3 #3 登记。影响：活跃用户会话可无限续期。建议：补 `SESSION_ABSOLUTE_TTL`（如 30 天封顶），滑动续期不得突破；测试用时间注入验证封顶行为。
6. **密码找回**：全仓无 reset/forgot 实现；§15.3 #4 登记。影响：忘记密码只能联系管理员（私有化可接受）。建议：先确认部署环境有无邮件服务；若无，做管理员重置（一次性令牌 + 强制改密）。

## 11. 建议工单垂直切片（tracer bullet，按依赖排序）

| # | 切片 | 内容 | 依赖 |
|---|---|---|---|
| S1 | 错误文案映射 | shared 或 web 侧补 `ERROR_MESSAGES` 全量映射 + 单测 | 无 |
| S2 | 401 统一跳转 | unauthorized handler 补登录跳转 + redirect 回跳 + 5 项左右测试 | 无（可与 S1 并行） |
| S3 | 回收站页面骨架 | TrashPage + 路由 + 入口链接 + 列表聚组 + 加载/空/错误态 + 组件测试 | S1（错误兜底） |
| S4 | 回收站操作 | 还原（含 422 提示）+ 彻底删除（AlertDialog + 输入标题确认 + 权限显隐）+ 测试 | S3 |
| S5 | 验收文档 | `docs/acceptance/phase1.md`（含回收站新链路） | S4 |
| S6 | 阶段报告 + 文档同步 | `docs/reports/phase1.md` + 架构 §14/§15.3 状态 + CODEX_GUIDANCE；跑 `pnpm verify:full` 全绿收口 | S5 |

> S3/S4 是唯一业务代码；S1/S2 是小补丁；S5/S6 纯文档。
