# 贡献指南

感谢参与 weShare。本文档说明如何参与，以及哪些约定不可绕过。

## 开始之前

**请先读架构文档**：[`docs/architecture/00-项目总体架构与MVP实施方案.md`](docs/architecture/00-项目总体架构与MVP实施方案.md)。

这不是形式主义。该文档里的 §4.2「架构不变式」是**约束**，不是"优化建议"——违反它们会被当作缺陷拒绝，而不是当作风格差异讨论。例如：

- 正文唯一事实源是 Y.Doc，`content_json` 是派生只读镜像，不得回写
- 权限只在服务端判定，前端隐藏按钮只算体验优化
- 同一文档不得并存两条写入路径
- 业务代码不得出现方言 SQL（`packages/db` 之外）

如果你要做的改动与某条不变式冲突，先开 Issue 讨论，不要直接改代码。

## 环境

```
Node ≥ 22
pnpm 9.14.4    # 通过 package.json 的 packageManager 字段锁定，用 corepack enable
```

不需要 Docker，不需要 PostgreSQL。数据库是 SQLite 单文件。

```bash
corepack enable
pnpm install
pnpm dev
```

## 分支模型

| 分支 | 用途 |
|---|---|
| `main` | 始终可发布。每个 Phase 的验收通过后合入 |
| `feat/<phase>-<简述>` | 功能分支，例：`feat/phase1-auth` |
| `fix/<简述>` | 缺陷修复 |
| `docs/<简述>` | 纯文档改动 |
| `refactor/<简述>` | 不改变外部行为的重构 |

Phase 1 起步阶段可以接受开发者直接向 `main` 提 PR；协作人数增加后改为必须走功能分支。

## 提交规范

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>

<body>

<footer>
```

type 取值：

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `refactor` | 不改变外部行为的重构 |
| `perf` | 性能优化 |
| `test` | 测试 |
| `docs` | 文档 |
| `build` | 构建、依赖、工具链 |
| `ci` | CI 配置 |
| `chore` | 杂项 |

subject 使用中文或英文均可，但**同一仓库内保持一致**，且不超过 72 字符。

```
feat(authz): 支持 node_acl.effect 降权
fix(collab): 落库失败时抑制文档卸载，避免内容丢失
docs(architecture): 架构文档升 v1.1，修复 19 项评审缺陷
```

破坏性变更必须在 footer 标注：

```
feat(api): 节点移动接口改为要求目标父级 edit 权限

BREAKING CHANGE: PATCH /api/v1/nodes/:id 在移动时新增目标父级权限校验，
旧客户端可能返回 403。
```

## PR 要求

1. **关联 Issue**：在描述里写 `Closes #123`，或说明这是 RFC 的一部分。
2. **通过检查**：`pnpm -r typecheck`、`pnpm -r lint`、`pnpm -r test` 全绿，CI 也要绿。
3. **说清楚改了什么**：为什么这么改、放弃了哪些方案、有哪些已知限制。
4. **架构改动要同步文档**：改了表结构就更新 §7.2，改了权限判定就更新 §8.2 并补测试用例。**代码与文档不一致比代码没写更糟。**
5. **一个 PR 一件事**：不要把重构和新功能混在一起。

### 必须带测试的改动

| 改动类型 | 必需测试 |
|---|---|
| 权限判定 | `packages/authz` 的完整角色矩阵单测（越权用例必须断言**无副作用**） |
| 数据结构 | 迁移在空库执行一次得完整结构，二次执行无副作用 |
| API | 集成测试覆盖完整链路，含 401 / 403 / 404 语义 |
| 协同链路 | 收敛测试（比对解码后的文档状态，**不要**比对 `Y.encodeStateAsUpdate` 的字节） |
| 安全相关 | 攻击用例必须自动化，见架构文档 §12 各 Phase 的验收标准 |

## 不变式怎么测

架构文档 §4.2 的不变式有对应的机械化检查，不靠人自觉：

- **方言不可上浮**：`packages/db` 之外不允许出现 `sqlite`、`jsonb`、`timestamptz` 等标识，CI 扫描，命中即失败。
- **许可证门禁**：GPL / AGPL 依赖硬失败。
- **无手写 DDL**：表结构只来自 `drizzle-kit generate` 的迁移。

## 架构变更流程

改动以下任一项，走 RFC 流程（Issue 讨论 → 落成文档 → 再写代码）：

- §4.2 的任何一条不变式
- §7.2 的表结构（列的增删、语义变更）
- §8.2 的权限判定算法
- 事实源的选择（Y.Doc 与 `content_json` 的关系）

流程：在 Issue 里写清**问题 → 备选方案 → 取舍 → 影响面**，维护者确认后先改文档，再提实现 PR。文档 PR 与实现 PR 可以分开，但最终必须都在 `main` 上。

## 行为准则

参与即表示同意 [行为准则](CODE_OF_CONDUCT.md)。不可接受的行为请通过 Issue 私下报告给维护者，不要在公开 Issue 里讨论。

## 提问

- 功能想法、用法问题 → Issue
- 架构讨论 → Issue 加 `RFC` 标签
- Bug → 按 [Issue 模板](.github/ISSUE_TEMPLATE/bug_report.md) 填写，**必须包含复现步骤**

不确定某个改动是否越界时，先开 Issue 问。这比提一个会被拒的 PR 省时间。
