# 部署与同事试用

> 面向"我要把这套东西跑起来给同事用"的人。不是云平台教程，是单机私有化部署的最小可用路径。

## 形态

一个目录、三个进程、一个 db 文件。

```
/data            SQLite 数据库（weshare.db）
/uploads         附件
/opt/weshare     代码与产物
   apps/web/dist  静态文件（由 nginx 或任意静态服务器托管）
   apps/api       Fastify，默认 3000
   apps/collab    Hocuspocus WebSocket，默认 3100
```

三者的关系：

```
浏览器 ──HTTP──> 静态服务器(web/dist)
       ──/api─> api:3000
       ──/collab(ws)─> collab:3100
```

api 与 collab **共用同一个 SQLite 文件**。这是设计如此：正文在 `document_contents`，元数据在 `nodes`，两边读写同一份数据，不需要跨进程同步协议。

## 前置条件

| 项 | 要求 |
|---|---|
| Node | 22 LTS（CI 与生产基线，不要用更高版本） |
| pnpm | 9.14.4（`packageManager` 字段锁定） |
| 反向代理 | nginx / Caddy，负责 TLS 与静态文件 |
| 数据库服务 | **不需要**。SQLite 单文件随产物走 |

## 构建

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm -r build
pnpm db:migrate        # 建表，可重复执行
```

`pnpm -r build` 产出：

- `apps/web/dist` —— 静态文件
- `apps/api/dist` —— API
- `apps/collab/dist` —— 协同服务

## 环境变量（生产）

```bash
NODE_ENV=production

# ---- api ----
PORT=3000
HOST=127.0.0.1          # 只在反向代理后面监听，不直接暴露
DB_PATH=/data/weshare.db
SECURE_COOKIE=true      # https 必须为 true，否则会话 Cookie 无 __Host- 前缀
ALLOW_REGISTER=false    # 生产关掉公开注册，账号由管理员创建
SESSION_TTL_DAYS=30

# ---- collab ----
PORT=3100               # 注意：api 与 collab 的 PORT 不能相同
HOST=127.0.0.1
ALLOWED_ORIGINS=https://doc.example.com   # **必须配**，留空一律拒绝连接
STORE_DEBOUNCE_MS=1200
STORE_MAX_DEBOUNCE_MS=8000
```

三个容易翻车的点：

1. **`SECURE_COOKIE=true` 且走 https。** 否则 Cookie 没有 `__Host-` 前缀，子域可能覆盖会话。
2. **`ALLOWED_ORIGINS` 必须显式写站点地址。** 留空 = 拒绝所有协同连接（fail-closed）。这是刻意的：Cookie 鉴权的 WebSocket 不受同源策略保护，放行任意 Origin 等于开门揖盗。
3. **`ALLOW_REGISTER=false`。** 内网部署也不该让任何能访问端口的人自己注册进来。

## 反向代理

nginx 关键配置（省略 TLS 细节）：

```nginx
server {
    listen 443 ssl;
    server_name doc.example.com;

    # 静态文件
    root /opt/weshare/apps/web/dist;
    index index.html;

    # SPA 路由：没有匹配到文件就交给 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 长缓存（文件名带 content hash，可放心设一年）
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 协同（WebSocket）—— 这段不能漏
    location /collab {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # 协同连接是长连接，超时要放宽
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_set_header Host $host;
    }
}
```

**`Upgrade` / `Connection` 两个头漏一个，协同就永远连不上**，表现是"页面能打开、能编辑、但别人看不到我改的"。排查时先看这条。

## 进程管理

两个选择，都不用 Docker。

### systemd（推荐）

`/etc/systemd/system/weshare-api.service`：

```ini
[Unit]
Description=weShare API
After=network.target

[Service]
Type=simple
User=weshare
WorkingDirectory=/opt/weshare
EnvironmentFile=/etc/weshare.env
ExecStart=/usr/bin/node apps/api/dist/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

collab 服务同理，只改 `Description` 与 `ExecStart`（`apps/collab/dist/server.js`）。

`Restart=always` 很重要：协同服务的优雅关闭会 flush 落库，进程崩了靠客户端重连 + 数据库里已落的那部分恢复。

### pm2

```bash
pm2 start apps/api/dist/server.js --name weshare-api
pm2 start apps/collab/dist/server.js --name weshare-collab
pm2 save
```

## 创建账号

生产环境关闭了公开注册，账号由管理员建。用 seed 脚本或直接调接口：

