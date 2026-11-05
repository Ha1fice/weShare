# CODEX_GUIDANCE.md

> 由执行模型（CodeBuddy）维护。每完成一个阶段、或遇到阻塞时更新这里的「状态」段落。
> Codex 可直接补充「建议」段落，执行模型会结合仓库证据处理。

---

## 状态（2026-11-05，Phase 1 收尾完成）

| 阶段 | 状态 | 提交 |
|---|---|---|
| T0–T2 / T3 / T4.1 / T4.2 / T4.4 / T3.3 | ✅ 完成（2026-11-04 及之前） | 见 2026-11-04 状态段 |
| T4.3 查询接口 | ⚠️ 部分完成（树/面包屑/搜索已交付；「最近访问」随 Phase 2） | `d9cf11f` 前已交付 |
| T4.5 文档壳 | ✅ 完成 | 本轮 |
| **T4.6 回收站页面** | **✅ 完成**（聚批/还原/彻底删除二次确认/权限显隐，11 项组件测试） | `6d062d8` |
| **T5.1 节点接口接入 authz** | **✅ 完成**（列表过滤 SQL 化按 §15.3 #5 待触发） | 本轮标注 |
| **T5.3 错误码映射 + 401 跳转** | **✅ 完成**（ERROR_MESSAGES + 登录回跳防开放重定向） | `d7c4488` / `cf8b5e0` |
| **T6.1 API 集成测试** | **✅ 完成**（回收站全链路 + trashRootId 聚批断言） | `6d062d8` |
| **T6.2 手工验收脚本** | **✅ 完成**（docs/acceptance/phase1.md；**浏览器人工验收未执行**） | `f2e3582` |
| **T6.3 阶段报告** | **✅ 完成**（docs/reports/phase1.md） | `d9cf11f` |

本地验证：`pnpm verify:full` 11 步全绿（2026-11-05 实测，见阶段报告 §3）。

### 下一步

1. 浏览器人工验收（docs/acceptance/phase1.md §7 回收站、§9 401 跳转优先）。
2. 验收通过合入 main，Phase 1 收口。
3. Phase 2：Tiptap + Yjs 编辑器与自动保存（届时一并实现「最近访问」）。

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
