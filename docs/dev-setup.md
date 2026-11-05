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

打开 http://127.0.0.1:5173 会跳转到登录页。**seed 脚本创建的管理员账号**（见 `packages/db/scripts/seed.ts`）可直接登录。

## 账号与会话

| 操作     | 说明                                                                 |
| -------- | -------------------------------------------------------------------- |
| 注册     | `POST /api/v1/auth/register` — 需 `ALLOW_REGISTER=true`（生产应关闭） |
| 登录     | `POST /api/v1/auth/login` — 成功后下发会话 Cookie                  |
| 登出     | `POST /api/v1/auth/logout` — 服务端删除会话，旧 token 立即失效      |
| 当前用户 | `GET /api/v1/me` — 返回用户与空间列表                              |
| 修改资料 | `PATCH /api/v1/me` — 改显示名                                       |

**密码策略**（NIST SP 800-63B-4）：15–64 字符，不要求字符类型组合。

**本地开发的 Cookie**：`SECURE_COOKIE=false` 时用普通 Cookie 名 `weshare_session`（`__Host-` 前缀强制要求 `Secure`，本地 http 用不了）。生产走 https 时必须设 `SECURE_COOKIE=true`，否则子域可以覆盖会话 Cookie。

**登录限流**：同 IP 连续 5 次失败后，第 6 次请求返回 `429 RATE_LIMITED`。窗口长度由 `LOGIN_LOCK_WINDOW_SECONDS` 控制（默认 60 秒）。开发时若被误锁，等窗口过去即可，或重启 api 进程（计数在进程内存里）。

**DB_PATH 相对于仓库根**，不是相对于启动目录——从哪个目录启动 api 都会连到同一个库。

**协同服务的 `ALLOWED_ORIGINS` 必须显式配置**。与 api 的 `CORS_ORIGINS` 不同，这里留空**不是"不校验"，而是"一律拒绝"**：

```bash
# 开发：写上 vite 的地址
ALLOWED_ORIGINS=http://127.0.0.1:5173

# 生产：写上真实站点地址（可多个，逗号分隔）
ALLOWED_ORIGINS=https://doc.example.com
```

理由：Cookie 鉴权的 WebSocket 不受同源策略保护，浏览器会带着 Cookie 发起跨站握手。若放行任意 Origin（或放行"无 Origin"），攻击者在自己页面里 `new WebSocket()` 就能以受害者身份读走文档。这就是跨站 WebSocket 劫持（CSWSH）。留空拒绝比留空放行安全，所以设计成 fail-closed。

## 空间与成员

| 操作             | 说明                                             |
| ---------------- | ------------------------------------------------ |
| 我的空间         | `GET /api/v1/workspaces` — 含我在其中的角色       |
| 创建空间         | `POST /api/v1/workspaces` — 创建者自动成为 owner  |
| 空间详情         | `GET /api/v1/workspaces/:id`                      |
| 改名 / 默认角色  | `PATCH /api/v1/workspaces/:id` — **仅 owner**       |
| 成员列表         | `GET /api/v1/workspaces/:id/members`              |
| 添加成员         | `POST /api/v1/workspaces/:id/members` — owner/admin |
| 改成员角色       | `PATCH /api/v1/workspaces/:id/members/:userId`     |
| 移除成员         | `DELETE /api/v1/workspaces/:id/members/:userId`    |

**权限边界**（服务端强制，详见架构文档 §8.1.1）：

| 操作         | owner | admin | member | viewer | 非成员 |
| ------------ | ----- | ----- | ------ | ------ | ------ |
| 查看详情/成员 | ✅    | ✅    | ✅     | ✅     | 404    |
| 管理成员     | ✅    | ✅    | ❌     | ❌     | 404    |
| 改空间设置   | ✅    | ❌    | ❌     | ❌     | 404    |

三条容易踩的硬边界：

- **非成员返回 404 而不是 403** —— 403 会泄露"该空间存在"。
- **owner 不能通过接口设置、不能被改角色、不能被移除** —— 否则 admin 可以先把 owner 降级再自己升上去（实质提权），或者让空间失去所有者。
- **admin 不能改空间设置** —— 空间名与默认角色影响全体成员的访问范围，属于 owner 的独占决策。

**添加成员时不能设 `owner` 角色**（接口会返回 422）——可指派角色只有 `admin` / `member` / `viewer`。

## 目录树与文档节点