```bash
# seed 脚本会建一个管理员账号（邮箱与密码见脚本内的环境变量）
pnpm db:seed
```

**seed 的账号密码只能用于首次登录**，登录后立刻改掉。`.env` 与任何含密码的文件都不该进版本库（`scripts/guards/check-sensitive-files.mjs` 会在 CI 里拦）。

同事的账号：

1. 让同事自己注册（临时把 `ALLOW_REGISTER=true`，注册完改回来），或
2. 调 `POST /api/v1/auth/register` 由管理员代建。

之后在空间设置页按邮箱把同事加进空间，指定角色（管理员 / 成员 / 只读）。

## 备份

要备份的只有两样：**`weshare.db` 与 `uploads/`**。

```bash
# SQLite 在线备份（不要直接 cp 正在写的库文件）
sqlite3 /data/weshare.db ".backup '/backup/weshare-$(date +%F).db'"
tar czf /backup/uploads-$(date +%F).tar.gz /data/uploads
```

直接 `cp` 一个正在写入的 SQLite 文件可能拷到半张表。用 `.backup` 或 `VACUUM INTO`。

`yjs_state` 是正文事实源，`content_json` 是可重建的镜像——备份时不需要区别对待，它们在同一个文件里。

## 同事试用流程

给同事的三句话版：

1. 打开 `https://doc.example.com`，用我给你建的账号登录。
2. 左上角选空间，左侧目录树里建文档或文件夹。
3. 两个人同时打开同一篇文档，能互相看到光标和输入——这就是协同生效了。

试用时值得主动验证的几件事（也是 1.0 的验收项）：

| 验证点 | 怎么做 | 期望 |
|---|---|---|
| 内容不丢 | 输入后等状态变"已保存"，强杀浏览器，重开 | 内容与最后一次保存一致 |
| 实时协同 | 两个浏览器打开同一文档，各自输入 | 100ms 级互见，光标带名字与颜色 |
| 断线恢复 | 断网 30 秒期间持续输入，恢复网络 | 自动收敛，无冲突弹窗，无内容丢失 |
| 权限不破 | 用只读账号打开同一文档 | 编辑器不可输入，工具栏禁用 |
| 越权不可见 | 用另一个空间的账号访问文档 URL | 404（不是 403，避免探测） |
| 回收站 | 删文档 → 回收站 → 还原 / 永久删除 | 还原回到原位；永久删除要手打标题确认 |
| 会话过期 | 登出后用旧页面点操作 | 跳回登录页，不泄露内容 |

## 已知边界（部署前必读）

这些是明示的限制，不是"还没做完"：

1. **关闭页面可能丢最后 1.2 秒的输入。** 单机模式下自动保存有 1.2s 防抖窗口；协同模式下由服务端的落库节流决定。`beforeunload` 里的异步请求不可靠，所以不承诺"关页面 0 丢失"。
2. **SQLite 单写者。** 单机部署完全够用（几十人团队），但不适合多机集群。切 PostgreSQL 的路径已留好（`packages/db` 是唯一出口，业务层不碰驱动），触发条件是并发写入明显排队。
3. **单进程协同。** 多进程部署时，同一文档的连接必须落在同一进程；目前没有做 sticky session 或 Redis 转发。单机部署不受影响。
4. **正文协同粒度是 ProseMirror 节点级**（由 y-prosemirror 决定），不是字符级 diff。行为与主流协同编辑器一致。
5. **没有公开分享链接、没有 SSO/LDAP、没有 Office 导入导出。** 见 README 的"不是什么"。

## 排障速查

| 现象 | 先看这里 |
|---|---|
| 页面能打开但登录 401 | `SECURE_COOKIE` 与实际协议是否一致；反向代理有没有透传 `X-Forwarded-Proto` |
| 协同连不上，状态显示"已断线" | `ALLOWED_ORIGINS` 是否包含真实站点地址（含 `https://`）；nginx 的 `Upgrade`/`Connection` 头 |
| 协同连上但互相看不到 | 两人是否落在同一 collab 进程；浏览器控制台有没有 4403/4404 |
| 编辑后刷新内容没了 | `GET /nodes/:id/content` 的 `collabEnabled`；collab 日志里的"协同落库失败" |
| 恢复旧文档时内容重复 | 迁移桥的并发保护（见 `apps/collab/test/persistence.test.ts`） |
| 频繁 `SQLITE_BUSY` | 是否多进程同时写同一库；`busy_timeout` 与 WAL 是否生效 |
