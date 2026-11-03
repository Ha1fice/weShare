# weShare

> 企业内部、可私有化部署、浏览器内原生协同的文档平台。

一套开源的协同文档平台：用户直接在浏览器里创建平台原生文档，平台自己拥有文档数据模型、编辑器、协同机制、权限与版本体系。**不是** Office 文件的在线预览器，也**不是** DOCX/XLSX 的解析渲染器。

---

## 它是什么

| | |
|---|---|
| **产品形态** | 平台壳（登录 / 空间 / 目录树 / 文档列表 / 回收站）+ 原生富文本文档 + 真实多人协同 |
| **事实源** | 正文唯一事实源是 Y.Doc（CRDT），ProseMirror JSON 只是派生的只读镜像 |
| **元数据** | 标题、归属、权限、时间独立存储，与正文分离 |
| **权限** | 服务端强制。WebSocket 握手时判定角色，只读由服务端拒收 update，不靠前端藏按钮 |
| **数据库** | SQLite 单文件 + Drizzle ORM，方言差异隔离在 `packages/db`，为后期切 PostgreSQL 留出路径 |
| **部署** | 一个目录 + 三个进程 + 一个 db 文件。不需要 Docker，不需要单独运维数据库服务 |

### 不是什么

这些是**明确不在范围内**的边界，不是"还没做"：

- DOCX / XLSX 的导入导出、Office 在线预览、ONLYOFFICE / Collabora 集成
- PDF 导出、分页排版、修订跟踪
- 真正的离线编辑（只有本地缓存加速，不承诺离线可写）
- 单元格级权限、公开分享链接、SSO / LDAP（仅预留接口位）

判定一条需求是否属于本项目，看三个问题：

| 判据 | 属于本项目 | 不属于本项目 |
|---|---|---|
| 数据从哪来 | 平台自己创建的结构化内容 | 从 .docx/.xlsx 解析出来的内容 |
| 谁是事实源 | 我们的 Schema / Workbook 模型 | Office 文件的 OOXML 结构 |
| 值多少钱 | 协作、权限、留存、可检索 | 与 Word 的排版一致度 |

---

## 当前状态

**架构已确认，代码尚未开始。** 这是诚实的现状描述，不是路线图上的一个待办。

- [总体架构与 MVP 实施方案](docs/architecture/00-项目总体架构与MVP实施方案.md) —— v1.1 已确认，1126 行
  - §12 分阶段验收标准（Phase 1–5，每条都可执行）
  - §14 Phase 1 任务清单（T0–T6，含完成判据）
  - §16 评审记录（19 项缺陷的处置过程）
- [三份技术选型调研](.agents/docs/) —— 编辑器选型、私有化协同工具调研、表格编辑器选型

里程碑按**可交付的闭环**划分，而不是按功能数量：

| 阶段 | 交付什么 |
|---|---|
| Phase 1 | 平台骨架：账号、空间、目录树、文档壳、权限、回收站 |
| Phase 2 | 原生富文本文档：Schema v1、工具栏、自动保存、只读模式 |
| Phase 3 | 多人实时协同：Yjs + Hocuspocus、在线成员、落库、只读强制 |
| Phase 4 | 权限完善 + 版本快照 + 划词评论 |
| Phase 5 | 表格编辑器（独立验证后再接入） |

---

## 技术栈

| 领域 | 选型 | 许可证 |
|---|---|---|
| 编辑器 | Tiptap 3 + ProseMirror | MIT |
| 协同 | Yjs + y-prosemirror + Hocuspocus | MIT |
| 前端 | Vue 3 + TypeScript + Reka UI + UnoCSS | MIT |
| 后端 | Fastify 5（REST） + Hocuspocus 4（WebSocket） | MIT |
| 数据库 | SQLite + Drizzle ORM | MIT / Apache-2.0 |
| 表格（Phase 5） | Univer core | Apache-2.0 |

全链路 MIT / Apache-2.0，无 GPL / AGPL。CI 有许可证门禁，GPL / AGPL 依赖硬失败。

---

## 本地开发

前置条件只有 **Node ≥ 22 + pnpm 9.14.4**。不需要 Docker，不需要 PostgreSQL。

```bash
corepack enable
pnpm install
pnpm dev
```

详细步骤见 [docs/dev-setup.md](docs/dev-setup.md)（Phase 1 交付）。

---

## 参与贡献

- [贡献指南](CONTRIBUTING.md) —— 分支模型、提交规范、PR 要求
- [行为准则](CODE_OF_CONDUCT.md) —— 参与即表示同意
- [安全策略](SECURITY.md) —— 漏洞如何报告
- [Issue 模板](.github/ISSUE_TEMPLATE/) / [PR 模板](.github/PULL_REQUEST_TEMPLATE.md)

架构层面的改动请先读架构文档对应的章节，多数设计约束是**不变式**，改动它们需要走 RFC 流程并在文档里留下记录。

---

## 许可证

[Apache License 2.0](LICENSE)

本项目自身代码采用 Apache-2.0。引入的第三方依赖各自遵循其许可证，CI 中有门禁强制检查。

**关于仓库可见性**：当前仓库为**私有**，但保留完整的开源工程实践——Apache-2.0 许可证、贡献指南、行为准则、安全策略、Issue/PR 模板、CI 门禁、Dependabot。这意味着它随时可以转为公开，而不需要补做规范化改造；也意味着任何内部开发者都按开源项目的标准协作（改动走 PR、变更走评审、漏洞走私密渠道）。