| 操作             | 说明                                                       |
| ---------------- | ---------------------------------------------------------- |
| 目录树           | `GET /api/v1/workspaces/:id/tree` — 只含我可读的节点       |
| 列表 / 搜索      | `GET /api/v1/workspaces/:id/nodes?q=关键词` — 前缀匹配     |
| 回收站           | `GET /api/v1/workspaces/:id/trash` — 只含我有 manage 的    |
| 创建             | `POST /api/v1/nodes` — `type` 只允许 `folder` / `doc`      |
| 详情             | `GET /api/v1/nodes/:id` — 含我对它的有效角色               |
| 面包屑           | `GET /api/v1/nodes/:id/breadcrumb`                          |
| 改名 / 移动 / 可见性 | `PATCH /api/v1/nodes/:id` — 移动时额外校验目标父级权限 |
| 删除进回收站     | `DELETE /api/v1/nodes/:id` — 连带整棵子树                  |
| 还原             | `POST /api/v1/nodes/:id/restore` — 按删除批次整批还原      |
| 彻底删除         | `DELETE /api/v1/nodes/:id/purge` — 仅空间 owner/admin      |

**几条容易踩的规则**：

- **权限不继承**。能编辑 A 目录下的文档，不等于能把文档移进 B 目录——移动会单独校验目标父级。
- **树最多 8 层**（`MAX_TREE_DEPTH`）。创建与移动都会校验，超限返回 422。
- **不能移到自己的子孙下**（会成环），返回 422。
- **跨空间挂载/移动一律 404**，不区分"不存在"与"无权"。
- **私密文档**（`visibility=private`）：只有创建者与被 ACL 显式授权的人能读。空间 `admin` **不会**因为管理身份拿到权限。
- **创建文档会自动建立正文行**，两者在同一事务里——不会出现"打不开的文档"。
- **彻底删除必须先删除进回收站**，直接 purge 未删除节点返回 422。

## 文档正文与协作

### 正文接口

| 操作         | 说明                                                         |
| ------------ | ------------------------------------------------------------ |
| 读正文       | `GET /api/v1/nodes/:id/content` — 需 ≥ view                  |
| 保存正文     | `PUT /api/v1/nodes/:id/content` — 需 ≥ edit，**必须带 revision** |
| 协同连接     | `ws(s)://<host>/collab`，文档名 `node:<节点 id>`               |

**同一文档永不允许并存两条写入路径**（架构文档不变式 I2）：

- 文档还没被协同打开过 → `yjs_state` 为 NULL → REST 保存可用；
- 文档一旦被协同服务装载（哪怕只有一个连接）→ `yjs_state` 非空 → `PUT content` 返回 `409 COLLAB_ENABLED`，正文只能经 WebSocket 写入。

这不是限制，是安全性：两条路径同时活着一秒钟，就可能有一份内容被另一份静默覆盖。

**revision 是乐观锁，不是提示**。客户端保存必须回传它读到的版本号；不匹配返回 409，前端给出两个明确出口（载入最新版本 / 另存为副本），不静默覆盖也不静默丢弃。

**体积上限 20 MB**（序列化后字节数）。超限返回 `413`。

### 协同连接的三道关

1. **Origin 白名单**（`onConnect`）—— 见上文。失败直接拒绝握手。
2. **会话 + 权限**（`onAuthenticate`）—— 复用 `@weshare/authz` 的 `effectiveRole`，与 REST 侧同一份算法；两侧判定不会漂移。
3. **只读强制**（`connection.readOnly`）—— view 角色的连接发来的 update 帧由服务端丢弃。前端禁用工具栏只是体验优化。

关闭码：`4401` 未登录、`4403` Origin 不过、`4404` 文档不存在或无权（与 REST 的 404 语义对齐，不泄露存在性）。

### 落库与丢失窗口

- 协同改动按 `STORE_DEBOUNCE_MS`（默认 1200 ms）节流落库，最长 `STORE_MAX_DEBOUNCE_MS`（默认 8000 ms）必须落一次。
- 为什么节流：SQLite 单写者，每次击键都落库会把自己锁住。
- 用户视角最坏丢失 = 防抖窗口。**落库成功后 RPO 为 0**，这个边界是明示的，不假装是 0。

### Phase 2 文档迁到协同

文档第一次被协同打开时，`content_json`（Phase 2 的单机正文）会经 **y-prosemirror** 一次性灌进 Y.Doc，然后把 `yjs_state` 写回。

两个客户端**同时**首次打开时，靠两层保证不产生重复内容：

- 进程内：按 nodeId 串行化装载，后到者等前者完成后从数据库回放；
- 跨进程：`claimCollaborative` 条件更新（`yjs_state IS NULL`），没抢到的一方丢弃自己的迁移结果。

这一条有专门的并发测试（`apps/collab/test/persistence.test.ts`）。

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

应当看到 11 个步骤全部通过（`✅ 全部通过（11 个步骤）`）。任何一步失败都会明确指出是哪一步、为什么失败。
