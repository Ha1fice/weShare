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
pnpm test           # 全量单元测试
pnpm format         # Prettier 格式化

pnpm verify         # 快速层验证（仓库规范 + 护栏 + typecheck/lint/test）
pnpm verify:full    # 完整验证（含数据库迁移校验等重门禁）

pnpm db:migrate     # 执行数据库迁移（可重复执行）
pnpm db:seed        # 写入示例数据
pnpm db:verify      # 迁移校验（空库执行得完整结构、二次执行无副作用）
```

## 常见问题

### `better-sqlite3` 编译失败

**本项目已不使用 better-sqlite3**，改用 `@libsql/client`（预编译二进制，装完即用）。
若在旧分支上遇到 node-gyp 编译错误，检查是否需要 MSBuild + ClangCL 工具集。

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
