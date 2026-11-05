# CODEX_GUIDANCE.md

> 由执行模型（CodeBuddy）维护。每完成一个阶段、或遇到阻塞时更新这里的「状态」段落。
> 只有遇到 Issue #3 §7 列出的六类重大歧义才在这里提问；其余自行决策并记录理由。

---

## 状态（2026-11-05，1.0 第一轮）

`pnpm verify:full` **11 步全绿**。测试总数 402（api 211 / db 74 / web 45 / collab 33 / authz 23 / shared 16）。

| 阶段 | 状态 | 关键产出 |
|---|---|---|
| 产品审计与视觉基线 | ✅ | 设计 token、14 个基础组件、内联 SVG 图标 |
| 核心工作区体验 | ✅ | 登录/首页/工作区/回收站/设置/账号六页重做 |
| 文档可用性 | ✅ | 正文 REST 接口 + Tiptap 编辑器 + 1.2s 防抖自动保存 |
| 多人协同 | ✅ | Hocuspocus 鉴权/Origin/落库/迁移桥 + 前端接入 |
| 产品打磨与部署文档 | ✅ | `docs/deploy.md`、`.env.example`、本文件 |

## 与上一轮的差别（重要）

上一轮的状态是"Phase 1 的 T0–T4.4 完成"。这一轮补的是**用户能真正用起来**所缺的三层：

1. **正文链路整条不存在。** 只有 `document_contents` 表与仓储，没有任何 HTTP 路由，`DocPage` 是一句占位。→ 现在有 `GET/PUT /nodes/:id/content`，16 项集成测试。
2. **协同服务是个空壳。** `new Server({ port })`，没有鉴权、没有 Origin 校验、没有落库。→ 现在三道关齐全，3 项真 WebSocket 端到端测试。
3. **UI 是开发原型完成度，且不是"凌乱"而是"没系统"。** 没有 token、没有基础组件、`window.prompt/confirm` 当交互、回收站没有入口。→ 现在有语义 token + 组件层，全站 0 处原生弹窗。

---

## 关键实现决策与理由

### 1. 设计 token 而非颜色原语

`apps/web/uno.config.ts` 定义 `canvas / surface / subtle / line / line-strong / ink / muted / faint` + 三档状态色，页面里只写语义名。

理由：原来全站散落 `bg-blue-600` / `text-gray-500`，换主题就是全站 find & replace，且必然漏。代价是"想用某个具体灰色"时要先想它属于哪一档——这个摩擦是刻意的。

### 2. 不用 `window.prompt` / `window.confirm`

新建、改名、删除全部走 `AppDialog`。

理由：Issue #3 §2 明确要求"危险操作要有清晰且匹配风险的确认"。原生 `confirm` 只能给一句话，无法承载"永久删除要手打标题"这种风险匹配。副作用：改了 3 个旧测试的断言口径（从断言 `disabled` 改为断言"不发请求 + 显示提示"），见下条。

### 3. 提交按钮不禁用，点错了才标红

禁用的按钮点下去毫无反馈，用户不知道差了什么。

例外：**危险操作的确认按钮仍然禁用**（未输入正确标题时），因为那里"点不动"本身就是提示，且不该让用户有机会误触。

### 4. 图标用内联 SVG 而非图标库

需要的不超过 45 个，引一个包换来的是另一套 stroke 宽度、另一套 viewBox、另一份 tree-shake 配置。代价是一份 path 表。

### 5. 正文两条写入路径严格互斥（不变式 I2）

- 文档 `yjs_state IS NULL` → REST 保存可用；协同一旦装载（哪怕一个连接）→ `PUT content` 返回 `409 COLLAB_ENABLED`。
- 理由：两条路径同时活着一秒，就可能有一份内容被另一份静默覆盖。这是"看起来能用、实际会丢字"的典型来源。

### 6. `revision` 是乐观锁，不是版本号展示

保存必须回传读到的 revision，不匹配 409。前端给两个明确出口（载入最新 / 另存为副本），不静默覆盖也不静默丢弃。

**改名不动 revision** —— 元数据与正文分离，改标题不该让别人的编辑器报冲突。

### 7. 协同的正文模型选了 y-prosemirror

一开始我打算用"整段文本塞进 Y.XmlElement"的简化方案（不需要引入 y-prosemirror，也不会产生非法结构）。**放弃了**，理由：

- 那样两个人在同一段落里同时输入会退化成整段替换；
- 而且 `content_json` 镜像无法从 Y.Doc 反推，只能一直空着。

改用 y-prosemirror 后，两侧共享同一份 PM Schema（`apps/collab/src/schema.ts` 与 `apps/web/src/editor/schema.ts` 都从 `@weshare/doc-schema` 的常量派生）。**这个共享是硬约束**：Schema 不一致会导致转换时静默丢节点，表现为"用户写的格式重启后消失"，而协同过程中完全看不出来。

### 8. 迁移桥的并发保护做了两层

文档第一次被协同打开时，`content_json` 要灌进 Y.Doc。两个客户端同时首开时，各建一份 Y.Doc 再合并 = 文本重复。

- 进程内：`loading` 表按 nodeId 串行化，后到者等前者完成后**从数据库回放**（不是"看到标记就跳过"——那是没有串行化）；
- 跨进程：`claimCollaborative` 条件更新（`yjs_state IS NULL`），没抢到的丢弃自己的迁移结果。

有专门的并发测试（`apps/collab/test/persistence.test.ts` 的"两个客户端同时首次打开"用例）。

### 9. `ALLOWED_ORIGINS` 留空 = 拒绝，不是放行

