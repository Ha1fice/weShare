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

## 状态（2026-11-05，Phase 1 收尾完成）

> 上一段"合并 PR #8 之后"的记录保留在下方，两段叠起来看：先有 1.0 主线，
> 再有本轮的收尾（回收站、错误文案、401 跳转、验收脚本）。

`pnpm verify:full` **11 步全绿**。测试总数 402（api 211 / db 74 / web 45 / collab 33 / authz 23 / shared 16）。

### Phase 1 收尾（本轮）

| 阶段 | 状态 | 关键产出 |
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

### 1.0 主线（PR #8）阶段表

| 阶段 | 状态 | 关键产出 |
|---|---|---|
| 产品审计与视觉基线 | ✅ | 设计 token、14 个基础组件、45 个内联 SVG 图标 |
| 核心工作区体验 | ✅ | 登录/首页/工作区/回收站/设置/账号六页重做 |
| 文档可用性 | ✅ | 正文 REST 接口 + Tiptap 编辑器 + 1.2s 防抖自动保存 |
| 多人协同 | ✅ | Hocuspocus 鉴权/Origin/落库/迁移桥 + 前端接入 |
| 服务端权限边界（评审问题 1、2） | ✅ | `visibility` 与 `title` 分开授权；面包屑按可读性过滤 |
| 产品打磨与部署文档 | ✅ | `docs/deploy.md`、`.env.example`、本文件 |
| **真实浏览器人工验收** | ❌ **未做** | 清单见 Issue #10，九组 30 条 |

### 与上一轮的差别（重要）

上一轮的状态是"Phase 1 的 T0–T4.4 完成"。这一轮补的是**用户能真正用起来**所缺的三层：

1. **正文链路整条不存在。** 只有 `document_contents` 表与仓储，没有任何 HTTP 路由，`DocPage` 是一句占位。→ 现在有 `GET/PUT /nodes/:id/content`，16 项集成测试。
2. **协同服务是个空壳。** `new Server({ port })`，没有鉴权、没有 Origin 校验、没有落库。→ 现在三道关齐全，3 项真 WebSocket 端到端测试。
3. **UI 是开发原型完成度，且不是"凌乱"而是"没系统"。** 没有 token、没有基础组件、`window.prompt/confirm` 当交互、回收站没有入口。→ 现在有语义 token + 组件层，全站 0 处原生弹窗。

### 免密身份（可选形态，PR #9 单独走）

按用户想法加了一条"简版"入口：打开页面输个名字就进去，身份由设备指纹派生。
**默认关闭**，两边开关同时打开才生效：`DEVICE_IDENTITY=1`（api）+ `VITE_DEVICE_IDENTITY=true`（web）。
试用机用 `.env.trial.example`——模板里才打开，默认值一个字没改。

### 下一步

1. 浏览器人工验收（docs/acceptance/phase1.md 全 10 节，其中 §7 回收站、§9 401 跳转优先）。
2. 验收通过合入 main，Phase 1 收口。
3. Phase 2：附件、搜索、「最近访问」、版本历史。

### 免密身份的落点

- Spec：`docs/specs/device-identity.md`
- api：`apps/api/src/domain/identity-service.ts`、`apps/api/src/http/identity-routes.ts`
- web：`apps/web/src/lib/device-key.ts`、`apps/web/src/pages/WelcomePage.vue`
- 测试：api `test/identity.test.ts`（11 项）、web `lib/device-key.test.ts`（6 项）+ `pages/WelcomePage.test.ts`（5 项）

**诚实的安全边界**：deviceKey 不是凭证，知道它就能冒充。只适合内网/试用，
生产保持关闭。这是刻意接受的代价，换来"打开即用"，不是遗漏。熵来源、撞号、
清空浏览器这三条见 Spec「安全边界」一节。

### 虚拟滚动的验证边界（如实记录）

happy-dom 无布局，`TreeVirtualizer` 的实际裁切行为**无法在组件测试里验证**。
测试只能证明：超过阈值时渲染了 `data-reka-virtualizer` 容器、未超过时不渲染、
500 节点挂载不报错。真实滚动行为需要在浏览器里人工验收一次（已列入 Issue #10 第 2.5 条）。

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

## PR 收口（2026-11-05，分支 `pm/1.0-consolidation`）

Issue #3 下有 4 个 open PR，其中 #7（花小码）与 #8（CodeBuddy）是**两份独立实现，改的是同一批文件**。收口规则如下：

