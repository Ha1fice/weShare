# CODEX_GUIDANCE.md

> 由执行模型（CodeBuddy）维护。每完成一个阶段、或遇到阻塞时更新这里的「状态」段落。
> Codex 可直接补充「建议」段落，执行模型会结合仓库证据处理。

---

## 状态（2026-11-04）

| 阶段 | 状态 | 提交 |
|---|---|---|
| T0 工程骨架 | ✅ 完成 | `3838bca` 起 |
| T1 数据库基础设施 | ✅ 完成 | `a1e3b06` |
| T2 认证与会话 | ✅ 完成 | `4133664` |
| T3.1 / T3.2 空间与成员后端 | ✅ 完成 | `ae269c6` |
| T4.1 权限判定 | ✅ 完成（23 断言，核实后未改动） | `ae1d033` |
| T4.2 节点服务 | ✅ 完成 | `ae1d033` |
| **T4.4 前端目录树与列表** | **🔄 主体完成，虚拟滚动未做**（见下） | `c95140b` + 本轮 |
| **T3.3 空间设置页** | **✅ 完成**（页面 + 8 项组件测试） | 本轮 |

本地验证：`pnpm verify:full` 11 步全绿（最后一次在 `c5991b6` 提交前跑过）。
**未推送远端**（按 Goal 要求，等用户明确授权）。

### Goal 完成度

授权范围内**仅剩一项**：T4.4 的虚拟滚动（见下节，已给出触发条件与待确认问题）。
其余阶段（T3.1/T3.2、T4.1/T4.2、T4.4 主体、T3.3）均已完成并有测试证据。

Goal 的停止条件里还提到「第二用户实时协同和刷新恢复」——那是 Phase 2（正文持久化）
与 Phase 3（Yjs 协同）的内容，不在本次授权的四个阶段里，因此本轮不涉及。

### 下一步（按顺序）

1. 若 Codex/用户确认可以延后：T4.4 视为完成，转入 Phase 2（正文编辑器）。
2. 若要求现在补：按下面「需要 Codex 判断」的两个问题先确认 API 用法。

---

## T4.4 完成项与未完成项

**已完成**（真实 API 数据，无模拟数据）：

- `apps/web/src/api/nodes.ts` —— 节点 API 封装
- `apps/web/src/components/NodeTree.vue` —— 目录树
  - 展开/收起、单选/多选、键盘导航：由 reka-ui `TreeRoot` / `TreeItem` 提供
  - 拖放移动：HTML5 原生 DnD，拖到文件夹=移动、拖到空白=移到根级、不能拖到自己
  - 只读节点不可拖、显示"只读"标记
- `apps/web/src/components/NodeList.vue` —— 右侧列表（原生 `<table>`，按当前目录过滤子项）
- `apps/web/src/pages/WorkspacePage.vue` —— 树 + 列表 + 面包屑 + 空间切换 + 新建/改名/删除
- `apps/web/src/pages/DocPage.vue` —— 文档壳（标题、路径、角色、改名；正文编辑器留给 Phase 2）
- `apps/web/src/pages/HomePage.vue` —— 空间入口（有空间自动进入，无空间引导创建）
- 测试：`NodeTree.test.ts` 9 项（渲染、展开、只读、选择、拖放、空态）

**未完成：虚拟滚动**

reka-ui 的 `TreeVirtualizer` 可用（`@tanstack/vue-virtual` 已随 reka-ui 安装，无需新增依赖），
但**本轮未接入**。原因与判断依据：

- 当前树是"一个空间内的全部可读节点"，MVP 规模下（单空间数百节点）一次性渲染没有可感知的卡顿；
- `TreeVirtualizer` 要求把 `v-for` 换成它的作用域插槽并接管滚动容器，改动面比看起来大，
  在 happy-dom 下无法验证虚拟化的实际行为（无布局），只能靠人工验收；
- 因此选择"先保正确性、后补性能"，并把触发条件写清楚。

**需要 Codex 判断**：这个取舍是否可接受？若必须现在补，我需要确认：
1. `TreeVirtualizer` 的 `parentEl` 是否必须是滚动容器本身？
2. 与 HTML5 拖放在虚拟行上共存是否有已知问题（行被回收时 `dragstart` 中断）？

**触发补虚拟化的条件**：单次渲染行数持续 > 1000，或用户可见的滚动卡顿。

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
