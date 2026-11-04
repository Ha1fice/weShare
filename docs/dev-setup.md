# 本地环境搭建

> 对应架构文档 T0.1。前置条件只有 **Node + pnpm**，不需要 Docker、不需要 PostgreSQL、不需要任何数据库服务。

## 前置条件

| 项       | 要求                                   | 检查命令      |
| -------- | -------------------------------------- | ------------- |
| Node     | ≥ 22（开发用 24.x 亦可）               | `node -v`     |
| pnpm     | 9.14.4（由 `packageManager` 字段锁定） | `pnpm -v`     |
| corepack | 随 Node 附带，用于锁定 pnpm 版本       | `corepack -v` |

**不需要**：Docker、PostgreSQL、MySQL、Redis。数据库是 SQLite 单文件，随项目走。

## 首次搭建

```bash
# 1. 启用 corepack，让 pnpm 版本由 package.json 的 packageManager 字段决定
corepack enable

# 2. 安装依赖
pnpm install

# 3. 初始化数据库（建表 + 示例数据）
pnpm db:migrate
pnpm db:seed

# 4. 启动全部服务
pnpm dev
```

启动后：

| 服务                 | 地址                  |
| -------------------- | --------------------- |
| web（Vite）          | http://127.0.0.1:5173 |
| api（Fastify）       | http://127.0.0.1:3000 |
| collab（Hocuspocus） | ws://127.0.0.1:3100   |

打开 http://127.0.0.1:5173 ，页面会显示后端健康状态。

## 端口冲突怎么办

改端口用环境变量，不要直接改代码：

```bash
# 单个服务
PORT=3222 pnpm --filter @weshare/api dev

# web 联调：代理目标要跟着 api 端口一起改
API_PROXY_TARGET=http://127.0.0.1:3222 WEB_PORT=5273 pnpm --filter @weshare/web dev
```

`apps/web/vite.config.ts` 从 `API_PROXY_TARGET` / `COLLAB_PROXY_TARGET` 读代理目标，
从 `WEB_PORT` / `WEB_HOST` 读自己的监听地址——改 api 端口时不会静默失配。

## 目录说明

```
data/weshare.db      # SQLite 数据库文件（自动创建，已在 .gitignore 中）
uploads/             # 附件目录（自动创建，已在 .gitignore 中）
```

## 常用命令

```bash
pnpm dev            # 并行启动三个服务
pnpm build          # 构建全部
pnpm typecheck      # 全量类型检查
pnpm lint           # 全量 lint
pnpm test           # 全量单元测试（含 Repository 的真实数据库集成测试）
pnpm format         # Prettier 格式化

pnpm verify         # 快速层验证（仓库规范 + 护栏 + typecheck/lint/test）
pnpm verify:full    # 完整验证（含数据库迁移校验等重门禁）

pnpm db:generate    # 生成 Prisma Client（改 schema 后必须执行）
pnpm db:migrate     # 执行数据库迁移（可重复执行）
pnpm db:seed        # 写入示例数据
pnpm db:verify      # 迁移校验（空库执行得完整结构、二次执行无副作用、结构逐项对照）
```

## 数据访问层的测试

`packages/db/test/` 下的集成测试用**真实数据库**，不用 mock——Repository 的价值全在"Prisma 查询 ↔ 领域类型"的转换与事务边界上，mock 掉 Prisma 就把这些全测没了。

```bash
pnpm --filter @weshare/db test          # 只跑 Repository 集成测试
pnpm --filter @weshare/db test --watch  # 监听模式
```

测试库是仓库内的文件库（`data/test/`），每个测试文件一个独立库，结构由 `prisma/migrations/` 的迁移 SQL 建立——**测试用的就是将来要部署到生产的那份 SQL**。

两个容易踩的坑（详见架构文档 §15.2 限制 9–11）：

- **不要把测试库换成 `:memory:`**。libSQL 的内存库按连接隔离，Prisma 连接池开出第二个连接时会报 `no such table`，而 raw SQL 却能正常——排查极具迷惑性。
- **测试库目录由 `globalSetup` 管理**，不要在测试里自己删。libSQL 在 Windows 上不及时释放文件句柄，立即删会 EPERM；残留由下一轮运行的 `setup()` 清掉。

## 修改数据模型

表结构的唯一来源是 `packages/db/prisma/schema.prisma`。改完 schema 后：

```bash
# 1. 生成并应用迁移（开发环境）
cd packages/db
pnpm exec prisma migrate dev --name <变更名>

# 2. 重新生成 Client
cd ../..
pnpm db:generate

# 3. 校验结构一致性（对照基准在 packages/db/scripts/verify-structure.ts）
pnpm db:verify
```

迁移 SQL 检入 `packages/db/prisma/migrations/`，**禁止手写 DDL**。

Prisma 在 SQLite 上无法表达**部分索引**与**表达式索引**。本项目用到的两个定制索引（回收站部分索引、邮件大小写唯一）处理方式见架构文档 §7.3——新增定制索引时，必须同步更新 `verify-structure.ts` 的期望结构，否则 `db:verify` 不会发现它的缺失。

## 常见问题

### Prisma Client 未生成

报 `@prisma/client did not initialize yet. Please run prisma generate` 时：

```bash
pnpm db:generate
```

### 数据库被占用 / `SQLITE_BUSY`

SQLite 是单写者模型。检查是否有残留进程占用 `data/weshare.db`：

```bash
# Windows
tasklist | findstr node
```

正常情况下 WAL 模式 + `busy_timeout=5000` 会自动等待重试。

### 迁移报 os error 161「指定的路径无效」

Prisma 的 schema engine 在 Windows 上要求 `file:C:/path/db`（**两斜杠**）。三斜杠形式 `file:///C:/path/db` 会被拒绝。路径转换统一在 `packages/db/scripts/migrate.ts` 的 `toDatabaseUrl()` 里，不要手写 URL。

同时注意：schema engine 无法在系统临时目录（`%LOCALAPPDATA%\Temp`）下创建 SQLite 文件，校验库要放在仓库的 `data/` 下。

### 枚举值不被数据库拦截

SQLite 没有数据库级的 CHECK 约束，枚举只在 Prisma Client 层校验。绕过 Prisma 直接写库能写入非法枚举值。API 边界另用 Zod 校验兜底（架构文档 §15.2）。

### 数据库锁住 / `SQLITE_BUSY`

SQLite 是单写者模型。检查是否有残留进程占用 `data/weshare.db`：

```bash
# Windows
tasklist | findstr node
```

正常情况下 WAL 模式 + `busy_timeout=5000` 会自动等待重试。

### 端口已被占用

换个端口即可，见上文「端口冲突怎么办」。

### 想清空数据库重来

```bash
rm -rf data/ uploads/    # Windows: rmdir /s /q data uploads
pnpm db:migrate
pnpm db:seed
```

## 验证环境是否就绪

```bash
pnpm verify:full
```

应当看到 9 个步骤全部通过（`✅ 全部通过（9 个步骤）`）。任何一步失败都会明确指出是哪一步、为什么失败。
