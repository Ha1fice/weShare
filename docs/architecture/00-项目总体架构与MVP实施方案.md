# 项目总体架构与 MVP 实施方案

> 文档性质：Phase 0 交付物，指导 Phase 1–5 的实施基线  
> 版本：v1.5（2026-11-04）  
> 状态：**已确认**（v1.0 经评审后修订为 v1.1；v1.2 补开源与治理；v1.3 完成 ORM 替换为 Prisma；v1.4 补 Repository 拆分与集成测试；v1.5 完成认证（T2）；变更清单见 §16）  
> 适用范围：整个平台（平台层 / 文档编辑器 / 表格编辑器 / 协同服务 / 数据层）  
> 上位依据：`项目总指导`（产品方向与优先级）＞ 本文 ＞ 三份技术调研报告  
> 已决事项：数据库 = SQLite 单文件 + **Prisma 7.10.1**（§15-D2/D2a）；前端 UI = Reka UI + UnoCSS（§15-D1）；开源发布 = Apache-2.0 + GitHub（§15-D6）

本文不重复介绍 Tiptap、Yjs、Univer 的基本概念。三份调研报告已经覆盖了组件能力与许可证事实；本文只回答一个问题：**如何把它们组合成一个可交付、可验收、可持续演进的产品**。

---

## 0. 结论摘要

1. **产品形态**：先交付"平台骨架 + 原生富文本文档 + 真实多人协同"这条闭环，表格与版本/评论后置。第一版不碰 DOCX/XLSX、不碰分页、不碰 ONLYOFFICE。
2. **技术形态**：pnpm monorepo，三个进程——`web`（Vue 3 SPA）、`api`（Fastify，REST）、`collab`（Hocuspocus，WebSocket），共享一个数据库与一个文件存储目录。
3. **数据库形态**：**SQLite 单文件优先，经 Prisma 7.10.1 访问**。表结构、查询、迁移全部由 ORM 表达，**业务代码不接触 ORM**——所有数据访问经 `packages/db` 的 Repository 接口，为后期切 PostgreSQL 留出扩展空间。SQLite 让"数据库"随产物一起交付，不需要单独运维一个数据库服务。
4. **内容事实源**：正文以 Y.Doc 为唯一事实源，ProseMirror JSON 是**只读物化结果**（供列表摘要、搜索、导出、版本对比）。业务元数据（标题/归属/创建者/权限/时间）独立存 `nodes` 表，正文存 `document_contents` 表。
5. **权限形态**：服务端会话 Cookie + 服务端角色判定；WebSocket 握手复用同一 Cookie，`onAuthenticate` 判定并设置 `connection.readOnly`，**只读由服务端强制**，前端隐藏按钮只作体验优化。
6. **自动保存形态**：Phase 2 用带 revision 乐观锁的 REST 保存；Phase 3 起切换为协同落库，REST 内容写入对已启用协同的文档返回 `409`，**同一文档永不并存两条写入路径**。
7. **现状**：架构已确认并**进入实施**。Phase 1 的 T0（工程骨架）、T1（数据库基础设施）、T2（认证与会话）、T3.1/T3.2（空间与成员后端接口）、T4.1/T4.2（权限判定与节点服务）已完成——工程骨架、Prisma 7 数据层（10 张表 + 8 个仓储 + 真实数据库集成测试）、认证链路（Argon2id + 会话 Cookie + 防账号枚举 + 登录限流）、空间与成员管理、目录树与文档节点（创建/移动/软删除/还原/purge，含循环与深度校验、跨空间隔离）均已跑通。本机 Node v24.17.0 / pnpm 9.14.4 可用，无 Docker、无 PostgreSQL——**这三项都不再是阻塞项**（改用 SQLite 后不需要数据库服务）。
8. **本文档的维护约定**：文档随代码同步更新；`§` 只用于本文档内部引用，外部标准用全称；文中"N 条"这类数字必须与现算值一致（由 CI 对账护栏强制）。约定详见 §18。

---

## 1. 产品理解

### 1.1 我们要建的是什么

一套**企业内部、可私有化部署、浏览器内原生协同**的文档平台。用户直接创建平台原生文档；平台自己拥有文档数据模型、编辑器、协同机制、权限与版本体系。

判定一条需求是否属于本项目，看三个问题：

| 判据 | 属于本项目 | 不属于本项目 |
|---|---|---|
| 数据从哪来 | 平台自己创建的结构化内容 | 从 .docx/.xlsx 解析出来的内容 |
| 谁是事实源 | 我们的 Schema / Workbook 模型 | Office 文件的 OOXML 结构 |
| 值多少钱 | 协作、权限、留存、可检索 | 与 Word 的排版一致度 |

因此，"能不能打开某个客户的 .docx"不是本项目的验收项；"三个人同时改一段话，刷新和重启后内容一致且权限正确"才是。

### 1.2 MVP 的产品形态（三个界面 + 一条闭环）

1. **登录界面**：账号密码登录，会话保持。
2. **工作空间界面**：左侧目录树（文件夹/文档）、右侧文档列表或欢迎页、顶部空间切换与成员入口。
3. **文档界面**：标题区 + 工具栏 + 编辑区 + 右上角在线成员与保存状态；分享/权限面板；历史版本面板（Phase 4）。
4. **闭环**：创建 → 编辑 → 自动保存 → 刷新/重启可恢复 → 邀请成员 → 两人同时编辑互见 → 按权限只读/可编辑 → 删除进回收站 → 还原。

### 1.3 MVP 的"够用"标准

不是"功能数量"，而是四件事同时成立：**内容不丢、权限不破、协同不假、操作不卡**。这四条会逐条写成可执行验收用例（见 §12）。

---

## 2. 现状分析（Phase 0 第 1–6 项）

### 2.1 仓库现状（实测）

- 工作区 `D:\origin\code\weShare` 初始仅有 `.agents/`（3 份调研报告 + 1 份模型说明）与 `.screenshots/`（工具临时目录）。
- **已初始化 git 仓库**（分支 `main`），首次提交为"初始化仓库与架构基线 v1.1"。
- **仍然没有任何前后端代码、没有 `package.json`、没有数据库脚本**——工程骨架是 Phase 1 T0 的交付物。
- 已按开源项目规范配齐：`README.md`、`LICENSE`（Apache-2.0）、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`、Issue/PR 模板、CI（`.github/workflows/ci.yml`）、Dependabot。

结论：这是绿地项目。"沿用现有技术栈"没有对象，技术栈在本文中**显式决策并记录理由**（§3、§15）；Phase 1 必须补上首版工程骨架。

**开源属性与"私有化部署"的关系**：本项目以 Apache-2.0 开源，但目标场景仍是企业内部私有化部署。开源指的是**代码可读、可改、可自建**；"私有化部署"指的是**部署形态**（不依赖公有云 SaaS）。两者不冲突——这正是把 SQLite 单文件作为默认形态的价值：自建者不需要先学会运维一个数据库服务。

### 2.2 运行环境实测

| 项 | 实测结果 | 影响 |
|---|---|---|
| OS | Windows 11（NT 10.0.26200），x64 | 开发在 Windows，生产交付建议 Linux 单机 |
| CPU / 内存 | 12 逻辑核 / 31.8 GB | 足够单机跑全套服务 |
| D 盘可用 | 约 244 GB | 足够 SQLite 数据文件、附件、离线依赖包 |
| Node.js | **PATH 可用 Node v24.17.0 / npm 11.13.0 / pnpm 9.14.4**（fnm 管理） | 开发直接可用；用 `packageManager` 字段锁 pnpm 版本。**生产固定 Node 22 LTS**，避免运行时漂移 |
| Docker | 未安装（无 CLI、无 Docker Desktop 目录） | **不再是阻塞项**：改用 SQLite 后本地不需要容器 |
| PostgreSQL / MySQL / Redis | 无服务、无 CLI | **不需要**；MVP 只需 SQLite 单文件，PostgreSQL 仅作后期扩容路径 |
| 公网 | npm registry 可达（HTTP 200） | 当前可安装依赖；但目标环境是纯内网，**依赖必须能离线固化**（`pnpm fetch`） |

**环境决策（已确认，见 §15-D2）**：**不安装 Docker、不安装 PostgreSQL、不安装 Redis**。数据库用 SQLite 单文件（`better-sqlite3` 驱动），与 `web`/`api`/`collab` 一起打包交付；生产同样是"一个目录 + 三个进程 + 一个 db 文件"。本机与生产的一致性由"同一种数据库、同一套 ORM"保证，而不是由"同一个容器编排"保证。

**pnpn 版本注意**：本机 pnpm 9.14.4 与文档原先设想的 pnpm 11 在 workspace 特性上有差异。仓库根 `package.json` 必须写 `"packageManager": "pnpm@9.14.4"`，CI 与开发机都用 corepack 拉取同一版本；升级 pnpm 走单独 PR。

**生产部署形态**：MVP 不提供 docker compose 作为主交付路径，改为"单目录 + systemd/supervisor 进程组 + 反向代理"。docker compose 降级为可选产物（仅当客户环境强制要求容器化时才维护），不占用 Phase 1 工期。

### 2.3 三份调研报告的采纳与修正

| 报告结论 | 本项目的处理 | 理由 |
|---|---|---|
| Tiptap 3 + ProseMirror + Yjs + y-prosemirror + Hocuspocus 全 MIT | **采纳**，作为文档侧主栈 | 与总指导一致；协同链路 0 商业费用 |
| 报告一主张"先上 ONLYOFFICE 混合架构，再孵化自研" | **不采纳** | 与总指导冲突：产品核心不是 Office 文件编辑器 |
| docx 导入导出链路（mammoth / docx 9.x / docx-preview / LibreOffice） | **搁置**，不进 MVP | 总指导明确排除 |
| 分页排版引擎（两阶段、最大风险点） | **搁置**，不进 MVP 与架构基线 | MVP 是流式文档；分页不得反向约束数据模型 |
| 自研批注（稳定 UUID mark + 侧存储）、自研版本快照 | **采纳为设计原则**，Phase 4 实施 | 规避 Tiptap 付费扩展，且方案本身正确 |
| Univer 开源 core（Apache-2.0）作表格底座 | **采纳**，但推迟到 Phase 5 独立验证 | 表格不阻塞文档闭环 |
| "Yjs 只做同步，不替代业务数据库" | **采纳**，写成架构不变式 I1/I4 | 最容易被做错的地方 |
| 表格协同"Yjs 包装 Univer mutation"（路线 B） | **采纳为 Phase 5 探索方向**，不在 MVP 承诺 | 结构操作定序与 undo/redo 是硬骨头 |
| 人月估算（文档 24–39 人月、表格 13–21 人月） | **仅作参考**，不写入计划 | 那是"做到对标形态"的估算，不是 MVP |

### 2.4 可复用与不复用清单

**可复用（作为输入，不作为代码）**：调研报告中的许可证结论、版本锚点、PoC 验收思路、AGPL/GPL 风险边界。

**明确不复用**：ONLYOFFICE/Collabora 集成、docx/xlsx 转换管道、分页引擎、任何 Vben/Admin 模板脚手架（文档产品的信息架构与后台管理台完全不同，套模板反而拖慢）、Tiptap 付费扩展（Comments / Snapshot / Pages / Conversion）。

**依赖选型原则（本次新增）**：选开源组件时，"是否支持多方言/可替换"是硬指标之一——数据库访问必须经 ORM、UI 基础件必须是不绑定具体数据层的 headless 组件。理由：本项目的数据库选型在评审中已从 PostgreSQL 改为 SQLite 优先，若当初把 SQL 写死在业务代码里，这次改动会变成重写。

---

## 3. 总体技术架构

### 3.1 组件图

```
                         ┌──────────────────────────────────────────────┐
                         │                 浏览器（内网）                 │
                         │  Vue 3 SPA（TS + Reka UI + UnoCSS）           │
                         │  ├─ 平台壳：登录/空间/目录树/文档列表/回收站      │
                         │  ├─ 文档编辑器：Tiptap 3 + 工具栏 + 状态栏        │
                         │  └─ 表格编辑器（Phase 5）：Univer core           │
                         └───────┬───────────────────────┬──────────────┘
                                 │ HTTPS /api/v1          │ WSS /collab
                                 │ (Cookie 会话)           │ (同一 Cookie)
                    ┌────────────▼───────────┐   ┌───────▼─────────────────┐
                    │  api（Fastify, Node）   │   │ collab（Hocuspocus）     │
                    │  身份 / 授权            │   │ WS 鉴权 / 只读强制        │
                    │  目录树 / 元数据        │   │ Yjs 同步 / awareness     │
                    │  单机保存 / 版本 / 附件  │   │ 落库 / 压缩 / 版本快照钩子 │
                    └───────┬────────┬───────┘   └───────┬─────────────────┘
                            │        │                   │
                            │        │  (共享同一套 domain 逻辑包)
                    ┌───────▼────────▼───────────────────▼──────────────┐
                    │              数据库（默认 SQLite 单文件）           │
                    │  users/sessions/workspaces/members                  │
                    │  nodes（业务树+元数据）  document_contents（正文）    │
                    │  node_acl / node_versions / attachments / audit      │
                    │  ▲ 全部访问经 Prisma + Repository，方言只存在于此层 │
                    └───────────────────────┬──────────────────────────┘
                                            │
                    ┌───────────────────────▼──────────────────────────┐
                    │ 文件存储（MVP：本地卷 uploads/；后续：MinIO/S3）     │
                    └──────────────────────────────────────────────────┘

  反向代理（生产）：nginx，同一域名下 / → 静态资源、/api → api、/collab → collab
```

**数据库形态说明（v1.2 修订）**：默认使用 **SQLite 单文件**（`data/weshare.db`），通过 **Prisma 7.10.1** 访问，驱动为 `@prisma/adapter-libsql`。选 SQLite 的三个理由：(a) 私有化交付场景里"少一个要运维的服务"价值高于"换库的灵活性"；(b) 单机部署下 SQLite 的写并发（单写者 + WAL）足以支撑 MVP 规模；(c) 备份 = 复制文件，成本近零。代价是写并发受限，因此**所有落库走短事务**，且 `collab` 与 `api` 的写入不能互相长事务阻塞（见 §9.5）。

**为什么用 Prisma 而不是 Drizzle（v1.2 修订）**：Drizzle 是 SQL-like 的 query builder，业务代码里会出现 `db.select().from()` 这类接近 SQL 的表达——"不写方言 SQL"这条不变式只能靠纪律维持，半年内必然被绕过。Prisma 的 Model API 把数据访问收敛成"对领域对象的操作"，配合 `packages/db` 的 Repository 边界，**业务层根本不接触 ORM**，隔离是结构性的而非纪律性的。

**Prisma 7 + SQLite 的四个已知限制**（全部已实测确认，处理方式写在 `packages/db/prisma/schema.prisma` 文件头）：

1. **Json 字段不能用 `@default`**。Prisma 在 SQLite 上生成 `JSONB NOT NULL DEFAULT {}`，而 SQLite 既不认 `JSONB` 类型也不认 `{}` 默认值，会报 `unrecognized token: "{"`（Prisma 官方 issue #26571，标记 Major）。→ JSON 字段默认值在应用层（Repository）补齐。
2. **枚举不产生数据库级 CHECK 约束**。Prisma 在 SQLite 上把 enum 生成为 `TEXT`，约束只在 Client 层。→ API 边界另用 Zod 兜底；绕过 Prisma 写入的脏数据不会被数据库拦住（已知限制，见 §15.2）。
3. **Prisma 不支持部分索引与表达式索引**。→ 必要的定制索引在迁移 SQL 中手工补入（见 §7.3）；`users.email` 的大小写不敏感唯一改为 `emailLower` 列 + 普通唯一索引。
4. **自增主键必须用 `Int`**。`BigInt @default(autoincrement())` 在 SQLite 上生成 `BIGINT NOT NULL PRIMARY KEY`，而 SQLite 的 rowid 自增要求 `INTEGER PRIMARY KEY`，插入会失败（`NullConstraintViolation`）。→ `audit_events.id` 用 `Int`。

**Prisma 7 的三个破坏性变更**（从 Drizzle 迁入时必须遵守）：

- 连接 URL 不能写在 schema 的 datasource 里，必须放 `prisma.config.ts`；
- 必须通过 driver adapter 构造 Client（`new PrismaClient({ adapter })`）；
- `prisma-client-js` generator 已弃用，改用 `prisma-client` + 必填 `output`（生成到源码树）。

**扩展路径**：ORM 层是唯一的数据库出口，`packages/db` 内按方言分文件（`schema.sqlite.ts` / `schema.pg.ts`）与驱动分文件（`driver.sqlite.ts` / `driver.pg.ts`），业务层只依赖 `db.query.*` 抽象接口。切换 PostgreSQL 时只替换 `packages/db` 与连接配置，业务代码与 API 契约不变。切换的触发条件写在 §15-D2。

### 3.2 四个平面

| 平面 | 组件 | 职责边界 |
|---|---|---|
| 平台面 | `apps/web` + `apps/api` | 身份、空间、目录、文档元数据、权限、回收站、版本、附件 |
| 编辑面 | `apps/web/editor` + `packages/doc-schema` | 文档结构与编辑体验；**不含**业务权限、导航、通知 |
| 协同面 | `apps/collab` | 连接鉴权、Yjs 同步、在线状态、落库；**不解析业务语义**（不判断"这段该不该改"） |
| 数据面 | `packages/db`（Prisma ORM + SQLite）+ 文件存储 | 所有持久化事实；约束是最后一道防线；**ORM 与方言不得上浮到业务层** |

### 3.3 三条关键链路

**A. 打开文档（读写混合）**

```
web → GET /api/v1/nodes/:id            → 元数据 + 我的有效角色
    → GET /api/v1/nodes/:id/content    → 首屏快照（PM JSON，只读展示用，可选）
    → WSS /collab?doc=<nodeId>         → 携带 Session Cookie 握手（校验 Origin）
        collab.onAuthenticate: 校验 Origin → 校验会话 → 校验文档权限 → 无权限断开 / view 设 readOnly
        collab.onLoadDocument: 从 document_contents 读 yjs_state（Uint8Array）→ Y.Doc
    → 客户端 provider.onSynced → 编辑器进入"可编辑/只读" → awareness 广播本人状态