| PR | 处置 | 理由 |
|---|---|---|
| #8 `auto/1.0-doc-collab-7148` | **主线基线** | 覆盖最全：正文链路 + 协同三道关 + 整套 UI/token/组件层 + 回收站 + 部署文档，且真 WebSocket 端到端测试在它这边 |
| #6 `npc/3-authz-fix` | **挑入**（3 文件，无冲突面） | 两个真安全缺陷：`visibility` 提权、`breadcrumb` 泄露不可读祖先标题。主线此前未修 |
| #7 `auto/doc-collab-t5` | **关闭，不合并** | 与 #8 同一批文件的两套实现；`@weshare/doc-schema` 的 PM schema 与 yjs 投影各一套，同时合并必炸，且两侧 editor schema 一旦不一致会**静默丢节点**。其中正确的东西（条件更新抢占迁移权、libSQL `updateMany` 丢字段的发现）在 #8 里以 `claimCollaborative` 形式存在，已核对语义等价 |
| #9 `npc/3-device-identity` | **单独走** | 免密登录，与主线零文件重叠（仅 `packages/shared/src/index.ts` 一处导出），可独立评审 |

操作一律用 `cherry-pick -x` 挑提交，保留原 commit 与出处，不用 squash。

**收口后实测**：`pm/1.0-consolidation` 基于 `#8` 头部 `618a1b0` 挑入 `b8541f3`（#6），
本地 `pnpm install --frozen-lockfile` + `pnpm verify:full` **11 步全绿**，
含 api 单测（其中 `node-service.test.ts` 新增 4 条 authz 回归）。

**收口时的二次核对（CodeBuddy 逐行比对，不是看描述下结论）**：

- #7 的 `migrateToYjs` 与 #8 的 `claimCollaborative` 语义等价——都是"判定与写入同一条语句"，
  区别只在 #7 把派生字段（`textPreview`/`charCount`）拆成第二次 update 以绕开 libSQL
  `updateMany` 丢字段的问题；#8 的 `saveContent` 路径不做多字段 updateMany，不受此坑影响。
- #6 挑入后与 #8 分支原有改动无逻辑冲突，只与 `CODEX_GUIDANCE.md` 文本冲突，按本文件重写。

---

## 评审修复（2026-11-05，花小码，分支 `npc/8-collab-persist-fix`）

对 #8 主线做了一轮**以「真丢数据」为标准**的复核。找到三个真问题，两个已修并有回归测试。

### 已修（P0/P1）

| # | 问题 | 后果 | 修法 |
|---|---|---|---|
| F1 | `ContentsRepository.claimCollaborative` 把迁移锁条件（`yjs_state IS NULL`）用在了**每一次**协同落库上 | 迁移那一次之后，所有 `updateMany` 影响 0 行 → **协同时写的内容一次都没进库**，刷新即丢；而 `store()` 不检查返回值，日志一片绿 | 合并成一个 `saveCollaborative({ expectYjsState })`：日常落库无条件写，只有迁移桥那一次带 `'null'` 做 CAS。迁移桥也补上了 `content_json` 镜像（此前迁移后列表摘要会一直是空的） |
| F2 | 文档页只在 `content_json` 里 `collabEnabled === true` 时连协同；而服务端只在**协同落库时**才置 `yjs_state` | 新文档永远 `collabEnabled=false` → 永远走单机 REST → **永远进不了协同**。同一篇文档，有人看到的是可编辑的编辑器，别人看到的是"无法协同" | 打开文档一律走协同；文档还没进过协同时，把单机正文经 `localStorage` 草稿交给 Y.Doc 的迁移桥（`rememberCollabDraft` / `takeCollabDraft`） |
| F3 | 首次握手若 `authenticationFailed`，没人再发 `synced` | 页面永远停在"正在与服务器同步…"，用户以为自己在一篇正在加载的文档上编辑 | `connectCollab` 把 `authenticationFailed` 一并映射为 `denied`，界面给出明确出口 |

### 顺手修（不影响行为，防将来漂移）

- 三处 Tiptap 扩展集都单独注册了 `Underline`，而 StarterKit 3 已内置 → 运行时 warn「Duplicate extension names」。这恰好是「协同侧 Schema 与前端不一致会静默丢节点」那条风险的温床，已统一去掉。
- `DocPage.test.ts` 的用例描述与实现已脱节（断言 `.doc-editor`、`已保存`），按新的协同入口重写，并补上"会话必须是登录态"这个前提。

### 回归证据

- `apps/collab/test/collab-server.test.ts` 新增用例：**迁移之后**再写一段，数据库里必须有它。把修复回退，这条与原有"断开后能恢复"一起变红（已实测）。
- `apps/collab/test/persistence.test.ts` 新增两条：CAS 只让第一个赢；迁移之后的日常落库必须真写。
- `pnpm verify:full` 11 步全绿。

### 复核后仍然成立的部分

- 三道关（Origin 白名单 / 会话 + authz / 只读强制）都真的在服务端强制，`visitor` 拿不到可写连接。
- REST 与协同的互斥（不变式 I2）方向正确：`yjs_state` 非空即拒绝 `PUT content`。
- 真实浏览器两人协同**依然没人做过**，结论不变，见上方「验证边界」。

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
