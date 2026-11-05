# CODEX_GUIDANCE.md

> 由执行模型（CodeBuddy）维护。**这里不是待办审批清单，是决策记录。**
> 除下列「需要人拍板」四类之外的实现与产品问题，由执行模型直接决定并记录在此。

## 自主决策边界（2026-11-05 与 HALFICE 约定）

HALFICE 明确：能自己定的不要逐条回问，需要他定的按重要性汇总给他。

**以下四类必须上报**（只上报，不等人点头才继续；默认按推荐项推进并可回滚）：

1. 真实需求冲突，无法同时满足。
2. 改变产品定位、1.0 范围或已确认的核心流程。
3. 触及权限边界、私密文档、数据迁移/丢失风险，且现有规则无法裁定。
4. 需要新增外部服务、持续费用、出网依赖或新凭据。

**以下永不上报**（直接做，写在下方决策记录里）：UI 细节与视觉取舍、组件拆分、
实现方式、测试补法、错误文案、性能优化、技术债登记、阶段顺序微调、
源码注释里能查到的代码事实。

---


## 状态（2026-11-05 第四轮）

| 阶段 | 状态 | 提交 |
|---|---|---|
| T0 工程骨架 | ✅ 完成 | `3838bca` 起 |
| T1 数据库基础设施 | ✅ 完成 | `a1e3b06` |
| T2 认证与会话 | ✅ 完成 | `4133664` |
| T3.1 / T3.2 空间与成员后端 | ✅ 完成 | `ae269c6` |
| T4.1 权限判定 | ✅ 完成 | `ae1d033` |
| T4.2 节点服务 | ✅ 完成 | `ae1d033` |
| T4.4 前端目录树与列表 | ✅ 完成（含虚拟滚动） | `2d448c5` |
| T3.3 空间设置页 | ✅ 完成 | `c5991b6` |
| **评审问题 1：`visibility` 权限提升** | **✅ 已修（含回归测试）** | 本分支 |
| **评审问题 2：`breadcrumb` 泄露不可读祖先标题** | **✅ 已修（含回归测试）** | 本分支 |

**关于"未推送远端"**：旧版本这里写着"按 Goal 要求等用户明确授权"。该条已作废——
Goal §4/§6 已授权直接实施并提交 PR，逐阶段等待批准正是 HALFICE 要求取消的行为。

### Goal 完成度

授权范围内**四个阶段全部完成**：T3.1/T3.2、T4.1/T4.2、T4.4（含虚拟滚动）、T3.3。

Goal 的停止条件里还提到「第二用户实时协同和刷新恢复」——那是 Phase 2（正文持久化）
与 Phase 3（Yjs 协同）的内容，不在本次授权的四个阶段里，因此本轮不涉及。

### 下一步

顺位见下方「1.0 施工顺序」。当前阻塞项里唯一需要人定的只有 4 条，其余自决。

### 虚拟滚动的验证边界（如实记录）

happy-dom 无布局，`TreeVirtualizer` 的实际裁切行为**无法在组件测试里验证**。
测试只能证明：超过阈值时渲染了 `data-reka-virtualizer` 容器、未超过时不渲染、
500 节点挂载不报错。真实滚动行为需要在浏览器里人工验收一次。

---

## T4.4 完成项

（真实 API 数据，无模拟数据）

- `apps/web/src/api/nodes.ts` —— 节点 API 封装
- `apps/web/src/components/NodeTree.vue` —— 目录树
  - 展开/收起、单选/多选、键盘导航：由 reka-ui `TreeRoot` / `TreeItem` 提供
  - **虚拟滚动**：行数 > 200 时启用 `TreeVirtualizer`（`estimateSize=32`、`overscan=10`）。
    注意它的滚动容器是**父元素**（`role=tree` 那个节点），所以 `overflow-auto` 挂在
    `TreeRoot` 上而非外层 div；侧栏改成 flex 列 + `min-h-0` 才能拿到高度。
  - 拖放移动：HTML5 原生 DnD，拖到文件夹=移动、拖到空白=移到根级、不能拖到自己
  - 只读节点不可拖、显示"只读"标记