```

要点：
- **权限判定在服务端发生两次**（REST 取元数据时、WS 握手时），前端拿到的 `role` 只用于渲染。
- **首屏快照不得作为内容源**：`content_json` 是派生镜像，在协同模式下可能落后于 `yjs_state`，用它首屏会出现"打开后内容跳变"。首屏快照只用于协同连接建立前的骨架占位，真实内容一律以 `provider.onSynced` 为准。
- **WS 握手必须校验 `Origin`**：Cookie 鉴权的 WebSocket 若不校验 Origin，攻击者页面可直接跨站连接并带上浏览器自动携带的 Cookie，构成跨站 WebSocket 劫持。校验失败直接拒绝握手（4403）。

**B. 编辑落库（协同模式）**

```
本地编辑 → Y.Doc 增量 → provider 发送 update → collab 应用
        → onStoreDocument（防抖）→ Y.encodeStateAsUpdate(doc)
        → UPDATE document_contents SET yjs_state=$, state_vector=$, stored_at=now()
        → 同事务内派生 content_json / text_preview / char_count（节流，见 §9.3）
        → UPDATE nodes SET updated_at=now()
        → 广播 awareness/持久化完成事件给前端状态栏
```

**C. 图片上传**

```
编辑器选图 → POST /api/v1/attachments（multipart，校验 mime/尺寸/大小）
        → 服务端嗅探真实类型 → 落盘 uploads/<workspace>/<yyyy>/<mm>/<uuid>.<ext> → 写 attachments
        → 返回 { id, url: "/api/v1/attachments/:id" }
        → 编辑器插入 image 节点 { src, alt, width }
读取：GET /api/v1/attachments/:id → 校验会话 + 所属文档/空间读权限 → 流式返回
```

永不把文件系统路径暴露给客户端；永不信任客户端给出的 mime。

**附件类型白名单（必须写进实现）**：只接受 `image/png`、`image/jpeg`、`image/webp`、`image/gif` 四种，**禁止 SVG**（SVG 可内嵌脚本，等同存储型 XSS，且渲染在同源页面下）。服务端以魔数嗅探结果为准，扩展名与声明 mime 均不可信。响应头带 `X-Content-Type-Options: nosniff` 与 `Content-Disposition: inline; filename="..."`。

**image.src 只能是平台附件 URL**：schema 中的 `image.src` 允许两类值——`/api/v1/attachments/<id>`（平台自有）与经过白名单校验的**平台代理外链**（由服务端代取后转存为附件，MVP 阶段不实现，故本期仅支持前者）。用户粘贴带来的外链图片一律不保留 URL，改存为附件或丢弃为占位块；**服务端不得代抓任意外部 URL**（SSRF）。

### 3.4 部署拓扑

| 环境 | 形态 | 组成 |
|---|---|---|
| 开发 | 本机进程 + 本地 SQLite 文件 | `pnpm dev` 并行起 api(3000)/collab(3100)/web(5173, Vite 代理 `/api`、`/collab`)；数据文件 `data/weshare.db` |
| 生产（单机私有化） | 单目录 + 进程组 | nginx（TLS + 静态 + 反代）、api、collab、SQLite 数据文件、`uploads/` 目录 |
| 扩展（后置） | 多实例 | 切 PostgreSQL + collab 多副本 + Redis 扩展；api 无状态多副本 |

MVP **不引入 Redis**。理由是单机单实例没有跨实例同步需求；引入即增加一个必须运维的组件。Redis 的引入条件是"collab 副本数 > 1"，写进架构决策记录。

MVP **不要求容器化**：交付形态是"一个目录 + 一个启动脚本"。docker compose 保留为可选产物，仅当客户环境强制要求容器时才维护，不占用 MVP 工期。

**数据目录布局（生产）**：
```
/opt/weshare/
├─ bin/                # 打包后的 api / collab 产物 + 启动脚本
├─ data/weshare.db     # SQLite 数据文件（唯一事实存储）
├─ data/weshare.db-wal # WAL 文件，必须与主文件同目录同盘
├─ uploads/            # 附件
└─ logs/
```
备份 = 停写后复制 `data/` 与 `uploads/` 目录；或运行期用 SQLite 的 `VACUUM INTO` 快照 API 导出（不停写），再连同 `uploads/` 一起打包。**WAL 文件不可单独备份**，必须与主文件一起，或先执行 checkpoint。

### 3.5 版本与许可证锚点（2026-11-03 npm 实测）

| 包 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| `@tiptap/core` `@tiptap/vue-3` `@tiptap/starter-kit` | 3.32.2 | MIT | 编辑器内核 |
| `@tiptap/extension-collaboration` `-collaboration-caret` `-table` | 3.32.2 | MIT | 协同与表格 |
| `@tiptap/extension-text-style` `-link` `-image` `-placeholder` `-character-count` | 3.32.2 | MIT | 颜色/链接/图片/占位/字数统计 |
| `yjs` / `y-prosemirror` / `y-indexeddb` | 13.6.33 / 1.3.7 / 9.0.12 | MIT | CRDT 与绑定 |
| `@hocuspocus/server` / `@hocuspocus/provider` | 4.8.0 | MIT | 协同服务端/客户端 |
| `vue` | 3.5.44 | MIT | 前端框架 |
| `vite` | 8.3.5 | MIT | 前端构建 |
| `reka-ui` | 2.11.0 | MIT | headless UI 基础件（无样式、无数据层耦合） |
| `unocss` | 66.12.0 | MIT | 原子化 CSS |
| `fastify` | 5.12.8 | MIT | HTTP 服务 |
| `prisma` / `@prisma/client` | 7.10.1 | Apache-2.0 | ORM + 迁移生成 + Client 生成 |
| `@prisma/adapter-libsql` | 7.10.1 | Apache-2.0 | SQLite 驱动适配器（Prisma 7 必需） |
| `@libsql/client` | 0.18.0 | MIT | SQLite 驱动（预编译二进制，无 node-gyp 编译） |
| `@univerjs/core` / `@univerjs/presets` | 1.3.1 | Apache-2.0 | 表格（Phase 5） |

全链路 MIT/Apache-2.0，无 GPL/AGPL；CI 加许可证门禁，把 GPL/AGPL 依赖设为硬失败。版本用 `pnpm-lock.yaml` 锁定，升级走单独 PR。

**Reka UI 的定位说明**：Reka UI 是 headless 组件库，只提供无样式、无样式的可访问性行为（Dialog、Popover、Dropdown、Tabs、Checkbox 等）。因此：
- 视觉与布局**全部**由 UnoCSS 承担，不存在"组件库自带样式与我们的设计打架"的问题；
- **没有现成的数据组件**——目录树、表格、树形选择器需要自研或引入专用库（`@vueuse/core`、必要时 `vue-virtual-scroller` 虚拟滚动）；
- 平台壳的表单/弹窗/菜单用 Reka UI + UnoCSS 组合实现，不引入成套 UI 库。

---

## 4. 职责划分与架构不变式

### 4.1 职责表

| 层 | 负责 | 不负责 |
|---|---|---|
| 前端（平台壳） | 路由、布局、目录树渲染、表单、错误态/空态/加载态、权限态 UI | 任何权限判定、任何"信任客户端"的数据校验 |
| 前端（编辑器） | 文档结构编辑、快捷键、工具栏、图片插入、保存/同步状态展示 | 业务权限、文档元数据写库、HTML 直出 |
| api | 身份认证、授权判定、树操作、元数据、单机保存、版本、附件、审计 | 解析 Yjs 二进制、处理协同消息 |
| collab | WS 鉴权、Yjs 同步、awareness、落库、压缩、快照触发 | 业务规则（谁是 owner、文档该不该可见）、目录树 |
| `packages/db`（Prisma ORM） | 持久化、约束、事务、并发控制、迁移生成 | 业务规则以外的任何逻辑；**不含任何方言判断**；**不向业务层暴露 Prisma 类型** |
| 文件存储 | 二进制对象 | 权限（由 api 判定后代理读取） |

### 4.2 七条架构不变式（违反即视为缺陷，不是"优化建议"）

- **I1 单一事实源**：正文唯一事实源是 Y.Doc；`document_contents.content_json` 是派生只读镜像，任何代码不得把它当作可回写源。
- **I2 写入路径互斥**：同一文档启用协同后，`PUT /nodes/:id/content` 必须返回 `409 COLLAB_ENABLED`；Phase 2 的 REST 保存与 Phase 3 的协同落库不得同时生效。
- **I3 权限只在服务端**：前端隐藏按钮仅改善体验；每个 API、每次 WS 握手、每次附件读取都必须重新判定。
- **I4 元数据与正文分离**：标题、归属、权限、时间在 `nodes`；正文在 `document_contents`。禁止把标题塞进 PM JSON。
- **I5 版本标记**：每个正文持久化写入都带版本标记；读路径遇到未知版本必须拒绝渲染并报错，不得"猜着解析"。**两条演进线分开计版**：`content_schema_version`（PM JSON 镜像，可惰性迁移）与 `yjs_schema_version`（Y.Doc 结构，只能离线批处理），禁止共用一个 `schema_version` 字段。
- **I6 客户端不可直达存储**：客户端只能通过 api 访问文件；不存在可猜测的公开静态路径。
- **I7 数据访问唯一出口**：业务层不得直接依赖 Prisma Client 或数据库驱动。所有数据访问必须经过 `packages/db` 暴露的 Repository 接口。Repository 实现允许使用 Prisma Client，但不得向 Service 层暴露 Prisma Model、Prisma 类型或数据库驱动类型。数据库专属 SQL 和迁移定制只能存在于 `packages/db` 内。ORM 的 schema 定义与迁移是唯一的建表途径，**禁止手写 DDL**。

---

## 5. 文档数据模型

### 5.1 四层数据（必须分清，混在一起就是后续所有痛苦的来源）

| 层 | 载体 | 生命周期 | 谁写 |
|---|---|---|---|
| 业务元数据 | `nodes` | 长期 | api |
| 正文（协同事实源） | `document_contents.yjs_state`（Uint8Array） | 长期 | collab |
| 正文（只读镜像） | `document_contents.content_json` | 派生，可重建 | collab（派生）/api（Phase 2 直写） |
| 版本快照 | `node_versions` | 长期，有保留策略 | api / collab 触发 |

### 5.2 ProseMirror Schema v1

**块级节点**

| 节点 | 关键属性 | 说明 |
|---|---|---|
| `doc` | — | 根，`block+` |
| `paragraph` | `textAlign?` | 基础段落 |
| `heading` | `level: 1\|2\|3` | 仅三级，够 MVP |
| `bulletList` / `orderedList` | `start?`（ordered） | 可嵌套 |
| `listItem` | — | `paragraph block*` |
| `blockquote` | — | 可嵌套 |
| `codeBlock` | `language?` | 纯文本渲染，`preserveWhitespace` |
| `horizontalRule` | — | 分隔线 |
| `hardBreak` | — | 软换行 |
| `image` | `src` `alt?` `title?` `width?` | src **只允许** `/api/v1/attachments/<id>` 形式的平台附件 URL；外链图片一律转存为附件（见 §3.3 C） |
| `table` | — | 基础表格，Phase 2 不做合并单元格 |
| `tableRow` / `tableHeader` / `tableCell` | `colspan?` `rowspan?`（预留） | 预留合并能力，MVP 不开放入口 |

**行内 mark**

| mark | 属性 | 说明 |
|---|---|---|
| `bold` `italic` `underline` `strike` | — | 基础格式 |
| `code` | — | 行内代码 |
| `link` | `href` `target` `rel` | `rel="noopener noreferrer nofollow"`，协议白名单 http/https/mailto |
| `textStyle` | `color?` | 颜色；`fontFamily`/`fontSize`/`lineHeight` 作为扩展点预留，不进 MVP |

**为什么这样定**：覆盖总指导 §5.2 全部要求，且每个节点都是后续协同、评论锚点、版本 diff、搜索的稳定落点。刻意不做的：脚注、分页符、修订标记、目录域、公式。

### 5.3 Yjs 映射

- 一个文档 = 一个 Y.Doc = 一个协同房间（`documentName = nodeId`）。
- 正文：`doc.getXmlFragment('default')`，由 y-prosemirror 与 PM Schema 双向绑定（经 Tiptap 的 Collaboration 扩展）。
- 不使用 Y.Map 存业务元数据（标题不进 Y.Doc，避免"标题并发覆盖"变成 CRDT 问题——标题用 `nodes` 行 + 乐观锁即可）。
- 后续评论锚点（Phase 4）：正文里放稳定 UUID 的 mark，评论内容与线程放独立表，**不放进 Y.Doc**（规避结构冲突，与调研报告结论一致）。
- 客户端本地缓存：`y-indexeddb`，仅用于加速二次打开与断线期间不丢打字；**不作为持久化承诺**（清缓存即失去未同步内容）。

### 5.4 序列化、物化与 Phase 2→3 迁移桥

- 建库初始态：`document_contents.content_json = {"type":"doc","content":[{"type":"paragraph"}]}`，`yjs_state = NULL`。
- Phase 2（无协同）：编辑器以 `content_json` 为内容源，保存时整篇写回并 `revision + 1`。
- Phase 2→3 迁移（关键，必须先实现再开协同）：文档首次被协同连接打开时，若 `yjs_state IS NULL` 且 `content_json` 非空，则用 y-prosemirror 的 JSON→Y.Doc 工具把 JSON 灌入新 Y.Doc，编码后写回 `yjs_state`，并把 `content_json` 标为派生。迁移是**一次性、在事务内完成**的。

**迁移桥必须串行化（v1.1 新增，重要）**：两个客户端同时首次打开同一文档时，都可能读到 `yjs_state IS NULL`，各自构造 Y.Doc 并写回——**后写者覆盖先写者，先写者期间的编辑静默丢失**。因此迁移必须满足：
- 迁移写入与"读取 `yjs_state IS NULL`"两步在同一事务内，中间不得有其他写入插队；
- SQLite 下使用 `BEGIN IMMEDIATE` 事务（而非默认的 deferred 事务）以在读阶段就获取写锁；PostgreSQL 路径用 `SELECT ... FOR UPDATE` 锁住 `document_contents` 行；
- 若并发方已先行完成迁移，后到者必须**重新加载已落库的 `yjs_state`**，绝不能用自己的副本覆盖；
- "幂等"只有在迁移被串行化后才成立。验收用例见 §12 Phase 3 第 10 条。

- 落库派生：`yjs_state` 写入后，用 Y.Doc→PM JSON 派生 `content_json`、`text_preview`（前 200 字）、`char_count`。**派生必须包裹在 SAVEPOINT 内**：派生失败只回滚派生动作，不回滚正文写入（正文优先），并记录告警、把 `content_json` 保留为上一次成功值。

### 5.5 Schema 版本演进

- **两条版本线分开计版**：
  - `document_contents.content_schema_version` —— PM JSON 镜像的版本。迁移在读取时惰性执行（converter 只作用于 PM JSON 镜像），可在线完成。
  - `document_contents.yjs_schema_version` —— Y.Doc 结构的版本。**Y.Doc 结构变更必须写成 Yjs 层迁移脚本并在离线批处理中执行，不允许在连接中就地改结构**。
  - `node_versions` 同样携带 `content_schema_version` 与 `yjs_schema_version` 两个字段。
  - 两者不同步（镜像已升到 v2、Y.Doc 还是 v1）是允许且正常的状态，读路径按各自的版本解释对应内容；**禁止用一个 `schema_version` 同时表达两件事**——那会让"镜像迁移了但协同结构没迁"变成无法区分的歧义。
- 每次 Schema 变更必须附带：迁移函数、往返测试（v_n → v_n+1 → 渲染快照比对）、`docs/schema-changelog.md` 记录。

---

## 6. 表格数据模型（Phase 5，方向性设计）

本阶段只做方向性约束，避免文档模型为表格埋坑；详细设计在 Phase 5 启动时单独出文档。

### 6.1 结构

```
Workbook（工作簿，对应一个 node）
 ├─ unitId / 名称 / locale / 计算模式
 ├─ Sheet[]（工作表）
 │   ├─ sheetId / 名称 / 行列数 / 冻结 / 排序索引
 │   ├─ CellStore：cell(r,c) → { v(值) f(公式) s(样式引用) }
 │   └─ 结构元数据：合并区域、条件格式、数据验证、筛选
 └─ 样式表：命名样式 + 单元格样式（增量存储，不重复整表）