原来配置注释写的是"空表示不校验（仅开发期允许）"。改成 fail-closed。

理由：Cookie 鉴权的 WebSocket 不受同源策略保护，浏览器会跨站带 Cookie 发起握手。留空放行等于默认开门。留空拒绝让人**在开发第一天就撞到 4403 然后去读配置**，比上线后才发现好得多。

### 10. collab 不复用 api 的 `SessionService`

只共享 `packages/*`。让 collab 依赖 api 会把整个 Fastify 拖进协同进程。

代价：会话哈希算法与过期规则两边各写一份（`apps/collab/src/session.ts` 对齐 `apps/api/src/lib/session-token.ts`）。已用测试钉住（有效/无效/空 token 三种），改一边必须改另一边。

---

## 踩到的坑（供后续参考）

### Tiptap 3 的 `setContent({ emitUpdate: false })` 不抑制 transaction

`emitUpdate: false` 只抑制 `onUpdate` 回调，**transaction 事件照发**（实测 `docChanged` 仍为 true）。而 `@tiptap/vue-3` 的 `useEditor` 自带 onTransaction 钩子去 sync 响应式状态，编辑器挂载后会多触发几次 `onUpdate`。

后果：一打开文档界面就挂着"未保存的改动"，还会白涨一次 revision。

试过"装入后 reset 状态"——没用，那几次回调发生在 reset **之后**。最后用 `allowRealMark` 开关收口：装载期间不接受改动标记，`await nextTick()` 后开放。

**不要**改成在 `nextTick` 里 reset：时序依赖 Tiptap 内部的微任务调度，不该让界面的正确性押在它不变上。

### Hocuspocus 在 `port: 0` 时不改 `configuration.port`

`server.listen()` 后系统分配的端口在 `server.httpServer.address().port`，不在 `configuration.port`（那里还是 0）。测并行跑时想用随机端口就会踩到。

### Rust/Node 侧 WebSocket 测试必须显式带 Cookie 与 Origin

浏览器自动带，Node 不会。`ws` 的握手头要手动塞，且 Cookie 值本身可能含 `=`——用 `; ` 切分 header 字符串会把 Cookie 切断。

### 协同鉴权不能直接拿 `effectiveRole()` 算 `canWrite`

`effectiveRole` 对**已删除节点**的语义是"能否管理它"（返回 `manage` 或 null），不是"能否编辑正文"。直接用它算 `canWrite`，空间所有者会拿到一个可写连接，而文档其实在回收站里。

已在 `apps/collab/src/auth/service.ts` 显式拦一道：`deletedAt !== null` → 直接拒绝。

---

## 需要 Codex 大脑决定的事

**暂时没有。** 本轮所有决策都在 Issue #3 §6 授权的范围内。

两件将来可能需要你拍板的（现在不需要，先记着）：

1. **多进程协同。** 现在同一文档的连接必须落在同一 collab 进程。单机部署不受影响；要横向扩就得加 Redis 转发或 sticky session，那是架构级改动。
2. **SQLite 切 PostgreSQL 的触发条件。** 现在写的是"并发写入明显排队"。如果你希望有个更硬的数（比如 p95 写延迟 > 200ms），请给个阈值，我把它写成可测的告警。

---

## 已知未做（不阻塞 1.0 核心流程）

| # | 项 | 影响 | 备注 |
|---|---|---|---|
| 1 | 图片上传与附件代理 | 文档里插不了图 | Phase 2 范围原本含此项；Schema 里已留 `image` 节点位 |
| 2 | 离线编辑（`y-indexeddb`） | 断网期间刷新会丢未落库的片段 | 架构文档明示"不承诺离线可写" |
| 3 | 树权限过滤在内存里做 | 单空间 > 约 5000 节点时变慢 | 触发条件已记录，见下方"性能边界" |
| 4 | 版本历史与评论 | 1.0 明确不做 | Phase 4 |
| 5 | 密码找回 / 改密码 | 只能由管理员重置 | 需要邮件通道，属安全加固 |
| 6 | 表格编辑器 | 1.0 明确不做 | Phase 5 |
| 7 | 公开分享链接、SSO/LDAP | 1.0 明确不做 | 仅预留接口位 |

---

## 验证边界（如实记录）

这是最容易被读过就算的部分，所以写清楚。

### 自动化验证到的

- **402 项断言**，含 16 项正文接口集成测试、15 项协同鉴权测试、11 项落库/迁移桥测试、3 项**真 WebSocket 端到端**测试（两个客户端收敛、落库后重新装载、伪造 Origin 被拒）。
- 数据库用真实 SQLite 文件库，不用 mock。迁移 SQL 就是将来部署到生产的那份。

### 只在 happy-dom 里验证、**没有**在真浏览器里跑过的

- 编辑器输入、IME 中文输入、粘贴 Word/网页内容。
- 远端光标的实际渲染位置与颜色。
- 虚拟滚动（>200 节点）的真实裁切行为——happy-dom 无布局，测不到。
- 断网 30 秒后重连的实际收敛时序。
- 窄屏（< 768px）下的实际布局。

### 完全没验证的

- **一次真实的两人浏览器协同验收**。自动化测试用 Node 客户端模拟了两个连接，跑通了 Yjs 协议层与落库，但"我看得见你的光标"这件事需要人眼看一次。
- 生产 nginx 配置（`Upgrade`/`Connection` 头）是否真的打通。
- Safari / Firefox 的兼容性。

### 建议的下一步

按 `docs/deploy.md` 的"同事试用流程"表逐条走一遍，把结果补进交付报告。**不要**把自动化通过说成真实用户流程已验收。