- `apps/web/src/components/NodeTreeRow.vue` —— 单行渲染（虚拟/非虚拟两条分支复用）
- `apps/web/src/components/NodeList.vue` —— 右侧列表（原生 `<table>`，按当前目录过滤子项）
- `apps/web/src/pages/WorkspacePage.vue` —— 树 + 列表 + 面包屑 + 空间切换 + 新建/改名/删除
- `apps/web/src/pages/DocPage.vue` —— 文档壳（标题、路径、角色、改名；正文编辑器留给 Phase 2）
- `apps/web/src/pages/HomePage.vue` —— 空间入口（有空间自动进入，无空间引导创建）
- 测试：`NodeTree.test.ts` 12 项（渲染、展开、只读、选择、拖放、空态、虚拟滚动开关）

---

## T3.3 完成项与未完成项

**已实现**：`apps/web/src/pages/WorkspaceSettingsPage.vue`

- 基本信息（名称、默认权限）——仅 owner 可改，服务端同样强制
- 成员列表、按邮箱添加、改角色、移除
- 页面级权限：`canManageMembers` / `isOwner` 控制控件显隐（服务端仍复核）

**未完成**：

- ~~该页没有自动化测试~~ → **已补 8 项组件测试**：owner 看到编辑控件、viewer/member 看不到、
  添加成员发出正确 POST、改角色发出正确 PATCH、owner 行不可改、保存基本信息、接口报错时展示错误。
- 未做真实浏览器联调（admin 视角下的成员管理）。

---

## 1.0 施工顺序（自定，不逐阶段等批准）

1. **服务端权限边界修复**（问题 1、2）—— 已完成，回归测试已加。
2. **设计 token + 基础组件层**（Button / Input / Dialog / Toast / Icon / EmptyState）。
   它阻塞所有页面改造，必须先落地。主色用中性灰阶起步，品牌色最后一步替换。
3. **正文链路**：`GET/PUT /api/v1/nodes/:id/content` + revision 乐观锁 + 409。
4. **Tiptap 编辑器 + 自动保存状态机**（已保存 / 保存中 / 失败重试 / 离线）。
5. **回收站页面** + 输入标题确认的永久删除。
6. **核心页面重做**（登录 / 入口 / 工作区 / 文档 / 设置）。
7. **Yjs 协同**：握手鉴权 + Origin 白名单 + 落库 + 迁移桥 + 在线成员。
8. **剩余技术债**（问题 4/5/6/8/9）+ 部署文档 + 交付报告。

理由：编辑器形态未定就上协同是返工成本最高的一步，所以 4 在 7 前。

## 决策记录（自定，无需用户回答）

| # | 事项 | 决定 | 理由 |
|---|---|---|---|
| D1 | 危险操作确认 | 全部换成自绘 Dialog，禁止 `window.prompt/confirm`；永久删除要求输入标题 | Goal §3 明确要求；`confirm` 无法区分风险等级 |
| D2 | 图标 | 内联 SVG sprite，不引整包图标依赖 | 需要的图标不多，多引一包就多一份样式漂移源 |
| D3 | REST 保存与协同落库 | 协同上线后 `PUT content` 返回 `409 COLLAB_ENABLED` | 架构文档 I2 不变式，两套写入源必然互相覆盖 |
| D4 | 评审问题 3（回收站缺 `deletedBy`） | 回收站列表补删除人与时间，确认框写明"由 X 删除于 Y" | 没有删除上下文的"彻底删除"是不可用的功能 |
| D5 | 评审问题 4（`CORS_ORIGINS` 是摆设） | 接上 `@fastify/cors`；生产环境该值为空时**拒绝启动** | 配置项与代码行为不一致比没配置更危险 |
| D6 | 评审问题 5（`subtreeHeight` 串行查询） | 改递归 CTE，在 `NodesRepository` 内一次查完 | 单空间节点 >5000 是架构文档 §15.3 自己写的触发线 |
| D7 | 评审问题 6（拖到空白处触发两次 move） | `onDrop` 显式 `stopPropagation`，`onDropToRoot` 加空拖守卫，真浏览器验收一次 | `.stop` 修饰符加在了错误层级 |
| D8 | 评审问题 8（空标题可提交） | 前端 trim 后为空则拦截提示，不进请求 | 用户天天点的路径，服务端 schema 兜底即可 |
| D9 | 评审问题 9（collab 空壳、零测试静默通过） | `server.ts` 与 `.env.example` 标死"不要对外暴露端口"；`verify.mjs` 零覆盖守卫覆盖到 collab 与 doc-schema | CI 绿得毫无意义比红灯更糟 |
| D10 | 文档的"需要新授权"表述 | 全部删除 | Goal 已整体授权，逐阶段请批是返工 |