```

### 6.2 变更通道与持久化

- **不采用**"整本工作簿 JSON 字符串覆盖写"。理由是：无法做单元格级冲突合并、无法增量同步、每次保存都全量重传。
- **采用**：单机阶段 = `mutation 序列 + 周期性快照`；协同阶段 = Yjs 承载（每 sheet 一个 Y.Map，key 为单元格地址，结构操作走全局定序），详见调研报告路线 B。
- 持久化分层：`sheet_workbooks`（快照 + yjs_state）＋ `sheet_mutations`（增量日志，保留窗口）＋ `sheet_sheets`（结构元数据，便于列表/权限/审计查询）。
- 冲突粒度：值 LWW；样式字段级 LWW；插删行列与合并必须定序。**不做**单元格级权限、不做 Google Sheets 级全文档 OT。

### 6.3 与文档的共性

共享：`nodes` 树与元数据、权限判定、回收站、版本表结构（`node_versions` 增加 `kind='sheet'` 的 payload）、附件、审计。差异只在"正文如何存、编辑器如何渲染"。这使得平台层无需为表格复制一套目录与权限。

---

## 7. 核心数据库表设计

### 7.1 关系

```
users ──1:N── sessions
users ──1:N── workspace_members ──N:1── workspaces
workspaces ──1:N── nodes（自引用 parent_id 形成树）
nodes ──1:1── document_contents         （正文，仅 doc/sheet）
nodes ──1:N── node_acl                  （显式授权）
nodes ──1:N── node_versions             （历史快照）
nodes ──1:N── attachments               （图片/附件）
workspaces ──1:N── audit_events
```

设计取舍：**统一 `nodes` 表承载文件夹与文档**。理由是目录树只有一种结构，统一表让"移动/删除子树/回收站/权限目标"都只有一套代码；文档特有字段下沉到 `document_contents`，不污染树表。

### 7.2 表结构定义（Prisma Schema，禁止手写 DDL）

**原则**：表结构的唯一来源是 `packages/db/prisma/schema.prisma`；迁移由 `prisma migrate dev` 生成、`prisma migrate deploy` 应用，检入 `packages/db/prisma/migrations/`。**任何人不得手写 `CREATE TABLE`**（Phase 1 验收第 8 条据此判定）。业务层只见 `packages/db` 导出的 Repository 接口，看不到 Prisma Client、看不到表定义、看不到 SQL。

**三层隔离**

| 层 | 内容 | 允许出现 Prisma / 方言差异？ |
|---|---|---|
| `packages/db/prisma/schema.prisma` | 表结构定义（Prisma Schema） | 是 |
| `packages/db/prisma/migrations/*/migration.sql` | 迁移 SQL + Prisma 无法表达的定制索引 | 是 |
| `packages/db/src/repo/mapping.ts` | Prisma 行类型 ↔ 领域类型的转换（实现层共享） | 是（仅此一处） |
| `packages/db/src/repo/*.repo.ts` | 八个仓储实现，按业务聚合各一个文件 | 是 |
| `packages/db/src/repo/interfaces.ts` | Repository 接口（业务领域类型） | 否 |
| `packages/db/src/repo/types.ts` | 业务领域类型 | 否 |
| `apps/*`、`packages/*`（db 除外） | 业务逻辑 | **否**（不变式 I7：不得接触 ORM 与驱动） |

**Repository 层约定**

- 按**业务聚合**组织，不按数据库表拆分：`users` / `workspaces` / `nodes` / `contents` / `acl` / `versions` / `attachments` / `audit` 八个仓储，各自对应一个业务用例聚合，**各占一个文件**（`*.repo.ts`），共享的转换逻辑集中在 `mapping.ts`。
- 接口只用**业务领域类型**（`packages/db/src/repo/types.ts`）。数据库列名 `title_norm` 在领域里是 `titleNormalized`，`email_lower` 是 `email`——领域类型与列名解耦。
- 不提供无业务意义的通用 CRUD。方法是业务动作（`softDelete`、`listTrash`、`listAncestors`），不是 `listAll` / `findById` 堆砌。
- **事务边界在实现层**。跨表原子操作（如"建空间 + 加 owner 成员"）由 Repository 内部用 `$transaction` 完成，不让 Service 层跨 Repository 拼事务。
- **每个仓储都有真实集成测试**（`packages/db/test/`）。用真实数据库而非 mock——Repository 的价值全在"Prisma 查询 ↔ 领域类型"的转换与事务边界上，mock 掉 Prisma 就把这些全测没了。

**类型映射**

| 逻辑类型 | Prisma 类型 | SQLite 落地 | 备注 |
|---|---|---|---|
| 主键 / 外键 | `String @id` | `TEXT` | 应用层 `crypto.randomUUID()` 生成 |
| 自增主键 | `Int @default(autoincrement())` | `INTEGER PRIMARY KEY AUTOINCREMENT` | **必须 Int**，BigInt 在 SQLite 上无法自增 |
| 时间戳 | `DateTime` | `DATETIME` | 一律 UTC |
| JSON | `Json` | `TEXT` | **不能用 `@default`**（见 §3.1 限制 1） |
| 二进制（Yjs 状态） | `Bytes` | `BLOB` | |
| IP | `String` | `TEXT` | |
| 枚举 | `String` + 校验 | `TEXT` | **无数据库级 CHECK 约束**（见 §3.1 限制 2） |
| 标题检索 | `String`（`titleNorm`） | `TEXT` + 索引 | 小写去空白，前缀匹配 |
| 邮箱唯一 | `String @unique`（`emailLower`） | `TEXT` + 唯一索引 | 代替 `lower(email)` 表达式索引（见 §7.3） |

**SQLite 特有约束（实现时必须遵守）**

- 开启 `PRAGMA foreign_keys = ON`（SQLite 默认关闭外键约束，不开等于没有 FK）。
- 开启 WAL 模式（`PRAGMA journal_mode = WAL`），允许读写并发。
- 开启 `busy_timeout`（建议 5000ms），避免写锁竞争时立刻抛 `SQLITE_BUSY`。
- 禁止把 SQLite 文件放在网络盘/NFS 上（WAL 需要共享内存与 POSIX 锁）。
- 备份必须用 `VACUUM INTO` 或停写后复制文件，**不能只复制主文件而漏掉 `-wal`**。

下面按方言无关的**逻辑结构**列出表与列（列名为最终契约）。类型一栏给出 SQLite 落地类型。

```
-- 用户与会话
users
  id             uuid/text   PK
  email          text        原始邮箱
  email_lower    text        唯一（小写去空白）—— 承担大小写不敏感唯一约束
  password_hash  text        scrypt: scrypt$N$r$p$salt$hash
  display_name   text
  avatar_key     text        nullable
  status         enum        active | disabled
  created_at / updated_at / last_login_at   时间戳

sessions
  id             uuid/text   PK
  user_id        FK → users.id        ON DELETE CASCADE
  token_hash     blob        唯一（sha256(随机 32 字节 token)）
  expires_at     时间戳
  created_at / last_seen_at   时间戳
  user_agent     text        nullable
  ip             text        nullable
  revoked_at     时间戳      nullable

-- 空间与成员
workspaces
  id             uuid/text   PK
  name           text
  owner_id       FK → users.id
  default_role   enum        view | comment | edit      （默认 edit）
  created_at / updated_at / deleted_at   时间戳

workspace_members
  workspace_id   FK → workspaces.id   ON DELETE CASCADE
  user_id        FK → users.id        ON DELETE CASCADE
  role           enum        owner | admin | member | viewer
  created_at     时间戳
  PRIMARY KEY (workspace_id, user_id)

-- 目录树 + 文档元数据（统一节点表）
nodes
  id             uuid/text   PK
  workspace_id   FK → workspaces.id     ON DELETE CASCADE
  parent_id      FK → nodes.id          ON DELETE CASCADE   ← 彻底删除父节点时子节点一并删除
  type           enum        folder | doc | sheet
  title          text
  title_norm     text        小写去空白标题，仅用于检索
  owner_id       FK → users.id
  visibility     enum        private | workspace      默认 workspace
  sort_order     int         默认 0
  created_at / updated_at / deleted_at   时间戳
  deleted_by     FK → users.id        nullable
  trash_root_id  FK → nodes.id        nullable   一次删除批次的根，便于整批还原
  INDEX (workspace_id, parent_id, deleted_at, sort_order)
  INDEX (workspace_id, deleted_at) WHERE deleted_at IS NOT NULL

-- 正文（doc/sheet 共用壳，类型由 nodes.type 决定）
document_contents
  node_id                 FK → nodes.id   PK，ON DELETE CASCADE
  content_schema_version  int        默认 1   ← PM JSON 镜像版本（可惰性迁移）
  yjs_schema_version      int        默认 1   ← Y.Doc 结构版本（只能离线批处理）
  content_json            json       nullable  只读镜像；新建时为初始空文档
  yjs_state               blob       nullable  协同事实源（Uint8Array）
  state_vector            blob       nullable  诊断/增量用
  doc_size_bytes          int        默认 0   yjs_state 长度，用于体积监控
  revision                int        默认 0   单机保存模式乐观锁
  text_preview            text       nullable 列表摘要
  char_count              int        默认 0
  updated_by              FK → users.id  nullable
  updated_at / stored_at  时间戳

-- 显式授权
node_acl
  id             uuid/text   PK
  node_id        FK → nodes.id          ON DELETE CASCADE
  subject_type   enum        user | workspace
  subject_id     uuid/text   subject_type=workspace 时 = workspace_id（全员）
  role           enum        view | comment | edit | manage
  effect         enum        allow | deny          默认 allow
  created_by     FK → users.id
  created_at     时间戳
  UNIQUE (node_id, subject_type, subject_id)
  INDEX (subject_type, subject_id)

-- 版本快照
node_versions
  id                    uuid/text   PK
  node_id               FK → nodes.id   ON DELETE CASCADE
  version_no            int
  kind                  enum        auto | manual | restore
  label                 text        nullable
  content_schema_version int       默认 1
  yjs_schema_version    int        默认 1
  content_json          json
  yjs_state             blob       nullable
  created_by            FK → users.id  nullable
  created_at            时间戳
  UNIQUE (node_id, version_no)
  INDEX (node_id, version_no DESC)

-- 附件
attachments
  id             uuid/text   PK
  workspace_id   FK → workspaces.id   ON DELETE CASCADE
  node_id        FK → nodes.id        ON DELETE SET NULL   文档删除后附件保留待清理
  uploader_id    FK → users.id
  original_name  text
  mime_type      text        服务端嗅探结果，不取客户端声明
  byte_size      int
  sha256         text
  storage_key    text        唯一
  width / height int         nullable
  created_at     时间戳
  INDEX (node_id)

-- 审计（Phase 4 起写入；表先建，避免后续迁移改结构）
audit_events
  id             int         PK 自增
  workspace_id   uuid/text
  actor_id       uuid/text   nullable
  action         text        node.create / node.rename / perm.grant ...
  target_type    text
  target_id      uuid/text   nullable
  metadata       json        默认 {}
  ip             text        nullable
  created_at     时间戳
  INDEX (workspace_id, created_at DESC)
```

**与 v1.0 的三处结构变更**（都必须在 Phase 1 建表前落地，改起来要迁移）：

1. `node_acl` 增加 `effect` 列。`allow` 表示授予，`deny` 表示显式降权——没有这一列，`max(base, acl)` 只能"加权限"不能"减权限"，就无法在空间默认 `edit` 的前提下把某个人单独降为只读。判定规则见 §8.2。
2. `nodes.parent_id` 加 `ON DELETE CASCADE`。`parent_id` 自引用若不声明删除行为，彻底删除父节点时子节点将成为孤儿或直接触发外键错误。配合"purge 必须自底向上"的操作约束使用。
3. `schema_version` 拆成 `content_schema_version` 与 `yjs_schema_version`。理由见 §5.5。

其余列名、类型语义、索引与 v1.0 保持一致。

### 7.3 关键约束与容量预估

| 项 | 决策 |
|---|---|
| 软删除 | `nodes.deleted_at`；子节点随根节点批量标记，`trash_root_id` 保持一致 |
| 唯一性 | 不限制同级重名（飞书/腾讯文档均允许），避免重命名频繁冲突 |
| 树深度 | 服务端限制 ≤ 8 层，防递归滥用 |
| 单文档体积 | 告警阈值 `doc_size_bytes > 2 MB`，硬上限 20 MB（拒绝继续编辑并提示拆分） |
| 版本保留 | 每个文档保留最近 50 个 auto + 全部 manual；超出按时间清理 |
| 正文容量 | 1 万文档 × 平均 200 KB ≈ **2 GB** |
| **版本容量（v1.1 修正）** | 上限不是 2 GB，而是 **1 万文档 × 50 个 auto × 200 KB ≈ 100 GB**。版本表才是最大的一笔，保留策略必须同时受**条数**与**总量**约束：单文档保留最近 20 个 auto + 全部 manual，且版本库总量超过 20 GB 时按创建时间淘汰最旧的 auto 快照（manual 不淘汰）。Phase 4 实现时按此执行 |
| SQLite 单文件上限 | SQLite 理论上限 281 TB，实际受磁盘约束；**单文件超过 10 GB 时必须评估迁移 PostgreSQL**（见 §15-D2 切换触发条件） |
| SQLite 写并发 | 单写者模型。所有写入走短事务；`collab` 落库与 `api` 写入不得互相长事务阻塞（见 §9.5） |
| 时区 | 一律 UTC 毫秒时间戳，前端按浏览器时区渲染 |
| 外键 | SQLite 必须显式 `PRAGMA foreign_keys = ON`，否则所有 FK 约束形同虚设 |

**索引策略（v1.2 修订：Prisma 无法表达的两个索引）**

Prisma 不支持部分索引（`WHERE` 子句）与表达式索引（`lower(x)`）。这两个索引**不能降级**，实测结论如下：

**1. `nodes_trash_idx` —— 部分索引（保留在迁移 SQL 中）**

回收站查询（附录 A：`GET /api/v1/workspaces/:id/trash`）是高频查询：
`SELECT ... FROM nodes WHERE workspace_id = ? AND deleted_at IS NOT NULL`

用 `EXPLAIN QUERY PLAN` 实测（2 万节点 / 500 条在回收站）：

| | 查询计划 | 单次查询 | 索引体积 |
|---|---|---|---|
| 无索引 | `SCAN nodes`（全表扫描） | 1.833 ms | — |
| 普通索引 `(workspace_id, deleted_at)` | `SEARCH USING INDEX` | 0.237 ms | **245,760 B（240 KB）** |
| 部分索引 `+ WHERE deleted_at IS NOT NULL` | `SEARCH USING INDEX` | 0.214 ms | **12,288 B（12 KB）** |

查询计划相同，性能差 9.6%，但**索引体积差 20 倍**——普通索引要覆盖空间内所有节点，部分索引只存已删除的。10 万文档时约 1.2 MB vs 60 KB，差距随数据量持续放大。

→ **保留部分索引**，写在 `prisma/migrations/*/migration.sql` 中（附实测数据注释）。`db:verify` 每次校验其存在且带 `WHERE` 条件（见 `packages/db/scripts/verify-structure.ts`）。

**2. `users_email_lower_uq` —— 表达式索引（改为 emailLower 列）**

Prisma 不支持 `CREATE UNIQUE INDEX ... ON users(lower(email))`。→ 在 `users` 表增加 `email_lower` 列（小写去空白），建普通唯一索引；写入时由 Repository 归一化（`normalizeEmail`）。查询按 `emailLower` 命中。

代价是多一列存储（约 30 字节/用户），换来的是走索引的大小写不敏感唯一，且不需要表达式索引。

---

## 8. 权限模型

### 8.1 角色与能力

| 角色 | 读 | 评论（Phase 4） | 编辑正文 | 改标题/移动 | 分享/授权 | 删除/还原 | 建版本/恢复 |
|---|---|---|---|---|---|---|---|
| `view` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `comment` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `edit` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `manage` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

空间角色（`workspace_members.role`）是**上限**，不能被他处授权突破：`viewer` 永远是只读；`owner/admin` **不封顶**（可以被授予 `manage`，且自身的 `manage` 不会被截断）；`member` 同样不封顶。

注意措辞：空间 `owner/admin` 是"不封顶"，**不是**"自动对所有节点拥有 manage"。一个 `owner` 对别人创建的私密文档，默认仍然是 `null`（无权），除非有 ACL 授权或该文档属于自己。理由是空间角色是**上限**而非**授予**——把它当授予会让"私密文档"失去意义（架构文档 §8.2 的伪代码是权威表述，§8.1 的措辞以它为准）。

`node_acl.effect` 提供**降权**能力：`allow` 表示授予（取最大值），`deny` 表示显式禁止（取最小值）。这样在空间默认角色为 `edit` 的前提下，仍可把特定某人单独降为只读。

#### 8.1.1 空间管理与成员的权限边界

空间角色不只影响文档访问，还决定谁能管理空间本身。下表是**服务端强制**的边界
（架构文档 §8.4 反面清单的第一条：前端隐藏按钮后端仍必须复核）。

| 操作 | owner | admin | member | viewer | 非成员 |
|---|---|---|---|---|---|
| 查看空间详情 | ✅ | ✅ | ✅ | ✅ | 404 |
| 查看成员列表 | ✅ | ✅ | ✅ | ✅ | 404 |
| 添加成员 | ✅ | ✅ | ❌ | ❌ | 404 |
| 改成员角色 | ✅ | ✅ | ❌ | ❌ | 404 |
| 移除成员 | ✅ | ✅ | ❌ | ❌ | 404 |
| 改空间名 / 默认角色 | ✅ | ❌ | ❌ | ❌ | 404 |

**四条硬边界**（实现见 `apps/api/src/domain/workspace-service.ts`，全部有测试覆盖）：

1. **非成员一律返回 404，不是 403**。403 会泄露"该空间存在但你无权"，
   404 无法区分"不存在"与"无权限"——这是防探测的基础（架构文档 T5.3）。

2. **owner 不能通过接口设置**。owner 由空间创建时确定；可指派角色只有
   `admin` / `member` / `viewer`。若任何 admin 都能"造"一个 owner，
   就绕过了 owner 的独占权限（改空间设置、purge 回收站）。
   转移所有权是独立操作，不在 MVP 范围。

3. **owner 的角色与存续不可被接口改动**。任何人都不能改 owner 的角色、
   也不能移除 owner——否则 admin 可以先把 owner 降级再自己升上去（实质提权），
   或者让空间失去所有者。

4. **admin 不等于 owner**。admin 能管成员，但**不能改空间设置**。
   这条是为了"不得为了方便实现而扩大管理员权限"——空间名与默认角色
   影响全体成员的访问范围，属于 owner 的独占决策。

**重复添加成员返回 409 而非静默改角色**：调用方传 `role` 的意图若是"设为 X"，
而该用户已有角色，静默覆盖会让调用方误以为操作成功。改角色请用 `PATCH`。

### 8.2 判定算法

**伪代码（可逐行翻译为实现）**

```
effectiveRole(user, node):
  # 0. 空间成员校验：无成员关系一律拒绝
  m = workspace_members(user, node.workspace_id)
  if m is null → 拒绝

  # 1. 空间角色封顶（先取权限，再按空间角色截断）
  #    owner/admin 不封顶；viewer 封顶到 view；member 不封顶
  cap = (m.role == 'owner' or m.role == 'admin') ? manage
      : (m.role == 'viewer') ? view
      : null                       # member 无上限

  # 2. 基础权限
  if node.owner_id == user          → base = manage
  else if node.visibility == 'workspace' → base = workspace.default_role
  else                             → base = null      # private 且非 owner

  # 3. ACL：命中主体 = (user) 或 (workspace: 当前空间全员)
  allows = node_acl where node_id = node.id
                     and (subject = (user,user) or subject = (workspace,workspace_id))
                     and effect = 'allow'
  denies = 同一集合中 effect = 'deny'

  acl_allow = max(roles of allows)   # 无命中 → null
  acl_deny  = min(roles of denies)    # 无命中 → null

  # 4. 合成：allow 抬升，deny 压低，deny 优先
  role = max(base, acl_allow)
  if acl_deny is not null → role = min(role or acl_deny, acl_deny)
  if role is null → 拒绝
  if cap is not null → role = min(role, cap)

  # 5. 回收站：已删除节点仅 manage 可查看/还原；purge 仅 owner/admin
  if node.deleted_at is not null:
      if action in (restore, purge):
          return (action == 'purge') ? (m.role in (owner,admin) ? manage : 拒绝)
                                    : (role >= manage ? manage : 拒绝)
      else:
          return role >= manage ? manage : 拒绝

  return role
```

**规则要点**：

- `max` / `min` 按 `view < comment < edit < manage`；`null` 视为"无"，`max(null, x) = x`、`min(null, x) = x`。
- **顺序不可交换**：必须先算出 base 与 acl，再按空间角色截断（cap）。v1.0 的伪代码把 `min(computed, view)` 写在了 `computed` 被定义之前，且 `?? (m.role == member ? null : null)` 两分支恒等——本版已修正为上面的单一路径。
- **deny 优先于 allow**：同一节点上 `deny:view` 与 `allow:manage` 并存时，结果为 `view`。这正是"把某个人单独降为只读"的实现方式。
- 权限**不继承**自父文件夹（MVP 明确不做继承，避免树改权限时出现"移动即提权"这类漏洞）。
- 回收站内：只有 `manage` 可查看与还原；`purge` 仅空间 `owner/admin`。
- 空间管理员不因管理身份获得正文阅读以外的额外数据（审计可见，正文按 `manage` 正常放开）。

**删除父目录会吸收子批次（§8.2 已知缺陷，如实记录，非设计选择）**：

`nodes.repo.ts` 的 `softDelete` 用 `collectSubtreeIds` 收集子树做批量标记。该函数按 `parentId` 递归遍历，**不筛 `deletedAt`**——已经躺在回收站里的子项也会被遍历到，并把它们的 `trashRootId`、`deletedAt`、`deletedBy` 改写成父目录这一批的值。

实际语义（与"直观预期"不同）：

- **先删子文档、再删父目录**：子文档原有的独立批次信息（批次根、删除时间、删除人）被父目录批次**永久覆盖**。还原时它只能跟着父目录整批回来，无法再单独还原成"它自己被删的那一批"。
- **可见后果**：回收站里子项的批次归属、批次标题、删除时间都会跟着父目录批次变；整批 purge 的 FK 级联范围也随之扩大。
- **权限连带**：`listTrash` 逐节点过滤 ACL，被吸收的子项可能从此对原删除者不可见（其对旧批次根有 manage、对新批次根没有），却仍会被父目录批次的 purge 级联删除——这是 Issue #17 F1 禁用"批次根不可见时的整批操作"的根因之一。

**待改（登记，不在 Phase 1 修复）**：`softDelete` 应把 `collectSubtreeIds` 的遍历限定在 `deletedAt IS NULL` 的子树内（或在遍历到已删除节点时跳过而不改写其字段），保留子项的原批次。改动涉及整批还原语义与 purge 级联范围，需要单独的工单与迁移评估，Phase 1 维持现状并如实呈现。

### 8.3 校验点清单（缺一即漏洞）

| 校验点 | 判定内容 | 失败返回 |
|---|---|---|
| 所有 `/api/v1/*`（除登录/健康检查） | 会话有效、未过期、未撤销 | 401 `UNAUTHENTICATED` |
| 每个节点操作 | `effectiveRole >= 所需能力` | 403 `FORBIDDEN` |
| 列表/树查询 | 只返回可读节点（SQL 内联过滤，不在内存里过滤） | — |
| **移动节点（PATCH parent_id）** | 节点本身 ≥ edit **且目标父级 ≥ edit** | 403 |
| **创建节点（POST /nodes）** | 空间成员 + 目标父级 ≥ edit | 403 |
| 附件上传 | 空间成员 + 目标文档 edit | 403 |
| 附件读取 | 会话 + 所属空间成员 + （文档可见性） | 403/404 |
| WS 握手 | **Origin 白名单** + 会话 + 节点存在 + `effectiveRole >= view` | 关闭连接（4401/4403） |
| WS 写入 | `edit` 以上；否则 `connection.readOnly = true`（**服务端**拒收 update） | 服务端丢弃 |
| WS 文档切换 | 每次切换都重新判定，不复用旧连接的角色 | 关闭 |
| 版本恢复 | `manage` + 无其他活跃编辑者（或强制全员重载） | 409 `COLLAB_BUSY` |

**移动与创建的目标父级权限为什么必须校验**：权限不继承，所以"能在 A 目录编辑文档"不等于"能把文档放进 B 目录"。若只校验节点本身，用户可以把文档移动进自己无权访问的目录，等于把内容送到别人的地盘。

**彻底删除的三种状态码**（实现时踩过一次，记下来）：

| 情形 | 返回 | 理由 |
|---|---|---|
| 不是空间成员 / 节点不存在 | 404 | 不泄露节点存在性 |
| 是成员但对节点无 purge 资格，且**能看见**它（在回收站里） | 403 | 看得见却说"不存在"会误导用户 |
| 是成员、无 purge 资格，且**看不见**它 | 404 | 看不见就不该知道它存在 |

判定顺序**不能反**：必须先判 purge 资格（空间 `owner/admin`），再判可见性。若先判"能否读"，会出问题——已删除节点要求 `manage` 才能读，而空间 admin 对他人创建的 workspace 文档 base 是空间默认角色（通常 `edit`），先读后判会让 admin 永远删不掉别人删的东西。

**评论（Phase 4）的写入通道**：评论**不写入 Y.Doc**，走独立的 REST 接口（`POST /nodes/:id/comments`），因此 `comment` 角色虽然不能编辑正文，但能通过 REST 写评论。WS 侧对 `comment` 角色设 `readOnly = true`，正文 update 一律丢弃。这两条通道必须分开实现，不能混用。

### 8.4 反面清单（明令禁止）

- 前端根据 `role` 渲染出编辑按钮后，后端不复核。
- WS 只校验"登录了"不校验"对这个文档有没有权限"。
- 只读用前端 `editable=false` 实现，服务端仍接收 update。
- 权限判定依赖前端传入的 `workspaceId` / `ownerId`。
- 用 `id` 可枚举的短整型做文档主键（本项目统一 UUID）。

---

## 9. 持久化、自动保存与版本

### 9.1 写入路径与 RPO/RTO

| 模式 | 路径 | 触发 | RPO（最坏丢多少） | 备注 |
|---|---|---|---|---|
| Phase 2 单机 | `PUT /nodes/:id/content` | 输入防抖 1.2s + 失焦 + `visibilitychange` + `beforeunload` | **≤ 1.2 s**（防抖窗口内未落库的内容会丢）；落库成功后为 0 | 带 `revision` 乐观锁，冲突返回 409。`beforeunload` 中的异步请求**不可靠**（浏览器可能直接杀进程），因此不承诺"关页面即 0 丢失" |
| Phase 3 协同 | Hocuspocus `onStoreDocument` | 防抖（默认约 2s，上限约 10s 可配）+ 最后一个连接断开 + 进程退出 | **≤ 防抖上限（默认 10s）** | 进程崩溃最多丢最后几秒；`y-indexeddb` 可在重连后补齐 |
| 版本快照 | `node_versions` | 每 10 分钟有变更 + 手动保存 + 恢复前 | — | 与正文写入同一事务族，失败不阻塞正文 |

**v1.1 修正**：v1.0 把 Phase 2 的 RPO 写成"0（同步落库后返回）"，这句话只在"请求已经返回成功"的前提下成立，而用户视角的"最坏丢多少"应包含防抖窗口。正确表述是：**落库成功后 RPO 为 0；用户视角最坏丢失为防抖窗口（1.2 s）**。§11.3 的非功能目标已按此同步修改。

**冲突（409）时的用户行为必须定义**：同一文档两个标签页同时编辑，后保存者收到 409，前端必须给出明确提示并提供**两个出口**——(a) 载入最新版本（丢弃本地改动）；(b) 复制本地内容到剪贴板/另存为新文档。**不允许只弹一个 toast 然后丢弃用户输入**。

服务重启后恢复能力：正文从 `document_contents.yjs_state` 重建 Y.Doc，客户端重连后做状态向量比对补齐，**不依赖浏览器内存**。

### 9.2 前端保存状态机

```
idle ──编辑──► dirty ──防抖到点──► saving ──200──► saved
                 │                    │
                 │                    └──失败(网络/5xx)──► error(可重试，指数退避)
                 └──协同模式──► syncing（provider 状态）──► synced
```

状态展示文案必须区分：`未保存` / `保存中…` / `已保存` / `同步中…` / `已同步` / `保存失败，重试中` / `离线`。禁止用"已保存"掩盖未落库状态。

### 9.3 派生与压缩

- 派生 `content_json` 与 `text_preview` 在落库事务内完成，但**按文档大小分级**：> 500 KB 时降级为每 5 次落库派生一次，避免大文档拖慢 WS。
- `Y.Doc` 保持默认 `gc: true`；`yjs_state` 每次全量编码天然是压缩态，不需要额外 `Y.mergeUpdates`（仅当引入增量日志后才需要）。
- 体积监控：`doc_size_bytes` 写入时记录，超过 2 MB 记 warn 日志并上报指标；超过 20 MB 拒绝新连接（提示拆分文档）。

### 9.4 故障场景与预期行为

| 场景 | 预期行为 |
|---|---|
| 浏览器刷新 | 从 `y-indexeddb` 秒开 → WS 同步 → 与服务器收敛；无内容丢失 |
| 断网 30s 后恢复 | provider 自动重连，交换状态向量，收敛；状态栏显示"离线→同步中→已同步" |
| collab 进程崩溃 | 客户端显示"连接断开，重连中"；进程重启后按 `yjs_state` 恢复；最多丢防抖窗口内容 |
| 数据库短暂不可用（文件锁竞争 / 磁盘满） | `onStoreDocument` 失败重试并告警；**内存中 Y.Doc 必须保活**（禁止在落库失败时卸载文档），恢复后补写；**不得**因落库失败踢掉所有用户 |
| SQLite 写锁竞争 | `busy_timeout` 内等待；超时报 `SQLITE_BUSY` 时进入重试队列并告警，**不允许静默丢弃落库** |
| 两人同时改同一段 | CRDT 收敛，无冲突弹窗，无内容覆盖 |
| 只读用户尝试注入 update | 服务端丢弃，连接保持；记录告警日志 |
| 版本恢复时有他人在线 | 返回 `409 COLLAB_BUSY`；或（可选）服务端替换状态后广播强制重载 |

**Hocuspocus 落库失败时的文档保活（v1.1 补充）**：Hocuspocus 默认在最后一个连接断开时卸载文档内存态。若此时落库失败（数据库不可用），文档内容会随内存态一起消失——这与 §9.4"内存中 Y.Doc 仍存活"的承诺冲突。因此必须实现：
- 落库失败时设置 `unloadImmediately: false`（或等价配置），文档保留在内存；
- 同时标记该文档为"待落库"，恢复后立即重试；
- 进程退出前若仍有待落库文档，**拒绝退出并告警**（宁可进程不退出，也不要丢内容）；
- 内存中待落库文档数进入监控指标。

### 9.5 SQLite 写并发约束（v1.1 新增）

SQLite 是单写者模型，这直接约束了两个进程的写入方式：

| 约束 | 规则 |
|---|---|
| 事务粒度 | 所有写事务保持**短事务**（目标 < 50ms）。禁止在事务内做文件 IO、网络调用、大对象序列化 |
| `collab` 落库 | `onStoreDocument` 只写 `document_contents` 与 `nodes.updated_at`，不得同时写 `node_versions`（版本快照另起事务） |
| 派生计算 | PM JSON 派生在**事务外**先算好，事务内只做写入；派生失败不影响正文（见 §5.4 的 SAVEPOINT 约定） |
| `api` 写入 | 树操作、权限变更、附件元数据各自独立短事务；不得在事务内调用 `collab` |
| 并发写 | SQLite 支持多读单写，WAL 模式下读不阻塞写。写写冲突由 `busy_timeout` + 重试处理 |
| 迁移 | 结构迁移必须停写执行（`collab` 先停止 → 迁移 → `collab` 恢复），不得在运行期热迁移 |
| 长期演进 | 若出现"写竞争导致落库延迟 > 1s"或"单文件 > 10 GB"，按 §15-D2 的触发条件切 PostgreSQL |

---

## 10. 项目目录结构

```
weShare/
├─ .agents/                         # 调研报告与 agent 规范（既有，只读参考）
├─ .agents/docs/                    # 三份调研报告
├─ docs/                            # 项目自身文档
│  ├─ architecture/                 # 本文与后续架构决策（ADR）
│  ├─ dev-setup.md                  # 本地环境搭建（Phase 1）
│  ├─ acceptance/                   # 每阶段验收脚本与记录
│  └─ ops/                          # 部署、备份、离线安装
├─ apps/
│  ├─ web/                          # Vue 3 SPA
│  │  └─ src/
│  │     ├─ app/                    # 启动、路由、全局样式、权限守卫
│  │     ├─ api/                    # 请求封装（统一错误码、401 处理）
│  │     ├─ stores/                 # Pinia：session/workspace/nodes/ui
│  │     ├─ pages/                  # login / workspace / doc / trash / settings
│  │     ├─ components/             # 平台组件：树、列表、弹窗、状态条
│  │     │  └─ ui/                  # 基于 Reka UI + UnoCSS 的基础件封装
│  │     └─ editor/                 # 编辑器域（与平台解耦）
│  │        ├─ TiptapEditor.vue
│  │        ├─ extensions/          # 自定义扩展（图片、占位、只读）
│  │        ├─ toolbar/
│  │        ├─ presence/            # awareness 头像、光标样式
│  │        └─ collab/              # provider 封装、保存状态机
│  ├─ api/                          # Fastify
│  │  └─ src/
│  │     ├─ server.ts               # 装配、优雅退出
│  │     ├─ config.ts               # zod 校验的环境配置
│  │     ├─ http/                   # 路由、hooks（requireAuth）、错误映射
│  │     ├─ domain/                 # 领域服务：nodes/authz/content/versions/files
│  │     ├─ db/                     # 仅调用 packages/db 的仓储接口（不含 SQL）
│  │     └─ lib/                    # 密码、会话、mime 嗅探、日志
│  └─ collab/                       # Hocuspocus
│     └─ src/
│        ├─ server.ts               # 实例、扩展、优雅退出（落库）
│        ├─ auth.ts                 # 握手鉴权（Origin + 会话 + 角色）
│        ├─ persistence.ts          # onLoadDocument / onStoreDocument
│        └─ metrics.ts              # 连接数、文档数、落库耗时
├─ packages/
│  ├─ shared/                       # 跨端类型、zod 契约、错误码、角色枚举
│  ├─ doc-schema/                   # PM Schema、扩展清单、JSON/Y.Doc 转换、迁移
│  ├─ authz/                        # 权限判定纯函数 + 单测（api/collab 共用）
│  └─ db/                           # 数据库唯一出口（ORM 层）
│     ├─ prisma/
│     │  ├─ schema.prisma            # 表结构定义（唯一真源）
│     │  └─ migrations/              # prisma migrate 生成的迁移（含定制索引），检入仓库
│     ├─ src/
│     │  ├─ client.ts                # Prisma Client 工厂（adapter + pragma），包内私有
│     │  ├─ repo/                    # Repository（按业务聚合组织，每个聚合一个文件）
│     │  │  ├─ types.ts              # 业务领域类型（对外契约）
│     │  │  ├─ interfaces.ts         # Repository 接口
│     │  │  ├─ mapping.ts            # Prisma 行类型 ↔ 领域类型转换（实现层共享）
│     │  │  ├─ users.repo.ts         # 账号与会话
│     │  │  ├─ workspaces.repo.ts    # 空间与成员
│     │  │  ├─ nodes.repo.ts         # 目录树与回收站
│     │  │  ├─ contents.repo.ts      # 正文（镜像 + Y.Doc + 乐观锁）
│     │  │  ├─ acl.repo.ts           # 节点授权（allow / deny）
│     │  │  ├─ versions.repo.ts      # 版本快照
│     │  │  ├─ attachments.repo.ts   # 附件元数据
│     │  │  ├─ audit.repo.ts         # 审计流水
│     │  │  └─ index.ts              # 工厂：组装全部仓储，返回接口类型
│     │  └─ index.ts                 # 对外导出：只含领域类型与 Repository 接口
│     ├─ test/                       # Repository 集成测试（真实数据库，非 mock）
│     │  ├─ fixture.ts               # 建库夹具（应用迁移 SQL + 共享 client）
│     │  ├─ global-setup.ts          # 测试库目录的 setup / teardown
│     │  └─ *.repo.test.ts           # 各仓储的集成测试
│     ├─ scripts/
│     │  ├─ migrate.ts               # 迁移执行（migrate dev / deploy）
│     │  ├─ seed.ts                  # 示例数据（经 Repository 写入）
│     │  ├─ verify-migrations.ts     # 迁移幂等 + 漂移检查
│     │  └─ verify-structure.ts      # 结构逐项对照（对照基准写在此文件）
│     ├─ vitest.config.ts            # 测试配置（forks 池 + 全局钩子）
│     └─ prisma.config.ts            # Prisma 7 配置（schema 路径 + 连接 URL）
├─ infra/
│  ├─ scripts/                      # 备份（VACUUM INTO）、离线依赖固化、迁移执行
│  ├─ systemd/                      # 生产：api/collab 进程单元
│  └─ nginx/default.conf
├─ pnpm-workspace.yaml
├─ package.json                     # 含 "packageManager": "pnpm@9.14.4"
├─ tsconfig.base.json
└─ .env.example
```

关键点：
- `packages/authz` 与 `packages/doc-schema` 是**跨进程共享的纯逻辑**，api 与 collab 共用同一份权限算法，避免"REST 判得对、WS 判得错"。
- `packages/db` 是**唯一的数据库出口**（不变式 I7）。`apps/api` 与 `apps/collab` 都只能通过它的 Repository 接口访问数据，不得直接 import Prisma Client、driver 或表定义。Repository 接口用业务领域类型，不暴露 Prisma Model。
- `apps/web/src/editor` 不得 import `pages/` 里的任何东西；平台与编辑器通过 props/事件通信（符合总指导 7.1）。
- 表格编辑器（Phase 5）落在 `apps/web/src/sheet/`，与 `editor/` 平级，互不依赖。

---

## 11. MVP 功能边界

### 11.1 在范围内

| 域 | 内容 |
|---|---|
| 账号 | 账号密码登录/登出、会话保持、修改显示名（`PATCH /api/v1/me`） |
| 空间 | 创建空间、切换空间、按邮箱添加成员并设角色 |
| 目录 | 文件夹创建/重命名/移动/删除、树形展示、面包屑 |
| 文档 | 新建普通文档、重命名、移动、删除进回收站、还原、彻底删除 |
| 列表 | 最近访问/我的文档/空间全部，标题搜索（`title_norm` 前缀匹配，后续可升级 FTS5） |
| 权限 | view/comment/edit/manage 四角色；分享面板按人授权（含**降权**）；只读模式 |
| 编辑器 | H1–H3、段落、粗斜下划删除线、颜色、有序/无序列表、引用、代码块、链接、图片上传、基础表格、撤销重做 |
| 保存 | 自动保存 + 状态显示 + 刷新恢复 + 失败重试 |
| 协同 | 多人同编、在线成员、光标/选区、断线重连、服务重启恢复 |
| 版本（Phase 4） | 自动/手动快照、历史列表、预览、恢复 |
| 评论（Phase 4） | 划词评论 + 侧栏线程 + 解决/重开（基础态） |

### 11.2 明确不在 MVP

DOCX/XLSX 任何导入导出、Office 在线预览、ONLYOFFICE/Collabora、PDF 导出、分页/打印排版、修订跟踪、@提及与通知、全文检索（仅标题 + 摘要）、单元格级权限、真正的离线编辑（仅本地缓存）、多实例与 Redis、公开分享链接、模板中心、SSO/LDAP（仅预留接口位）、移动端专门适配（保证可用即可）、表格编辑器（Phase 5）。

### 11.3 非功能目标（可测）

| 指标 | 目标 |
|---|---|
| 单文档规模 | 10 万字符 / 2000 段落可正常编辑 |
| 单文档并发编辑者 | ≥ 10 |
| 单实例 WS 连接 | ≥ 200（1.5 核 2 GB 参考） |
| 输入到远端可见 | p95 < 150 ms（内网） |
| 打开文档到可编辑 | p95 < 1.5 s（已有内容） |
| API 读接口 | p95 < 300 ms |
| 自动保存 RPO | ≤ 10 s（协同模式）/ ≤ 1.2 s（单机模式，即防抖窗口；落库成功后为 0） |
| 权限越权 | 0（自动化矩阵用例覆盖） |

---

## 12. 阶段计划与验收标准

> 每阶段结束必须产出阶段报告（实际完成/改动文件/技术说明/数据库变更/启动方式/测试结果/遗留问题/下阶段建议），这是总指导规则 6 的硬要求。

### Phase 1：平台基础骨架（先跑通"有账号、有目录、有文档壳"）

**范围**：git 与工程骨架、数据库迁移、登录会话、空间与成员、目录树 CRUD、文档壳页面、基础权限、回收站。

**验收标准（全部可执行）**
1. 全新机器按 `docs/dev-setup.md` 从零到页面可用，全程无人工改代码。**环境前置条件只有 Node + pnpm**（不需要 Docker、PostgreSQL 或任何数据库服务）。
2. `pnpm -r typecheck`、`pnpm -r lint`、`pnpm -r test` 全绿。
3. API 集成测试覆盖：注册→登录→建房→建目录→建文档→改名→移动→删除→还原，全部 2xx 且数据落库正确。
4. 权限矩阵测试：4 种空间角色 × 4 种文档角色 × 6 类操作，越权用例返回 403 且**不产生副作用**。
5. 跨空间越权：用 A 空间会话访问 B 空间任何 ID，全部 404/403，无信息泄露（不返回"存在但无权"）。
6. 树深度 > 8 被拒绝；移动到自身子树被拒绝；**移动/创建时目标父级无权限返回 403**；删除父目录后子文档全部进入回收站且可整批还原。
7. 刷新页面后会话保持；登出后旧 Cookie 立即失效（服务端会话删除）。
8. 数据库变更只通过 `prisma migrate dev` 产生的迁移文件执行，**仓库中不存在手写 DDL**；迁移可重复执行（空库执行一次得完整结构，二次执行无副作用）；迁移后结构与 §7.2 逐项一致。
9. **方言无关性检查**：在 `apps/` 与 `packages/`（除 `packages/db`）中检索不到方言相关标识（`sqlite`、`pg_trgm`、`jsonb`、`timestamptz`、`bytea` 等），CI 硬失败。
10. **SQLite 正确性检查**：`PRAGMA foreign_keys` 为 ON（用测试断言级联删除真实生效）；删除父节点后子节点确实消失。

**不做**：任何编辑器功能、任何 WebSocket。

### Phase 2：原生在线文档（单机编辑 + 真实持久化）

**范围**：Tiptap 集成、Schema v1、工具栏、图片上传、自动保存、只读模式、标题编辑。

**验收标准**
1. §5.2 列出的每一种格式都能插入、编辑、保存、刷新后完整还原（逐项 checklist，人工 + 自动化快照）。
2. 输入后 1.5 s 内状态变为"已保存"，直接强杀浏览器进程后重新打开，内容与**最后一次成功落库**一致（丢失窗口 ≤ 防抖窗口 1.2 s，此为已知且已声明的边界）。
3. 断网时显示"保存失败，重试中"，恢复网络后自动补写成功，无需手动操作。
4. 只读用户：工具栏禁用、编辑器不可输入、`PUT` 接口返回 403（用 curl 验证，不只看 UI）。
5. 粘贴 Word/网页内容不产生非法节点（Schema 校验拦截），不执行脚本（XSS 用例：`<img onerror>`、`javascript:` 链接）。
6. 图片上传：>10 MB 拒绝、非白名单 mime 拒绝、**SVG 拒绝**、伪造扩展名拒绝；他人无权限时直接访问附件 URL 返回 403。
7. 同一文档两个标签页同时编辑（Phase 2 无协同）：后保存者收到 409，前端给出**明确的两个出口**（载入最新版本 / 复制本地内容），不静默覆盖、不静默丢弃用户输入。

### Phase 3：多人实时协同（本阶段是产品质量分水岭）

**范围**：Hocuspocus 服务、Yjs 接入、在线成员、光标、重连、落库、只读强制、Phase 2→3 迁移桥。

**验收标准**
1. 两个浏览器同开同一文档：A 输入，B 100 ms 级可见；双向均成立（录屏 + 自动化断言）。
2. 自动化收敛测试：3 个 Node 客户端对同一文档随机并发编辑 60 s（插入/删除/格式化混合），结束后三方**解码后的文档状态**一致，且与数据库落库一致。（不比对 `Y.encodeStateAsUpdate` 的字节——同一逻辑状态可能有多种合法编码，字节比对会产生假阴性；应比对解码后的 PM JSON 快照与 state vector。）
3. 断网 30 s 期间持续编辑 ≥20 处，恢复后 5 s 内自动收敛，无冲突弹窗、无内容丢失。
4. 强杀 collab 进程并重启，客户端自动重连，内容与崩溃前一致（防抖窗口内的编辑由 `y-indexeddb` 补齐）。
5. 只读用户用裸 WebSocket 客户端构造 update 帧发送，服务端丢弃且不落库（安全用例，必须自动化）。
6. 未登录/无权限/已删除文档的 WS 握手被拒（4401/4403），不加载文档。
7. **WS 握手 Origin 校验（安全用例，必须自动化）**：从伪造 Origin 的站点发起握手，即使携带有效会话 Cookie 也被拒绝（4403）。这是跨站 WebSocket 劫持的防线。
8. 在线成员列表与光标颜色/姓名正确；关闭页面后 3 s 内从列表消失。
9. 协同编辑时，标题修改与正文修改互不覆盖（元数据与正文分离验证）。
10. **迁移桥并发用例（v1.1 新增）**：两个客户端同时首次打开同一个 Phase 2 文档，两边内容都完整，**无内容丢失、无覆盖**。该用例直接验证 §5.4 的迁移串行化约束。
11. **落库失败保活用例（v1.1 新增）**：模拟数据库不可用后恢复，期间内容不丢、用户不被踢下线、恢复后自动补写成功。

### Phase 4：权限完善 + 版本 + 评论

**验收标准**
1. 分享面板可按人授权 view/comment/edit/manage，被授权者立即可见（无需刷新）。
2. **降权用例（v1.1 新增）**：空间默认角色为 `edit` 时，可对特定某人单独降权为 `view`（`node_acl.effect='deny'`），该用户所有接口与 WS 握手均按只读处理，且不影响空间内其他人。
3. 权限变更后 5 s 内对已连接的 WS 生效（降级为只读或断开）。
4. 自动版本每 10 分钟生成（有变更时），可查看历史列表、预览任一版本、恢复为新版本；恢复不修改历史记录。
5. 恢复操作在有人在线时被拒绝（409）或强制全员重载，二者行为一致且可复现。
6. 划词评论：锚点在文本编辑后不丢失不错位（连续 20 次编辑后仍指向原文）；解决后从默认视图隐藏。
7. 审计日志记录：登录、创建、重命名、移动、删除、授权、恢复、版本恢复；按空间可查。
8. **版本容量用例（v1.1 新增）**：验证版本保留策略同时受条数（单文档 20 个 auto）与总量（版本库 20 GB 上限）约束，超限时按创建时间淘汰最旧的 auto 快照，manual 快照不被淘汰。

### Phase 5：表格编辑器（独立验证后再接入）

**验收标准**
1. 独立 demo 页可用：多 sheet、单元格编辑、样式、合并、冻结、基础公式（SUM/AVERAGE/IF 等 30 个）、撤销重做。
2. 1 万行 × 50 列滚动 ≥ 45 fps；1 万公式单元格重算 < 500 ms。
3. 持久化：单元格级变更落库；刷新恢复；崩溃后不整表丢失。
4. 协同 PoC：两人同编同一 sheet 收敛；插删行并发下坐标正确。
5. 明确不承诺：图表、透视表、xlsx 导入导出（后续单独立项）。

---

## 13. 技术风险清单

| # | 风险 | 等级 | 影响 | 验证/规避 |
|---|---|---|---|---|
| R1 | WS 只读/权限被绕过 | 高 | 数据被越权修改 | 服务端 `connection.readOnly` + 裸客户端攻击用例（Phase 3 验收 5）；不依赖前端 |
| R2 | 协同落库丢失窗口内容 | 中高 | 用户丢稿 | RPO 明示 ≤10 s；退出前 flush；`y-indexeddb` 补写；Phase 3 后期可加增量日志 |
| R3 | PM Schema 演进破坏历史文档 | 中高 | 老文档打不开 | `content_schema_version` / `yjs_schema_version` 双版本 + 迁移函数链 + 往返测试；Yjs 结构变更走离线批处理 |
| R4 | 中文 IME 与远端光标/装饰冲突 | 中 | 输入法候选被吞、光标跳动 | Phase 3 首批用例专测（拼音连续输入 + 远端光标闪烁）；必要时关闭远端装饰的 DOM 重排 |
| R5 | 长文档性能（全量 DOM 渲染） | 中 | 10 万字卡顿 | 阶段目标定 10 万字符；超限提示拆分；虚拟化留作后续（不阻塞 MVP） |
| R6 | ~~本机无 Docker/PG，环境打不通~~ **已消解**（v1.1） | — | — | 改用 SQLite 后不需要数据库服务，环境不再是阻塞项 |
| R7 | Univer 与 Vue 3 集成方式不确定 | 中 | Phase 5 返工 | Phase 5 先做独立 demo，只验证 core，不引入商业包 |
| R8 | 表格协同（结构操作定序）复杂 | 中高 | Phase 5 超期 | 先单机表格，协同单独 PoC；不做 Google Sheets 级 OT |
| R9 | 富文本粘贴带来 XSS 与非法节点 | 中 | 安全/稳定性 | Schema 校验 + 链接/图片协议白名单 + 服务端 HTML 永不直出 |
| R10 | 附件存储与权限耦合 | 中 | 图片越权访问 | 统一走 `/api/v1/attachments/:id` 代理，禁静态直出 |
| R11 | 依赖漂移（Tiptap 调整开源边界） | 低中 | 被迫付费 | 锁版本 + 只用 MIT 包 + CI 许可证门禁 + 关键能力不依赖付费扩展 |
| R12 | 纯内网交付无法安装依赖 | 中 | 交付失败 | Phase 1 起维护 `pnpm fetch` 离线包与镜像清单；CI 记录依赖树快照 |
| **R13** | **SQLite 单写者导致落库竞争**（v1.1 新增） | 中 | 协同落库延迟、写入失败 | 短事务约束（§9.5）+ `busy_timeout` + 写失败重试告警 + WAL；触发切库条件见 §15-D2 |
| **R14** | **ORM 泄漏到业务层**（v1.1 新增，v1.2 修订） | 中 | 后期切 PostgreSQL 变成重写 | 不变式 I7 + CI 数据访问隔离扫描（Phase 1 验收 9）+ `packages/db` 唯一出口 |
| **R15** | **WS 跨站劫持**（v1.1 新增） | 高 | 未登录攻击者读取文档 | 握手校验 Origin 白名单 + Phase 3 验收 7 安全用例 |
| **R16** | **迁移桥并发覆盖丢内容**（v1.1 新增） | 高 | 首次协同打开丢字 | 迁移串行化（§5.4）+ `BEGIN IMMEDIATE` + Phase 3 验收 10 并发用例 |
| **R19** | **SQLite 无枚举 CHECK 约束**（v1.2 新增） | 低 | 绕过 Prisma 写入的脏枚举值不被数据库拦截 | Prisma Client 层校验 + API 边界 Zod 兜底；已知限制，记录在 §15.2 |
| **R20** | **Prisma 迁移定制索引与 Schema 漂移**（v1.2 新增） | 中 | 部分索引被后续 `migrate dev` 覆盖，回收站查询退化 | 定制索引写在迁移 SQL 中并加注释说明；`db:verify` 每次校验其存在（`verify-structure.ts`） |
| **R17** | **版本表容量失控**（v1.1 新增） | 中 | 磁盘写满 | 条数 + 总量双重保留策略（§7.3）+ Phase 4 验收 8 用例 |
| **R18** | **Reka UI 的组件覆盖面**（v1.1 新增，v1.6 修订） | 低 | 目录树/表格自研拖慢工期 |**实测更正**：Reka UI 2.11 已有 `Tree`（`TreeRoot` / `TreeItem` / `TreeVirtualizer`），支持展开收起、单选/多选、键盘导航与虚拟滚动——目录树**不需要自研**。仍缺的是**表格**与**拖放**：列表用原生 `<table>`，拖放用 HTML5 原生 DnD 自建（本场景只需"拖到文件夹上=移动"，不涉及排序计算）。因此 T4.4 的工期风险较原评估**显著下调**。 |

---

## 14. 第一阶段任务清单（Phase 1，可直接开工）

> 顺序即依赖顺序；每个任务给出"完成判据"，避免"写完就算完成"。

**T0 环境与工程骨架**
- T0.1 固化工具链：根 `package.json` 写 `"packageManager": "pnpm@9.14.4"`，`engines.node` 声明 `>=22`；写 `docs/dev-setup.md`（Node + pnpm + 一条命令起 SQLite，无 Docker、无数据库服务）。判据：全新机器按文档走完，`pnpm -r typecheck` 全绿。**已完成**（2026-11-03）。
- T0.2 ~~`git init` + `.gitignore` + 首个 commit~~ **已完成**（2026-11-03：仓库已建于 GitHub，开源规范文件已配齐，`.gitignore` / `.gitattributes` 已就位）。
- T0.3 pnpm workspace 骨架：`apps/web`、`apps/api`、`apps/collab`、`packages/{shared,doc-schema,authz,db}`；根 `tsconfig.base.json`；统一 `lint`/`typecheck`/`test` 脚本。判据：`pnpm -r typecheck` 全绿。**已完成**（2026-11-03）。
- T0.4 `apps/api` 骨架：Fastify 装配、zod 配置、pino 日志、统一错误响应体、`/healthz`。判据：`curl /healthz` 返回 `{ok:true}`。**已完成**（2026-11-03）。
- T0.5 `apps/web` 骨架：Vite + Vue 3 + Router + Pinia + UnoCSS + Reka UI；`/healthz` 联调。判据：页面能显示后端健康状态。**已完成**（2026-11-03）。
- T0.6 启用 CI 的 `code-checks` job：提交根 `package.json` 后把 `.github/workflows/ci.yml` 中该 job 的 `if: false` 去掉。判据：CI 在 PR 上跑出 typecheck / lint / test 结果。**已完成**（2026-11-03）。

**T1 数据库**
- T1.1 `packages/db/prisma/schema.prisma` 定义 §7.2 全部表（含 `node_acl.effect`、`content_schema_version` / `yjs_schema_version` 拆分、`parent_id` 级联删除、`email_lower` 唯一列）。判据：schema 与原迁移逐项对照一致，由 `db:verify` 校验。**已完成**（2026-11-03）。
- T1.2 `packages/db/src/client.ts`：`@prisma/adapter-libsql` 连接 + `PRAGMA foreign_keys=ON`、`journal_mode=WAL`、`busy_timeout=5000`。判据：测试断言三个 PRAGMA 实际生效。**已完成**（2026-11-03）。
- T1.3 生成首个迁移并检入 `packages/db/prisma/migrations/`（含 Prisma 无法表达的部分索引）；`db:migrate` 脚本可重复执行。判据：空库执行一次即得完整结构，二次执行无副作用。**已完成**（2026-11-03）。
- T1.4 seed 脚本：1 个管理员、1 个示例空间、3 个示例文档。判据：`db:seed` 后登录即可见数据。**已完成**（2026-11-03）。
- T1.5 数据访问隔离 CI 脚本：扫描业务层是否 import 了 Prisma Client / 驱动 / `packages/db` 内部路径，命中即失败。判据：故意写入一处 `import { PrismaClient } from "@prisma/client"` 后 CI 红。**已完成**（2026-11-03）。
- T1.6 Repository 层：`packages/db/src/repo/` 下按业务聚合建 8 个仓储（每个聚合一个 `*.repo.ts`）+ `types.ts`（业务领域类型）+ `interfaces.ts`（接口）+ `mapping.ts`（Prisma ↔ 领域类型转换）。判据：业务层不接触 Prisma 类型（由 T1.5 护栏强制）；接口方法对应业务动作而非机械 CRUD；**每个仓储有真实数据库的集成测试**（`packages/db/test/`，非 mock）。**已完成**（2026-11-04：8 个仓储全部有集成测试，共 72 项断言）。

**T2 认证与会话**
- T2.1 **Argon2id** 密码哈希（OWASP 2025 最低配置 m=19 MiB / t=2 / p=1，实测 30 ms）+ 注册/登录/登出/`GET /me`/`PATCH /me`；会话 Cookie（httpOnly、SameSite=Lax、生产 Secure + `__Host-` 前缀、30 天滑动续期）。判据：数据库只存 token 哈希；登出后旧 token 立即失效。**已完成**（2026-11-04）。
- T2.2 `requireAuth` hook 与统一 401；登录失败锁定策略（同 IP 5 次/分钟，第 6 次请求返回 429）。判据：用户不存在与密码错误的响应**状态码、错误码、错误文案完全一致**。**已完成**（2026-11-04）。
- T2.3 登录页（表单校验、错误提示、加载态、回车提交）+ API 封装 + session store + 路由守卫。判据：错误密码不泄露"用户是否存在"。**已完成**（2026-11-04）。

**T3 空间与成员**
- T3.1 创建空间、我的空间列表、切换空间；创建者自动成为 `owner`。判据：创建者角色为 owner；非成员访问空间返回 404（不泄露存在性）。**已完成**（2026-11-04，后端接口；空间切换的前端交互在 T3.3）。
- T3.2 按邮箱添加成员 + 设置角色；移除成员；仅 `owner/admin` 可操作。判据：**owner 不可被接口设置、不可被改角色、不可被移除**（防止 admin 提权与空间失去所有者）；admin 可管成员但**不可改空间设置**。**已完成**（2026-11-04，后端接口）。
- T3.3 空间设置页（名称、默认角色）。判据：`viewer` 在空间内看不到任何写操作入口且 API 403。**已完成**（2026-11-04）：基本信息仅 owner 可改、成员管理 owner/admin 可见、页面级权限控制件显隐（服务端仍每次复核），8 项组件测试覆盖 owner/viewer/member 三种视角。

**T4 目录树与文档**
- T4.1 `packages/authz` 实现 §8.2 判定函数（含 `effect` 降权、cap 截断、回收站分支）+ 完整单测矩阵。判据：覆盖 cap 截断 / allow / deny / 回收站 / purge 五个分支，且**空间 admin 不因管理身份获得他人私密文档权限**。**已完成**（2026-11-04，23 项断言）。
- T4.2 节点服务：创建（文件夹/文档）、重命名、移动（含循环、深度、**目标父级权限**校验）、软删除、还原、彻底删除。判据：移动必须同时校验节点与目标父级；循环与深度超限被拒绝；跨空间挂载/移动返回 404；创建文档时正文行原子建立。**已完成**（2026-11-04，`NodeService` + 节点路由，52 项领域断言 + 24 项 HTTP 集成断言）。
- T4.3 查询接口：树（一次查询构造）、面包屑、最近访问、标题搜索（`title_norm` 前缀匹配）。**部分完成**（2026-11-05：树/面包屑/标题搜索已交付；「最近访问」经确认不在 Phase 1 范围，随 Phase 2 编辑器接入时实现——那时才有「访问」事件可记）。
- T4.4 前端布局：左侧树（展开/折叠/右键菜单）、右侧列表（空态/加载态/错误态）、面包屑。**已完成**（2026-11-04）：reka-ui 自带 Tree 提供展开收起/选择/多选/键盘导航；行数 > 200 时启用 `TreeVirtualizer` 虚拟滚动（以 role=tree 元素为滚动容器）；拖放用 HTML5 原生 DnD 自建（拖到文件夹=移动、拖到空白=移到根级、只读节点不可拖）；右侧列表用原生 table 与树联动；数据全部来自真实 API。12 项组件测试覆盖渲染/展开/只读/选择/拖放/空态/虚拟滚动开关。
- T4.5 文档壳页面：标题输入、只读/可编辑态、正文占位、保存状态的 UI 位置（Phase 2 接真实逻辑）。**已完成**（2026-11-05：DocPage 文档壳已交付，正文编辑逻辑留待 Phase 2）。
- T4.6 回收站页面：列表、还原、彻底删除（二次确认 + 输入标题确认）。**已完成**（2026-11-05：`/w/:workspaceId/trash` 页面按 `trashRootId` 聚批，整批还原、AlertDialog 二次确认输入标题匹配、purge 仅 owner/admin 显隐；11 项组件测试 + API 聚批断言）。

**T5 权限与安全加固**
- T5.1 所有节点接口接入 authz；列表接口在仓储层（`packages/db/repo`）过滤，方言 SQL 不外泄。**已完成**（2026-11-05：所有节点接口均走 `effectiveRole`；列表过滤当前在内存做、用同一判定函数不泄露，SQL 化按 §15.3 #5 待数据量触发）。
- T5.2 越权测试套件：跨空间、跨文档、已删除、深度越界、移动自子树、**移动到无权限父级**、**ACL deny 降权**。
- T5.3 统一错误码表（`packages/shared`）与前端提示映射；404/403 语义统一（无权访问返回 404，避免探测）。**已完成**（2026-11-05：`ERROR_MESSAGES` 全量中文映射 + `errorMessage()` 兜底（5xx 强制兜底、4xx 信任服务端 message）；401 统一跳 `/login?redirect=...`，登录后回跳（仅接受站内路径，防开放重定向））。

**T6 验收与交付**
- T6.1 API 集成测试（登录→CRUD→回收站全链路）。**已完成**（2026-11-05：`node.test.ts` 覆盖删除→回收站→还原→purge 全生命周期、422/403/404 分支与 trashRootId 聚批语义）。
- T6.2 `docs/acceptance/phase1.md` 手工验收脚本（可复现步骤 + 预期结果）。**已完成**（2026-11-05：含前置条件、6 账号角色矩阵、10 节可勾选步骤；浏览器人工验收待执行）。
- T6.3 阶段报告（按规则 6 的 8 项）。**已完成**（2026-11-05：`docs/reports/phase1.md`）。

预估：T0–T6 约 2–3 周（单人全职、环境顺利的前提下）；**本文不承诺工期**，实际进度以阶段报告为准。环境已就绪（Node + pnpm 即可开工），无额外前置条件。

---

## 15. 决策点

| # | 决策 | 状态 | 内容 | 影响 |
|---|---|---|---|---|
| D1 | 前端 UI 基础件 | **已定** | **Reka UI 2.x（headless）+ UnoCSS + TypeScript**，Vue 3。基础件无样式，视觉全部由 UnoCSS 承担 | 平台壳的 Dialog/Popover/Dropdown/Tabs 等用 Reka UI 组合；**目录树与表格需自研**（已计入 T4.4 工期，见 R18）。好处是不与设计系统打架，且组件不绑定数据层 |
| D2 | 数据库 | **已定** | **SQLite 单文件优先 + Prisma 7.10.1 ORM**，通过 `packages/db` 的 Repository 边界隔离，业务层不接触 ORM | 不需要 Docker、不需要数据库服务，Phase 1 可当天开工；交付物少一个运维组件。切换 PostgreSQL 的触发条件：单文件 > 10 GB **或** 落库延迟 > 1 s **或** 需要多实例部署 |
| D2a | ORM 选型 | **已定**（2026-11-03 用户决策，v1.2 修订） | **Prisma 7.10.1**（不用 Drizzle） | Drizzle 是 SQL-like query builder，业务代码会出现 `db.select().from()` 这类近 SQL 表达，"不写方言 SQL"只能靠纪律维持。Prisma 的 Model API 把数据访问收敛成"对领域对象的操作"，配合 Repository 边界，业务层根本不接触 ORM——隔离是结构性的。Prisma 8 目前是 RC，API 不同，暂不采用 |
| D2b | SQLite 驱动 | **已定**（2026-11-03 实施时确定） | **`@prisma/adapter-libsql` + `@libsql/client@^0.17.4`** | `better-sqlite3` 是原生模块，需 node-gyp 编译（Windows 上还要 MSBuild + ClangCL 工具集），会让 CI 与离线交付都变脆。`@libsql/client` 提供预编译二进制，装完即用、文件格式兼容、MIT 许可。**版本必须与 adapter 内置依赖对齐**：adapter 依赖 `^0.17.0`（caret 在 0.x 上锁定 minor），项目若声明 0.18.0 会装两份实例 |
| D2c | email 大小写不敏感唯一 | **已定**（2026-11-03 用户决策） | 增加 `email_lower` 列 + 普通唯一索引 | Prisma 不支持表达式索引 `lower(email)`。多存一列（约 30 字节/用户）换走索引的大小写不敏感唯一 |
| D2d | 枚举校验层 | **已定**（2026-11-03 用户决策） | API 边界 Zod 校验 | SQLite 无数据库级 CHECK 约束，枚举只在 Prisma Client 层生效。绕过 Prisma 写入的脏数据不会被数据库拦住——已知限制，见 §15.2 与 R19 |
| D3 | 评论是否进 MVP | 默认进 | Phase 4 基础态（划词 + 线程 + 解决） | 影响 Phase 4 工期约 1 周 |
| D4 | 账号来源 | 默认自建 | 平台自建账号（MVP）；预留 OIDC 接口位 | 若企业已有统一认证，MVP 后接入时需改登录页与用户表 |
| D5 | 生产反向代理 | 默认 nginx | nginx（本文默认）；MVP 不要求容器化 | 影响部署脚本；compose 降级为可选产物 |
| D6 | 开源与许可证 | **已定** | **Apache-2.0**，仓库托管于 GitHub（**可见性私有**，工程标准按开源执行，见 §15.1） | 见 §15.1。选 Apache-2.0 而非 MIT：含专利授权，且与依赖中 Apache-2.0 的一侧一致，便于做单一许可证声明 |

**D2 的方言扩展承诺（必须兑现）**：`packages/db` 提供 `schema.sqlite.ts` 与预留的 `schema.pg.ts` 两套定义，`repo/` 层方法签名完全一致。切换 PostgreSQL 的工作量上限是"新增一个 schema 文件 + 一个 driver 文件 + 重跑迁移"，**不允许波及业务代码**。这条承诺由 Phase 1 验收第 9 条（方言标识扫描）强制。

### 15.1 开源与治理

**项目性质**：本项目以 **Apache-2.0** 许可证开源，仓库公开托管于 GitHub。目标是让企业能够自行部署、修改、审计这套文档平台，而不是只作为闭源 SaaS 提供。

**"开源"与"私有化部署"不冲突**：开源指代码可读、可改、可自建；私有化部署指交付形态不依赖公有云服务。这正是选 SQLite 单文件作为默认形态的价值——自建者不必先学会运维一个数据库服务。

**已就位的开源规范**

| 文件 | 作用 |
|---|---|
| `LICENSE` | Apache-2.0 全文（自官网取权威原文，非手写） |
| `README.md` | 项目定位、边界、当前状态、技术栈、参与方式 |
| `CONTRIBUTING.md` | 分支模型、提交规范、PR 要求、RFC 流程 |
| `CODE_OF_CONDUCT.md` | Contributor Covenant v2.1（自官网取权威原文） |
| `SECURITY.md` | 漏洞报告渠道、响应时限、什么不算漏洞 |
| `.github/ISSUE_TEMPLATE/` | Bug / 功能请求模板（含"是否越界"自查项） |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR 自查清单（影响面勾选项对应 §4.2 不变式） |
| `.github/workflows/ci.yml` | 仓库规范检查 + 代码检查（方言隔离、许可证门禁） |
| `.github/dependabot.yml` | 依赖与 Actions 自动更新 |
| `.editorconfig` / `.gitattributes` | 跨编辑器、跨平台的一致性 |

**仓库可见性（2026-11-03 决定）**：GitHub 仓库 `Ha1fice/weShare` 当前为**私有**，但**完整保留上述全部开源规范文件与 Apache-2.0 许可证**。

这两件事不矛盾，分工明确：
- **工程实践层**：私有。仓库不对外公开，避免在产品方向稳定前暴露半成品，也避免外部贡献者消耗维护带宽。
- **工程标准层**：开源。协作方式按开源项目执行——改动走 PR 而非直推、变更走评审、漏洞走私密渠道、依赖自动更新、许可证门禁强制。这套标准与仓库是否公开无关，且让"将来转为公开"成为一个零成本开关，而不是一次需要补做的规范化改造。

对内部开发者的实际影响与开源项目一致：任何改动走 PR 并被 CI 门禁检查，架构不变式由机器强制而非口头约定。

**开源带来的额外约束**（进入实现阶段后必须遵守）：

1. **不引入 GPL / AGPL 依赖**。CI 门禁强制。本项目依赖树已是全 MIT / Apache-2.0，保持这个状态是刻意选择。
2. **架构不变式对贡献者同样生效**。§4.2 的约束通过 CI 检查与 PR 模板强制，不依赖"老人都知道"。
3. **安全漏洞走私密渠道**（GitHub Security Advisories），不走公开 Issue。
4. **API 与数据结构变更需要文档先行**，避免贡献者只改代码不改文档造成文档与实现漂移。
5. **不承诺的边界要写清楚**。§11.2 明确列出的排除项（DOCX 导入导出、分页排版等）是范围声明，Issue 里反复出现同类请求时，模板会引导用户对照，避免维护者疲于解释。

**维护模式**：单人维护。响应时间不承诺，但会尽力处理 Issue 与 PR。安全漏洞按 `SECURITY.md` 的目标时间处理。

### 15.2 已知技术限制（Prisma 7 + SQLite）

这些限制**已实测确认**，不是猜测。每条都有对应的应对措施，但限制本身存在——写在这里是为了让后续开发者知道边界在哪，而不是等踩到。

| # | 限制 | 影响 | 应对 |
|---|---|---|---|
| 1 | **Json 字段无数据库默认值** | Prisma 在 SQLite 上生成 `JSONB NOT NULL DEFAULT {}`，SQLite 不认 → 迁移直接失败（Prisma 官方 issue #26571，标记 Major） | Json 字段不用 `@default`；默认值在 Repository 层补齐。`audit_events.metadata` 每次写入显式传值 |
| 2 | **枚举无数据库级 CHECK 约束** | 绕过 Prisma 直接写库的脏枚举值不会被数据库拦住 | Prisma Client 层校验 + API 边界 Zod 兜底；见 R19 |
| 3 | **不支持部分索引** | 回收站查询的索引体积比理想值大 20 倍 | 已在迁移 SQL 中手工补入 `nodes_trash_idx`（带实测数据注释）；`db:verify` 每次校验其存在；见 §7.3 |
| 4 | **不支持表达式索引** | 无法直接建 `lower(email)` 唯一索引 | 改用 `email_lower` 列 + 普通唯一索引，见 §7.3 |
| 5 | **BigInt 无法自增** | `BigInt @default(autoincrement())` 插入报 `NullConstraintViolation` | 自增主键一律用 `Int`（仅 `audit_events.id` 一处） |
| 6 | **Windows 路径格式敏感** | `file:///C:/...`（三斜杠）被 schema engine 拒绝，报 os error 161 | 统一用 `file:C:/...`（两斜杠），见 `packages/db/scripts/migrate.ts` 的 `toDatabaseUrl()` |
| 7 | **schema engine 无法在系统临时目录建库** | `%LOCALAPPDATA%\Temp` 下报 os error 161 | 校验库放在仓库的 `data/` 下，不用系统临时目录 |
| 8 | **Prisma 8 未采用** | Prisma 8 是 RC，API 与 7 不同（TypeScript schema、图迁移、查询 DSL 重写） | 锁 `prisma@^7.10.1`；升级走单独 PR，需重跑 PoC |
| 9 | **libSQL 的 `:memory:` 按连接隔离** | 每个连接看到一个独立的空库。Prisma 有连接池，池里开出第二个连接时模型 API 报 `no such table: main.nodes`，而 raw SQL 走另一连接却能看到表——**排查极具迷惑性** | 集成测试一律用文件库（`packages/db/test/fixture.ts`）；`:memory:` 仅用于一次性探测脚本 |
| 10 | **libSQL 的文件句柄在 Windows 上不及时释放** | `close()` 后立即删库文件报 `EPERM`；即便 worker 进程退出，句柄仍被占用，Vitest `teardown` 阶段删目录必然失败 | 测试库放仓库内 `data/test/`，由 `globalSetup` 的 `setup()` 在**下一轮运行前**清理（那时进程已退出）；`teardown()` 只做尽力而为的清理，失败不影响测试结果 |
| 11 | **Prisma adapter 内部自建 client** | 无法把外部 client 传进去；建表脚本与 Prisma 若各建各的 client，就不是同一个库 | 覆写 adapter 的 `createClient()` 返回自有实例（`packages/db/test/fixture.ts` 的 `SharedClientLibSqlAdapter`） |
| 12 | **Node 无内置 Argon2** | 只能用 npm 包 `argon2`（原生模块） | 该包提供**预编译二进制**，实测 `npm install` 3 秒完成，无需 node-gyp 工具链（与 `better-sqlite3` 的教训一致：能免编译就免编译） |
| 13 | **多进程共享限流状态需外部实现** | 限流器是进程内的 `Map`，多实例部署时各算各的 | MVP 单机部署不受影响（架构文档 §3.4）。多实例时需换成共享实现（Redis 或 DB），记在 R20 一类风险里 |
| 14 | **密码规范化形式用错（待修）** —— 实现用的是 **NFKC**，而 NIST SP 800-63B-4 **正式版**推荐的是 **NFC**（800-63B-3 草案写的是 "NFKC or NFKD"，正式版收紧为 NFC） | NFKC 是**兼容性分解**，会改变字符语义：全角 `＄`→`$`、圈码 `④`→`4`、全角引号 `＇`→`'`。后果有二：(a) 不同输入归并为同一密码，实际熵低于用户预期；(b) 若下游的 SQL 过滤 / WAF 规则在规范化**之前**执行，而入库在**之后**，全角变体可绕过过滤 | **改用 NFC**（`packages/shared/src/password-policy.ts` 的 `PASSWORD_NORMALIZATION`）。NFC 只做规范分解（把 "e"+U+0301 合成 "é"），不做兼容性分解——视觉相同的字符仍归一，但语义不同的字符不会被合并。当前 NFKC 实现是**更严格**（归一范围更大），不是安全漏洞，但在正式部署前应改正 |

### 15.3 待复核项

实施中发现、已记录但**暂不解决**的技术问题。每项写明：问题、影响、当前处置、重新评估的时机。

不散落在提交信息或代码注释里——那些地方没人会去找。

| # | 问题 | 影响 | 当前处置 | 重新评估时机 |
|---|---|---|---|---|
| 1 | **密码规范化形式用错** —— 实现用 NFKC，NIST SP 800-63B-4 **正式版**推荐 NFC（800-63B-3 草案写的是 "NFKC or NFKD"，正式版收紧为 NFC） | NFKC 是兼容性分解，会改变字符语义：全角 `＄`→`$`、圈码 `④`→`4`、全角引号 `＇`→`'`。后果：(a) 不同输入归并为同一密码，实际熵低于用户预期；(b) 若下游的 SQL 过滤 / WAF 规则在规范化**之前**执行、入库在**之后**，全角变体可绕过过滤 | **待改用 NFC**（`packages/shared/src/password-policy.ts` 的 `PASSWORD_NORMALIZATION`）。当前 NFKC 实现是**更严格**（归一范围更大），不是安全漏洞 | **部署前**。改正只需改一个常量 + 补一条测试；已存的 NFKC 哈希可在登录成功时重算——登录流程已实现"参数/形式升级后重新哈希" |
| 2 | **密码黑名单未实现** —— NIST SP 800-63B-4 要求"建立或变更密码时**必须**与常见、预期或已泄露密码的黑名单比对"（SHALL） | 用户可设置 `password123`、`qwerty` 这类必然出现在泄露库里的密码——长度达标但实际强度极低 | **不阻塞当前开发**。NIST 的定位是替代组合规则，而组合规则本项目已按 SHALL NOT 不做，因此目前"只有长度"是一个已知缺口 | 投产前补。最小实现：内置常见密码 Top-N 列表（可离线），在注册与改密时比对。**注意这需要决策数据来源**——用外部 API（如 Have I Been Pwned）会引入出网依赖，私有化部署未必允许 |
| 3 | **会话无绝对过期** —— 目前只有滑动续期（剩余不足一半时延长到完整 TTL） | 用户若一直保持活跃，会话可无限续期。OWASP 建议同时设置空闲超时与**绝对**超时 | **不阻塞当前开发**。绝对超时是"会话最长存活多久"，与空闲超时互补 | 投产前补一个 `SESSION_ABSOLUTE_TTL`（如 30 天封顶），滑动续期不得突破它 |
| 4 | **无密码找回流程** —— 用户忘记密码只能联系管理员 | 私有化部署里管理员是常见角色，可接受；但若产品要对外，缺失是硬伤 | **不阻塞当前开发**。架构文档 §11.1 的 MVP 范围未包含它 | 若要做，需要：重置令牌（单次、有时效、存哈希）+ 邮件通道。邮件在纯内网环境往往不可用，**需先确认部署环境是否有邮件服务** |
| 5 | **树的权限过滤在内存里做，不是 SQL 内联过滤** —— §8.3 要求「列表/树查询只返回可读节点（SQL 内联过滤）」 | 当前实现是：先从库里取出该空间全部节点，再用与别处同一份 `effectiveRole` 在内存里过滤。 **不会泄露**（用的是同一个判定函数），但树很大时会把不可读节点也读进内存，节点数上万后有明显开销 | **不阻塞当前开发**。已用批量 ACL 查询把 N+1 降为 2 次查询 | 单空间节点数超过约 5000 时改为 SQL 侧过滤（把 ACL 的 allow/deny 合成下推到 SQL，或维护物化的可见性表）。 **切换前先加基准测试**，避免凭感觉优化 |

---

**已知限制的共同点**：它们都源于"Prisma 的抽象层比 SQLite 的能力更强"。切换到 PostgreSQL 时，限制 1、2、3、4 全部消失（PG 支持 jsonb 默认值、enum 类型、GIN 索引、表达式索引）。这也是切换 PostgreSQL 的额外收益，不只是容量与并发。

限制 12、13 与方言无关——切换 PostgreSQL 后同样存在（同样没有内置 Argon2，多实例同样需要共享限流）。

限制 9、10、11 是 **libSQL 驱动层**的特性，与 PostgreSQL 无关——切换 PG 后同样适用同样的应对手段（PG 无内存库隔离问题，但连接池与句柄释放的注意事项类似）。

---

## 附录 A：REST 接口清单（Phase 1–3）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/v1/auth/register` | 公开（可关闭） | 注册 |
| POST | `/api/v1/auth/login` | 公开 | 登录，下发会话 Cookie |
| POST | `/api/v1/auth/logout` | 登录 | 注销并删除会话 |
| GET | `/api/v1/me` | 登录 | 当前用户 + 空间列表 |
| PATCH | `/api/v1/me` | 登录 | 修改显示名 |
| GET | `/api/v1/workspaces` | 登录 | 我的空间 |
| POST | `/api/v1/workspaces` | 登录 | 创建空间 |
| GET/PATCH | `/api/v1/workspaces/:id` | 成员 / manage | 详情 / 改名与默认角色 |
| GET/POST | `/api/v1/workspaces/:id/members` | 成员 / admin | 成员列表 / 添加 |
| PATCH/DELETE | `/api/v1/workspaces/:id/members/:userId` | admin | 改角色 / 移除 |
| GET | `/api/v1/workspaces/:id/tree` | 成员（过滤） | 目录树 |
| GET | `/api/v1/workspaces/:id/nodes` | 成员（过滤） | 列表（最近/全部/搜索） |
| GET | `/api/v1/nodes/:id/breadcrumb` | ≥ view | 面包屑（祖先路径） |
| POST | `/api/v1/nodes` | 成员 + 目标父级 edit | 创建文件夹/文档 |
| GET | `/api/v1/nodes/:id` | ≥ view | 元数据 + 有效角色 |
| PATCH | `/api/v1/nodes/:id` | ≥ edit（移动时另需目标父级 edit） | 改名 / 移动 / 可见性 |
| DELETE | `/api/v1/nodes/:id` | ≥ manage | 删除进回收站 |
| POST | `/api/v1/nodes/:id/restore` | ≥ manage | 还原 |
| DELETE | `/api/v1/nodes/:id/purge` | 空间 owner/admin | 彻底删除 |
| GET | `/api/v1/workspaces/:id/trash` | 成员 | 回收站 |
| GET/PUT | `/api/v1/nodes/:id/content` | view / edit | 读取镜像 / 单机保存（协同启用后 PUT 409） |
| GET/POST | `/api/v1/nodes/:id/acl` | manage | 授权列表 / 新增授权（可带 `effect=deny` 降权） |
| DELETE | `/api/v1/nodes/:id/acl/:aclId` | manage | 撤销授权 |
| GET/POST | `/api/v1/nodes/:id/versions` | view / manage | 版本列表 / 手动建版本 |
| POST | `/api/v1/nodes/:id/versions/:no/restore` | manage | 恢复到新版本 |
| POST | `/api/v1/nodes/:id/comments`（Phase 4） | ≥ comment | 新增评论（**走 REST，不经 Y.Doc**） |
| GET | `/api/v1/nodes/:id/comments`（Phase 4） | ≥ view | 评论线程列表 |
| POST | `/api/v1/attachments` | 成员 | 上传（multipart，类型白名单 png/jpeg/webp/gif） |
| GET | `/api/v1/attachments/:id` | 文档可读 | 读取（代理，带缓存头与 `nosniff`） |
| GET | `/healthz` | 公开 | 存活检查（含 DB 连通性） |

统一错误体：`{ "error": { "code": "FORBIDDEN", "message": "…", "requestId": "…" } }`。

## 附录 B：WebSocket 契约（Phase 3）

- 路径：`wss://<host>/collab`；`documentName` = `nodeId`；鉴权复用会话 Cookie（同站 Cookie 随握手发送，无需把长期 token 放进 URL）。
- **Origin 校验（必须）**：握手时校验 `Origin` 头是否在允许列表内（开发 = 本机地址；生产 = 站点自身域名）。不通过则拒绝握手（4403）。这是 Cookie 鉴权 WS 防跨站劫持的唯一手段。
- 服务端钩子：`onAuthenticate`（**Origin → 会话 → 节点 → 角色 → `readOnly`**）、`onLoadDocument`（读 `yjs_state`，含迁移桥串行化）、`onStoreDocument`（防抖落库 + 派生）、`onDisconnect`（最后一人离开时立即落库）、进程退出前 flush。
- **落库失败处理**：落库失败时文档**不得卸载**（保活内存态并标记待落库），恢复后自动补写；进程退出前若仍有待落库文档则拒绝退出并告警（见 §9.4）。
- awareness 字段：`{ user: { id, name, avatarUrl, color }, cursor?: { anchor, head }, lastActiveAt }`；颜色由 `hash(userId)` 稳定选取，跨会话一致。
- 拒绝码：`4401` 未认证、`4403` 无权限（含 Origin 不匹配）、`4404` 文档不存在/已删除、`4429` 文档过大。

---

## 16. 评审记录（v1.0 → v1.5）

**评审日期**：2026-11-03　**结论**：v1.0 的架构方向成立，予以确认；同时修订 19 处缺陷、5 项决策（其中 2 项由本文档作者拍板但记录在此）。v1.2 完成 ORM 从 Drizzle 到 Prisma 的基础设施替换（用户决策，见 §16.5）。v1.4 按业务聚合拆分 Repository 并补齐真实数据库的集成测试（见 §16.6）。v1.5 完成认证与会话（T2），密码算法改用 Argon2id（见 §16.7）。

### 16.1 决策变更

| # | v1.0 | v1.1/v1.2 | 触发原因 |
|---|---|---|---|
| D1 | Ant Design Vue 4（待确认） | **Reka UI 2.x + UnoCSS + TypeScript** | 用户决策。headless 组件不绑定数据层，与"ORM 隔离"的思路一致；代价是目录树/表格需自研（R18） |
| D2 | Docker Desktop / PG 便携版（待确认） | **SQLite 单文件 + Prisma 7.10.1 ORM**，通过 `packages/db` 的 Repository 边界隔离 | 用户决策。私有化交付场景下"少一个要运维的服务"价值更高；通过 Repository 边界保留切换 PostgreSQL 的路径 |
| D2a | — | **ORM 由 Drizzle 改为 Prisma** | 用户决策。Drizzle 是 SQL-like query builder，业务代码会出现近 SQL 表达，"不写方言 SQL"只能靠纪律维持；Prisma 的 Model API 让业务层根本不接触 ORM，隔离是结构性的 |
| D2b | — | **`@prisma/adapter-libsql` + `@libsql/client@^0.17.4`** | 版本必须与 adapter 内置依赖对齐（caret 在 0.x 上锁定 minor），否则装两份实例 |
| D2c | — | **email 大小写唯一用 `email_lower` 列** | Prisma 不支持表达式索引 |
| D2d | — | **枚举校验：API 边界 Zod** | SQLite 无数据库级 CHECK 约束（见 §15.2） |
| — | PostgreSQL 16+ 为唯一数据库 | 新增不变式 **I7**，Phase 1 验收第 9 条用 CI 强制 | D2 变更的配套约束。若不设此约束，隔离会在半年内失效 |
| D6 | （v1.0 未涉及） | **按开源规范建仓**：Apache-2.0 许可证，GitHub 仓库 `Ha1fice/weShare`，配齐 README / CONTRIBUTING / CoC / SECURITY / Issue 与 PR 模板 / CI / Dependabot。**仓库可见性为私有，工程标准为开源** | 用户明确"目标是做一个开源的项目"。许可证选 Apache-2.0：含专利授权，且与依赖中 Apache-2.0 的一侧一致，便于做单一许可证声明（见 §15.1） |

### 16.2 已修复的缺陷

| # | 缺陷 | 严重度 | 处置 |
|---|---|---|---|
| 1 | §8.2 `effectiveRole` 伪代码不可实现：`min(computed, view)` 中 `computed` 未定义；`?? (m.role == member ? null : null)` 两分支恒等 | **高** | 重写为单条线性路径：cap → base → acl → 合成 → 截断（§8.2） |
| 2 | ACL 只能加权限不能减权限，无法把空间默认 `edit` 中的某人单独降为只读 | **高** | `node_acl` 增加 `effect` 列（allow/deny），deny 优先于 allow（§7.2、§8.2、Phase 4 验收 2） |
| 3 | `nodes.parent_id` 自引用未声明删除行为，彻底删除父节点会产生孤儿或外键错误 | **高** | 声明 `ON DELETE CASCADE`，并加 Phase 1 验收 10 |
| 4 | `schema_version` 一列表达两条独立演进线（PM JSON 镜像 vs Y.Doc 结构），语义歧义 | **高** | 拆为 `content_schema_version` / `yjs_schema_version`（§5.5、§7.2） |
| 5 | 附件类型无白名单，SVG 上传等同存储型 XSS；外链图片未定义处理方式（服务端代抓即 SSRF） | **高** | 白名单 png/jpeg/webp/gif，禁 SVG；`image.src` 只允许平台附件 URL（§3.3 C、§5.2、Phase 2 验收 6） |
| 6 | WS 握手不校验 Origin，构成跨站 WebSocket 劫持 | **高** | `onAuthenticate` 增加 Origin 白名单（§3.3 A、§8.3、附录 B、Phase 3 验收 7） |
| 7 | 迁移桥并发：两个客户端同时首次打开同一文档，各自建 Y.Doc 并写回，后写覆盖先写 | **高** | 迁移串行化：`BEGIN IMMEDIATE` + 事务内读改写 + 后到者重新加载（§5.4、Phase 3 验收 10） |
| 8 | §3.3 B "同事务内派生" 与 §5.4 "派生失败不回滚正文" 自相矛盾 | 中 | 派生包裹在 SAVEPOINT 内（§5.4） |
| 9 | Phase 2 的 RPO 写成"0"，忽略了防抖窗口与 `beforeunload` 的不可靠性 | 中 | 改为"落库成功后 0；用户视角最坏 ≤ 1.2 s"，§11.3 同步（§9.1） |
| 10 | "PG 不可用时内存 Y.Doc 仍存活"与 Hocuspocus 默认卸载行为冲突 | 中 | 落库失败抑制卸载 + 待落库标记 + 退出前拒绝退出（§9.4、附录 B） |
| 11 | 移动节点只校验节点本身，未校验目标父级权限 | 中 | §8.3 与附录 A 补校验；Phase 1 验收 6 补用例 |
| 12 | 容量预估漏算版本表：50 auto × 200 KB × 1 万文档 ≈ 100 GB | 中 | 版本保留策略改为条数 + 总量双重约束（§7.3、Phase 4 验收 8） |
| 13 | 附录 A 缺 `PATCH /me`（§11.1 明确在范围内）与面包屑接口 | 低 | 附录 A 补两条（§11.1 同步） |
| 14 | §8.3 "回收站内 manage 可查看" 与 §8.2 "已删除节点除 restore/purge 全拒" 冲突 | 低 | §8.2 回收站分支重写，两者一致 |
| 15 | 409 冲突只规定返回码，未规定用户怎么办 | 低 | 明确两个出口：载入最新 / 复制本地内容（§9.1、Phase 2 验收 7） |
| 16 | `comment` 角色的写入通道未定义 | 低 | 明确评论走独立 REST 接口，WS 侧 `comment` 设 readOnly（§8.3、附录 A） |
| 17 | 版本锚点表缺 `@tiptap/extension-text-style` 等 5 个包 | 低 | §3.5 补齐 |
| 18 | Phase 3 用 `Y.encodeStateAsUpdate` 字节比对收敛，有假阴性风险 | 低 | 改为比对解码后的 PM JSON 快照 + state vector（Phase 3 验收 2） |
| 19 | §2.2 环境实测与实际不符（称 PATH 无 node，实际 v24.17.0/pnpm 9.14.4 可用） | 低 | 按实测改写，并加 `packageManager` 锁定 pnpm 版本（§2.2） |

### 16.3 顺带发现的新增内容（非缺陷，但评审中确立）

- §9.5 SQLite 写并发约束（短事务、派生在事务外、迁移停写执行）
- §3.4 数据目录布局与备份方式（`VACUUM INTO`，WAL 文件不可单独备份）
- §7.2 SQLite 特有约束（`foreign_keys=ON`、WAL、`busy_timeout`、禁网络盘）
- §10 目录结构调整：新增 `packages/db`，`apps/api/src/db` 降为仓储调用
- §13 新增风险 R13–R18
- **§15.1 开源与治理**：许可证、治理文件清单、开源带来的 5 条额外约束
- **§4.2 I7**：架构不变式从 6 条增至 7 条（v1.2 改写为数据访问唯一出口）

### 16.4 未采纳的建议

- **把 `node_acl` 拆成独立的 allow/deny 两张表**：单表加 `effect` 列已足够，拆表会让唯一约束与查询复杂度上升。
- **把内容镜像与 Y.Doc 拆成两张表**：两者一对一且共享生命周期，拆表只增加连接开销。
- **首屏快照作为离线兜底渲染**：已明确 `content_json` 只能用于协同连接建立前的骨架占位，不作为内容源（§3.3 A）。

### 16.5 ORM 替换记录（Drizzle → Prisma，v1.2）

**替换时机**：Phase 1 的 T0（工程骨架）完成、T1 尚未开始业务实现时——Repository 层还没写，业务代码零依赖，是成本最低的窗口。

**影响面**：Drizzle 引用完全封装在 `packages/db` 内（8 个文件），业务层 `grep "@weshare/db"` 零命中。替换只重写了 `packages/db` 一个包 + 一个护栏 + 文档。

**替换中发现并处理的实际问题**：

| # | 问题 | 处置 |
|---|---|---|
| 1 | SQLite 下 `Json @default("{}")` 生成非法 SQL | 去掉默认值，应用层补齐（Prisma 官方 issue #26571） |
| 2 | `BigInt @default(autoincrement())` 在 SQLite 上自增失效 | 改 `Int`；仅 `audit_events.id` 一处 |
| 3 | 枚举无数据库级 CHECK 约束 | 记录为已知限制（R19），API 边界 Zod 兜底 |
| 4 | 必填关系的 `onDelete` 默认变 RESTRICT | 每条 relation 显式声明 |
| 5 | Prisma 不支持部分索引 | 用 EXPLAIN QUERY PLAN 实测证明体积差 20 倍，保留在迁移 SQL 中（§7.3） |
| 6 | Prisma 不支持表达式索引 | `users` 加 `email_lower` 列 |
| 7 | `file:///C:/...`（三斜杠）被 schema engine 拒绝 | 统一 `file:C:/...`（两斜杠） |
| 8 | schema engine 无法在系统临时目录建库 | 校验库放仓库 `data/` 下 |
| 9 | `@prisma/client` 版本与 adapter 内置的 `@libsql/client` 不对齐会装两份 | 项目锁 `^0.17.4`，与 adapter 一致 |
| 10 | `PrismaClient` 构造不能传 `schema` 选项（那是 Prisma 6 的写法） | Prisma 7 用 `prisma-client` generator，自动内置模型 |
| 11 | `Uint8Array` 泛型不兼容（Prisma 的 Bytes 是 `Uint8Array<ArrayBuffer>`） | 领域层用宽松类型，实现层 `toBytes()` 窄化 |
| 12 | `update` 的 checked/unchecked 变体歧义 | 显式标注 `DocumentContentUncheckedUpdateInput` |

**未改动的部分**：`apps/*` 全部业务代码、`packages/{shared,authz,doc-schema}`、CI workflow 结构、§12 验收标准、§14 任务清单。

### 16.6 Repository 层拆分与集成测试（v1.4）

**背景**：v1.3 交付时，Repository 层是 991 行的单文件 `implementations.ts`，且**从未被真实调用过**——测试只覆盖了 authz。骨架里的实现可能有 bug 而 CI 全绿。

**拆分**：按授权的业务聚合结构改为 8 个 `*.repo.ts` + 共享的 `mapping.ts` + 工厂 `index.ts`。行为保持完全一致（typecheck 与既有验证全绿）。

**补测试**：8 个仓储全部补上真实数据库的集成测试，共 **72 项断言**（authz 的 23 项之外）。覆盖的关键行为：

| 仓储 | 关键验证 |
|---|---|
| users | 邮箱大小写不敏感查找与唯一性（数据库层保证）、会话创建/撤销/过期清理、删用户级联删会话 |
| workspaces | 建空间与加 owner 成员原子完成、成员 upsert / 移除、删空间级联删成员 |
| nodes | 标题归一化、软删除标记整个子树、按 trashRootId 整批还原、面包屑顺序、**标题搜索是前缀匹配而非包含匹配**、彻底删除级联 |
| contents | revision 递增、乐观锁冲突抛错、协同落库写 storedAt 且不动 revision、字节字段可置 null |
| acl | allow / deny 两种效果、upsert 覆盖而非新增、按主体查询同时命中用户与空间、撤销不能跨节点 |
| versions | 版本号递增、裁剪只删超量 auto 不动 manual |
| attachments | 关联/解除关联、**删节点后附件保留但置 null**（ON DELETE SET NULL）、删空间级联删附件 |
| audit | 自增主键、metadata 缺省为空对象、分页按时间倒序、跨空间不泄漏 |

**测试中发现并处理的实际问题**：

| # | 问题 | 处置 |
|---|---|---|
| 1 | libSQL 的 `:memory:` 按**连接**隔离 | Prisma 连接池开出第二个连接时模型 API 报 `no such table: main.nodes`，而 raw SQL 走另一连接却能看到表。改用文件库（§15.2 限制 9） |
| 2 | libSQL 的文件句柄在 Windows 上不及时释放 | `close()` 后立即删库文件报 EPERM。测试库改由 `globalSetup` 的 `setup()` 在下一轮运行前清理（§15.2 限制 10） |
| 3 | Prisma adapter 内部自建 client | 覆写 adapter 的 `createClient()` 返回自有实例，否则建表脚本与 Prisma 指向不同的库（§15.2 限制 11） |
| 4 | Vitest 5 只有 `globalSetup` 一个文件钩子 | `setup` 与 `teardown` 从同一文件导出；`teardown` 只做尽力而为的清理，失败不影响测试结果 |
| 5 | 测试期望写成"包含匹配" | 架构文档 §5.2 明确是**前缀匹配**，实现是对的、测试写错了。已改正测试并补一条用例把该语义钉死 |

第 5 条值得单独记一笔：**测试失败时先怀疑测试，还是先怀疑实现，取决于是否有权威依据**。这里权威依据是架构文档的"前缀匹配"表述，实现与文档一致，因此是测试错了。这类误判如果反过来（改实现去迁就测试），就会悄悄偏离既定设计。

### 16.7 认证设计决策（T2，v1.5）

#### 密码哈希算法：Argon2id 而非 scrypt

v1.0 的 §14 原写"scrypt 密码哈希"。实施时查证 OWASP Password Storage Cheat Sheet 2025，结论改变：

| 算法 | OWASP 2025 最低配置 | 本机实测耗时 | 内存 |
|---|---|---|---|
| **Argon2id**（首选） | m = 19 MiB, t = 2, p = 1 | **31 ms** | 19 MiB |
| scrypt（Argon2 不可用时的备选） | N = 2^17, r = 8, p = 1 | 269 ms | 128 MiB |

选 Argon2id：它是 OWASP 的首选，且比 scrypt **快 8.7 倍、内存少 6.7 倍**。scrypt 的 N=2^17 每次哈希要占 128 MiB，在多用户并发登录时是实打实的内存压力。

Node 22+ 无内置 Argon2，但 `argon2` npm 包提供**预编译二进制**——实测 `npm install argon2` 3 秒完成，无需 node-gyp 编译（这与 `better-sqlite3` 的教训一致：能免编译就免编译）。许可证 MIT。

参数写进哈希串（argon2 标准格式 `$argon2id$v=19$m=19456,t=2,p=1$...`），因此**将来提高参数时旧哈希仍可校验**，登录成功后按需重新哈希升级——渐进式升级，不需要强制全员改密码。

#### 密码策略：NIST SP 800-63B-4

| 规则 | 取值 | 依据 |
|---|---|---|
| 最小长度 | 15 字符 | NIST：SHALL 至少 8，**SHOULD 至少 15**。取推荐值——8 是底线不是目标 |
| 最大长度 | 64 字符 | NIST：SHOULD 允许至少 64 |
| 字符类型组合 | **不要求** | NIST：SHALL NOT 强加组合规则。组合规则会迫使用户发明 "BigToe@1" 这类可预测密码 |
| 长度计数 | Unicode 码点 | NIST：每个码点算一个字符（不是 UTF-16 单元，也不是字节） |
| 超长处理 | **拒绝，不截断** | 截断会让 "A"×100 与 "A"×64 等价，削弱长密码短语 |
| Unicode 规范化 | **NFKC，哈希前执行** | NIST SP 800-63B-4 第 3.1.1.2 节第 4 条。解决"全角/半角、组合重音"视觉相同码点不同导致的登录失败 |

**中文密码的实际影响**：15 个汉字比 15 个英文字符难记得多。这是"字符数"策略的固有代价——NIST 按码点计是明确要求，但业界的"等效长度"做法（CJK 字符按更多位计）我们暂未采纳。理由是等效长度需要维护一张字符强度表，复杂度与收益不匹配；**若后续用户反馈中文密码难以满足，正确的做法是引入等效长度而非降低到 8 字符**。

#### 防账号枚举

- 登录接口对"用户不存在"与"密码错误"返回**完全一致**的响应（状态码、错误码、文案）——集成测试逐项断言。
- 用户不存在时也跑一次**真实生成的**哑哈希校验，让响应时间接近。（哑哈希必须是真实编码串：编造的串会在解析阶段快速失败，反而暴露"用户不存在"。）
- 限流按 **IP** 而非账号——按账号锁定会被攻击者用来锁死他人账号。

#### 会话设计

- token 用 32 字节 CSPRNG（256 位熵，OWASP 下限 64 位），base64url 编码；
- 数据库只存 sha256 哈希，明文只在 Cookie 里；
- **登出即删服务端会话**——只清 Cookie 不够，被窃取的 token 仍可用；
- **登录即轮换会话 ID**（防会话固定）；
- 滑动续期：剩余有效期不足一半时延长到完整 TTL，不换 session id；
- Cookie 属性：`HttpOnly` + `SameSite=Lax` + `Path=/` + 生产 `Secure` + `__Host-` 前缀（强制 path=/ 且无 domain，子域无法覆盖）。

#### 实施中发现并修掉的问题

| # | 问题 | 处置 |
|---|---|---|
| 1 | **共享包的循环依赖** —— `index.ts` 导出 `auth-contract.ts`，后者又从 `index.ts` 取 `PASSWORD_MIN_LENGTH`，ESM 下拿到 undefined（表现为"密码至少需要 undefined 个字符"） | 密码策略独立成 `password-policy.ts`，两边都从它导入 |
| 2 | **DB_PATH 解析基准不一致** —— `migrate.ts` 按 `packages/db` 解析，`client.ts` 按进程 cwd 解析。两者不同时，"迁移的库"与"应用连的库"落在不同位置 | 统一按**仓库根**解析（`packages/db/src/client.ts` 与 `scripts/migrate.ts` 各有一份常量，已互相注明） |
| 3 | **限流 off-by-one** —— `count >= maxAttempts` 让第 5 次失败就锁（实际只给了 4 次机会）；改成 `>` 又多给一次（攻击者能试 6 次） | 语义定为"允许 5 次失败，第 6 次请求返回 429"，补单元测试固定 |
| 4 | **测试隔离不完整** —— 限流计数在进程内，重建数据库不会清掉它，跨用例累积 | 夹具的 `reset()` 同时重置限流器 |
| 5 | **业务包间接依赖驱动** —— api 包若直接 import `@libsql/client` 建库会违反不变式 I7 | 建库能力下沉到 `packages/db/src/test-support.ts`，以子路径导出；I7 护栏新增规则：业务文件禁止 import 测试辅助，测试文件放行 |

---

## 17. 测试与 CI 策略

> 本节记录 CI 自动化的**设计约束**，与 §4.2 的架构不变式同级——违反即视为缺陷。
> 范本参考 gosslan 项目的 CI 实践，按 Node 栈裁剪。

### 17.1 分层

| 层 | 内容 | 耗时量级 | 何时跑 |
|---|---|---|---|
| **快速层** | 仓库规范、护栏、typecheck、lint、单元测试 | 秒级 | 每次提交 |
| **重门禁层** | 数据库迁移校验、依赖许可证门禁、依赖安全审计 | 分钟级 | 每次 PR |

分层不是为了省时间，是为了让"日常提交"能立刻拿到反馈，而"合入 main 前"必须跑完全部。**分层规则由 `scripts/verify.mjs` 自动校验**：看起来是重门禁却没标记 `heavy: true` 的步骤会当场报错——否则 `--fast` 会悄悄跳过本该快的检查。

### 17.2 步骤表唯一真源

所有门禁步骤只在 `scripts/verify.mjs` 的步骤表里定义一次，CI 只说"跑哪一组"。

```
node scripts/verify.mjs                  # 快速层全部组
node scripts/verify.mjs --group repo     # 指定组
node scripts/verify.mjs --full           # 含重门禁层
node scripts/verify.mjs --list           # 列出所有步骤
```

**为什么必须单源**：历史上 CI 文件与本地脚本各抄一份步骤，改了一边忘了另一边，结果是"本地有这条门禁、CI 永远不跑"，而且**没有任何信号表明这件事发生了**。

每个步骤必须声明 `group`，漏写会在加载时直接 `exit 1`。后果正是上面那种静默失效。

### 17.3 零覆盖 ≠ 通过

**受检范围为空时，退出码是 2，不是 0。**

这是本项目 CI 最容易忽略的一种失败：门禁看起来绿了，实际上一条检查都没跑。典型成因是路径写错、正则失效、阈值过松。触发场景：Phase 1 工程骨架就位前，`apps/` 与 `packages/` 还不存在，方言隔离护栏扫的是空目录。

因此：
- 护栏退出码 `0` = 通过、`1` = 发现违规、`2` = 零覆盖（**不是通过**）；
- `verify.mjs` 把退出码 2 单列为 ⚠️，既不计入通过也不计入失败；
- 前置条件未就位的步骤用 `enabled()` 显式声明跳过，并在结尾**点名列出**，不静默省略。

### 17.4 护栏非空转验证

**每加一条守门测试，都必须证明它真的会失败。**

做法（`scripts/guards/selfcheck.mjs`）：把仓库复制到临时目录 → 施加最小破坏 → 跑护栏 → 断言退出码非 0 → 恢复 → 再跑 → 断言退出码为 0 或 2。

理由：一条永远通过的守门测试，比没有守门测试更危险——它给出"已检查"的假信号。路径写错、正则失效、被 try/catch 吞掉异常，这些 bug 都不会让 CI 变红，只会让它一直绿。

这套机制在本次搭建中**当场抓出了 4 个真实缺陷**（护栏自身的路径解析、中文数字处理、注释里的 glob 破坏块注释、破坏用例正则不匹配）。

### 17.5 机械化的架构不变式

§4.2 的不变式不能只写在文档里等人自觉，必须有对应守卫：

| 不变式 | 机械化方式 | 脚本 |
|---|---|---|
| I7 数据访问唯一出口 | 扫描业务层是否 import 了 Prisma Client / 驱动 / `packages/db` 内部路径 | `check-data-access-leak.mjs` |
| 禁止手写 DDL | 表结构只能来自 `prisma migrate` 生成的迁移 | `check-repo-layout.mjs` |
| 文档数字不得腐烂 | 文档里的"N 条"必须等于现算值；`§X.Y` 引用必须指向存在的章节 | `check-doc-numbers.mjs` |
| 测试不得静默不跑 | 磁盘上的测试文件必须被 `test` 脚本覆盖（或改用 glob） | `check-test-manifest.mjs` |
| 测试不得被删光 | 测试文件数量不得低于下限（当前 8） | `check-test-count.mjs` |

`check-doc-numbers.mjs` 的现算能力：不变式条数与编号连续性、各 Phase 验收条数、§16 表格行数、所有 `§X.Y` 交叉引用的有效性。它同时是一个双向检查——**文档改了数字要同步改内容，代码改了内容要同步改文档**。

**两条测试护栏互补，缺一不可**：`check-test-manifest.mjs` 防"新增测试文件但没登记进收集范围，从未执行过"；`check-test-count.mjs` 防"把测试文件删光"。后者尤其必要，因为 `vitest run --passWithNoTests` 在零测试时返回 0——**删光测试后 CI 依然全绿**，与 §17.3「零覆盖 ≠ 通过」直接冲突。

**数据访问层的测试用真实数据库，不用 mock**。Repository 的价值全在"Prisma 查询 ↔ 领域类型"的转换与事务边界上——mock 掉 Prisma 就把这些全测没了，只剩下"代码跑通了"这种无信息量的断言。集成测试读的是 `prisma/migrations/` 下将来要部署到生产的那份 SQL，因此测试与生产结构不会漂移。

这套测试踩过三个 libSQL 的坑（`:memory:` 按连接隔离、文件句柄不及时释放、adapter 自建 client），已记入 §15.2 限制 9–11。

### 17.6 失败诊断走注解通道

GitHub 的 job 日志页对匿名访问关闭（`actions/jobs/{id}/logs` API 匿名返回 403）。实测三条渠道里只有 **check-run 注解**可匿名读取。

因此 `scripts/ci-run.sh` 把命令输出合成**一条多行注解**（GitHub 每 step 只保留约 10 条注解，逐行 emit 会让有用的行被 `... ok` 淹没），内容包含：退出码、输出行数、关键行（`✗`/`FAIL`/`AssertionError`/`expected` 等）、末尾 30 行。

### 17.7 测试框架选型

**Vitest**（不用 gosslan 的 `node --test` 路线）。

理由：gosslan 是 Tauri + Rust，前端没有 DOM 测试地基，只能靠 CDP 真实浏览器探针；weShare 有 Vue 组件与编辑器逻辑，需要 `jsdom` 环境与组件测试能力，`node --test` 做不到。**这是 gosslan 范本最弱的一环，不照抄。**

数据库测试用**文件库**，不用 `:memory:` 内存库——这一点是实测纠正的（§15.2 限制 9、§16.6）：

- libSQL 的 `:memory:` 是**按连接隔离**的：每个连接看到一个独立的空库。Prisma 有连接池，池里开出第二个连接时模型 API 报 `no such table: main.nodes`，而 raw SQL 走另一连接却能看到表。排查极具迷惑性。
- 测试库是**文件库**，放在仓库内 `data/test/`，每个测试文件一个独立文件（并行互不干扰），结构由 `prisma/migrations/` 的迁移 SQL 建立——**测试用的就是将来要部署到生产的那份 SQL**，不会与生产结构漂移。
- libSQL 的文件句柄在 Windows 上不及时释放，删除时机由 Vitest 的 `globalSetup` 控制（§15.2 限制 10）。

不引入 testcontainers、不引入 Docker——与 §2.2 的环境决策一致。

### 17.8 已知不做的

gosslan 有而本项目**不需要**的：Rust 工具链全套（fmt/clippy/feature 门控/平台基线）、跨平台矩阵（macOS/Windows 双腿）、Android 交叉编译、WebView2 打包档。

gosslan **没有**而本项目**需要自建**的：依赖安全审计、许可证门禁、ESLint/Prettier、CODEOWNERS、Dependabot（已配）、覆盖率阈值。

覆盖率：**暂不设阈值**。理由是 Phase 1 尚无代码，过早设阈值只会催生为凑数字而写的测试。Phase 2 结束后视实际形态再定。

### 17.9 行尾一致性不是风格问题

`.gitattributes` 的 `* text=auto eol=lf` 强制 LF 入库。**Windows 上开发时 CRLF 会让护栏用 `"\n}\n"` 抠函数体的锚点失效，整批护栏静默退化**（断言永远为真）。CI 里有专门的行尾检查项兜底。

---

---

## 18. 文档编写约定

### 18.1 `§` 只用于本文档内部引用

`§X.Y` 表示**本文档**的第 X.Y 节。引用**外部标准**时，必须写全标准名 + 章节号，**不要用 `§`**：

| 引用对象 | 正确写法 |
|---|---|
| 本文档 | `§8.2 判定算法` |
| NIST SP 800-63B-4 | `NIST SP 800-63B-4 第 3.1.1.2 节` |
| OWASP Cheat Sheet | `OWASP Password Storage Cheat Sheet 2025` |
| RFC | `RFC 7914` |

（"错误写法"一列刻意不举具体例子——文档对账护栏会扫描全文里的所有 `§X.Y`，
示例中若出现真实的错误记法，会被当成真的坏引用而误报。）

**为什么这条要单独立规矩**：本文档对账护栏（`check-doc-numbers.mjs`）会检查所有 `§X.Y`
是否指向真实章节。外部标准的章节号混进来会被判为"指向不存在的章节"——护栏本身是对的
（它无法区分意图），但报错信息会让人误以为是文档写错了。

实际发生过一次：写认证章节时把 NIST 的章节号写成了本文档的 `§` 记法，对账护栏立刻报
"该章节不存在"。护栏在这次是**对的**——那个章节号在本文档中确实不存在。改成全称后通过。

### 18.2 数字必须与现算值一致

文档里凡是"N 条""N 项""N 个"这类**手抄的数字**，必须与实际现算值一致。
对账护栏会现算并比对（不变式条数、编号连续性、各 Phase 验收条数、§16 表格行数）。

改动内容时同步改数字——包括**反方向**：合并了两项就把"N 项"减一。

### 18.3 章节引用必须指向存在的章节

同 18.1。引用本文档章节前先确认它存在；新增章节后引用它的旧内容不会自动失效，
但**删改章节号**时必须全局搜一遍。

### 18.4 待复核项登记在 §15.3

实施中发现但**暂不解决**的技术问题，登记在 §15.3 的表里，注明"影响 + 应对 + 何时该重新评估"。
不要散落在提交信息或代码注释里——那些地方没人会去找。

---

*本文档随代码同步维护。v1.5 已确认：Phase 1 的 T0–T2 已实施完毕，T3.1/T3.2 后端接口已完成；
当前进度见 §14。*