## 需要 HALFICE 拍板（只此四条，默认按「推荐」推进）

> 不回即视为采纳推荐项。每条都可回滚，不阻塞施工。

| # | 问题 | 推荐 | 备选 |
|---|---|---|---|
| Q1 | 主色是否定 `#0B7F76` 深青 | 就它 | 给方向词（更冷静 / 更亲和 / 更技术）重出一版 |
| Q2 | 邀请成员是否接邮件服务 | 不接，只做「邀请链接 + 待接受列表」 | 接 SMTP —— 会引入出网依赖与新凭据，需你确认运维条件 |
| Q3 | 时间紧时先保哪头 | 先保单人编辑可用（M1），协同随后但仍在 1.0 内交付 | 压缩其他项保协同 |
| Q4 | 部署形态 | Docker Compose 单机（api + web + collab + SQLite 卷） | 裸机 Node + 反代 —— 请告知同事的机器环境 |

---

## 需要复核的技术取舍

### 1. 目录树组件：改用 reka-ui 自带的 Tree（架构文档 R18 已修订）

**证据**（`node_modules/reka-ui@2.11.0`）：

```
dist/Tree/{TreeRoot,TreeItem,TreeVirtualizer}.js
src/Tree/TreeRoot.vue     props: items, getKey, getChildren, expanded,
                                 modelValue, multiple, selectionBehavior,
                                 propagateSelect, bubbleSelect, loop, dir, disabled
src/Tree/TreeVirtualizer.vue  props: overscan, estimateSize, textContent
src/Tree/TreeItem.vue     事件: select / toggle；props: value, level, disabled
```

结论：展开收起、选择/多选、键盘导航、虚拟滚动**都有**；缺拖放与表格。

架构文档 §13 R18 已改为：「Reka UI 2.11 已有 Tree（含虚拟滚动），表格与拖放仍需自建」。

**踩过的坑（供 Codex 参考）**：

- `TreeRoot` 的 `modelValue` 收的是**节点对象**，不是 id —— 需要自己双向转换成 id 列表；
- `TreeItem` 必须显式传 `:level`，否则类型不通过；
- 模板开头写 HTML 注释会让组件变成 fragment 多根，`wrapper.element` 拿到注释节点，
  测试里的 `dispatchEvent` 会失效 —— 注释要放进根元素内。

### 2. 树的权限过滤放在内存里（架构文档 §15.3 第 5 条）

`§8.3` 要求 SQL 内联过滤；当前实现是取出全部节点后用同一份 `effectiveRole` 在内存里过滤，
ACL 用批量查询把 N+1 降为 2 次查询。功能正确、不泄露，只是大树时有开销。
触发改 SQL 侧的条件：单空间节点数 > 约 5000。

---

## 其他已记录的实现决策

- **purge 的判定顺序**：必须先判 purge 资格（空间 owner/admin），再判可见性。
  反过来会让空间 admin 永远删不掉别人删的东西（已删除节点要求 manage 才能读，
  而 admin 对他人的 workspace 文档 base 是空间默认角色）。
- **角色 / 枚举唯一真源**：`shared/src/{roles,enums,password-policy}.ts`，
  `index.ts` 只再导出；`packages/db` 从 shared 导入类型，不重复定义。
  这样是为了避免 `index.ts` 的循环依赖（ESM 下拿到 undefined，表现为莫名 undefined）。
- **错误处理**：Fastify 的 4xx 原样透传，不能统一转 500（本轮修过）。

---

## 已知未做（架构文档 §15.3，不阻塞当前阶段）

1. 密码规范化 NFKC → NFC
2. 密码黑名单（NIST SHALL）
3. 会话绝对过期
4. 密码找回流程
5. 树的权限过滤改 SQL 侧
6. T4.4 虚拟滚动、T3.3 组件测试（本轮遗留，见上）
