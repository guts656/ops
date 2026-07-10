# 运维平台迁移说明

> 本文档保留为历史/手工迁移参考。当前推荐的 Linux / Docker 部署流程请优先查看 [`LINUX_DEPLOYMENT.md`](./LINUX_DEPLOYMENT.md)。

本文档用于将 `ops-platform` 运维平台从当前机器迁移到新服务器或新目录。适用于开发环境迁移、测试环境迁移、以及小规模生产部署迁移。

## 1. 项目概览

项目目录：

```text
D:\multica_workspaces\ops-platform
```

技术栈：

- 前端：React + Vite + Ant Design + TailwindCSS
- 后端：Node.js + Express + Socket.IO
- 数据库：PostgreSQL
- ORM：Prisma
- 远程执行能力：SSH / WinRM
- Agent/主机能力：主机纳管、指标 Pull、服务事件、批处理任务、自愈规则等

主要启动端口：

| 服务 | 默认端口 | 说明 |
|---|---:|---|
| 前端 Vite | `5173` | 开发环境访问入口 |
| 后端 API | `3001` | API、Socket.IO、健康检查 |
| PostgreSQL | `5432` | 数据库端口，按实际环境配置 |

健康检查地址：

```text
GET http://<后端地址>:3001/health/live
GET http://<后端地址>:3001/health/ready
GET http://<后端地址>:3001/api/health
```

## 2. 迁移前准备

### 2.1 确认新环境依赖

新服务器需要安装：

- Node.js，建议使用当前 LTS 版本
- npm
- PostgreSQL 客户端工具，例如 `pg_dump`、`psql`、`pg_restore`
- 可访问 PostgreSQL 数据库
- 如需远程主机控制：
  - Linux 目标主机需要 SSH 可达
  - Windows 目标主机需要 WinRM 可达

检查命令：

```bash
node -v
npm -v
psql --version
```

### 2.2 停止旧环境写入

迁移正式开始前，建议先停止旧环境的后端服务，避免迁移过程中继续写入数据库。

如果旧环境是开发方式启动的：

```bash
# 停止 npm run dev:full / npm run dev:server 对应进程
```

如果后续使用 PM2、systemd、Windows 服务等方式托管，则按对应方式停止。

## 3. 需要迁移的内容

### 3.1 必须迁移

| 内容 | 说明 |
|---|---|
| 项目源码 | `ops-platform` 整个项目目录，排除 `node_modules` 和 `dist` 也可以 |
| `.env` | 环境变量文件，包含数据库连接、JWT 密钥等敏感配置 |
| PostgreSQL 数据库 | 平台账号、主机、告警、自愈、审计、Agent Job 等核心数据 |
| `prisma/migrations` | 数据库迁移历史，必须保留 |
| `package.json` / `package-lock.json` | 依赖版本锁定 |

### 3.2 按需迁移

| 内容 | 说明 |
|---|---|
| `storage/` | 健康报告等本地生成文件；如果目录存在，应一并迁移 |
| 日志文件 | 如果你额外配置了本地日志目录，需要迁移或归档 |
| 运行脚本 | 如 PM2 配置、systemd unit、Nginx 配置等 |

### 3.3 不建议直接迁移

| 内容 | 说明 |
|---|---|
| `node_modules/` | 建议在新环境重新 `npm install` |
| `dist/` | 建议在新环境重新 `npm run build` |
| `.env~` | 备份文件，迁移前检查是否含旧密码或过期配置 |

## 4. 备份旧数据库

在旧环境或能访问旧数据库的机器上执行。

示例：

```bash
pg_dump "postgresql://ops_platform:<旧密码>@<旧数据库IP>:5432/ops_platform?schema=public" \
  --format=custom \
  --file=ops_platform_backup.dump
```

如果习惯 SQL 文本格式，也可以：

```bash
pg_dump "postgresql://ops_platform:<旧密码>@<旧数据库IP>:5432/ops_platform?schema=public" \
  --file=ops_platform_backup.sql
```

建议同时记录：

```bash
npx prisma migrate status
```

确认旧库当前迁移状态。

## 5. 迁移项目文件

可以用压缩包、文件共享、rsync、scp 等方式复制项目。

推荐复制内容：

```text
ops-platform/
├─ prisma/
├─ server/
├─ src/
├─ public/
├─ package.json
├─ package-lock.json
├─ prisma.config.ts
├─ vite.config.js
├─ eslint.config.js
├─ tsconfig.json
├─ .env.example
└─ .env                # 注意：包含敏感信息，单独安全传输
```

不需要复制：

```text
node_modules/
dist/
```

## 6. 配置新环境 `.env`

在新服务器项目根目录创建 `.env`。

可从 `.env.example` 复制：

```bash
cp .env.example .env
```

然后修改关键配置。

当前项目至少需要：

```env
PORT=3001
DATABASE_URL="postgresql://ops_platform:<新密码>@<新数据库IP>:5432/ops_platform?schema=public"
JWT_SECRET=<请使用长随机字符串>
JWT_EXPIRES_IN=2h
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=<初始化管理员密码>
INITIAL_ADMIN_DISPLAY_NAME=平台管理员
OPS_AGENT_PUBLIC_URL=http://<新后端可被Agent访问的地址>:3001
OPS_AGENT_METRICS_INTERVAL_SECONDS=60
OPS_AGENT_METRICS_RETENTION_POINTS=288
OPS_AGENT_TOKEN_PEPPER=<请使用长随机字符串>
```

建议额外显式配置：

```env
CREDENTIAL_ENCRYPTION_KEY=<请使用长随机字符串，迁移旧库时必须与旧环境保持一致>
SELF_HEALING_EVALUATOR_INTERVAL_MS=30000
LOG_MONITOR_EVALUATOR_INTERVAL_MS=30000
CGI_MONITOR_EVALUATOR_INTERVAL_MS=30000
HEALTH_REPORT_SCHEDULER_ENABLED=true
```

### 重要：凭据加密密钥

平台会保存主机 Pull 凭据、SSH/WinRM 凭据等敏感信息。代码中凭据解密使用：

```text
CREDENTIAL_ENCRYPTION_KEY || JWT_SECRET
```

因此：

- 如果旧环境设置过 `CREDENTIAL_ENCRYPTION_KEY`，新环境必须保持一致。
- 如果旧环境没有设置 `CREDENTIAL_ENCRYPTION_KEY`，但使用了 `JWT_SECRET` 作为加密来源，则新环境的 `JWT_SECRET` 必须保持一致，否则历史保存的主机凭据无法解密。
- 如果不迁移旧凭据，而是迁移后重新录入主机凭据，则可以更换密钥。

## 7. 恢复数据库

### 7.1 创建数据库和账号

在新 PostgreSQL 上创建数据库和用户，示例：

```sql
CREATE USER ops_platform WITH PASSWORD '<新密码>';
CREATE DATABASE ops_platform OWNER ops_platform;
GRANT ALL PRIVILEGES ON DATABASE ops_platform TO ops_platform;
```

### 7.2 恢复 dump

如果使用 custom 格式：

```bash
pg_restore \
  --dbname="postgresql://ops_platform:<新密码>@<新数据库IP>:5432/ops_platform?schema=public" \
  --clean \
  --if-exists \
  ops_platform_backup.dump
```

如果使用 SQL 文本：

```bash
psql "postgresql://ops_platform:<新密码>@<新数据库IP>:5432/ops_platform?schema=public" \
  --file=ops_platform_backup.sql
```

## 8. 安装依赖与生成 Prisma Client

进入项目目录：

```bash
cd /path/to/ops-platform
```

安装依赖：

```bash
npm install
```

生成 Prisma Client：

```bash
npm run db:generate
```

检查迁移状态：

```bash
npx prisma migrate status
```

应用尚未应用的迁移：

```bash
npm run db:deploy
```

等价命令：

```bash
npx prisma migrate deploy
```

> 注意：已有数据库环境建议使用 `migrate deploy`。`migrate dev` 会使用 shadow database 重放迁移，旧迁移不完全幂等时可能失败。

如果是全新空库并需要初始化演示数据/管理员账号：

```bash
npm run db:seed
```

如果是从旧库恢复，不要随意 seed，避免混入演示数据。

## 9. 构建和启动

### 9.1 开发方式启动

适合本地验证：

```bash
npm run dev:full
```

访问：

```text
http://localhost:5173/
```

后端：

```text
http://localhost:3001
```

### 9.2 分开启动前后端

后端：

```bash
npm run start:server
```

前端开发服务：

```bash
npm run dev
```

### 9.3 生产构建

构建前端：

```bash
npm run build
```

生成目录：

```text
dist/
```

当前后端 `server/index.ts` 没有直接托管 `dist/` 静态文件。因此生产部署建议二选一：

1. 使用 Nginx / Caddy / IIS 托管 `dist/`，并把 `/api` 和 Socket.IO 请求反向代理到后端 `3001`。
2. 使用 `npm run preview` 临时预览前端，同时单独运行后端。

生产推荐反向代理结构：

```text
用户浏览器
  -> Nginx/Caddy/IIS :80/:443
      -> /              静态文件 dist/
      -> /api           http://127.0.0.1:3001/api
      -> /socket.io     http://127.0.0.1:3001/socket.io
```

后端启动：

```bash
npm run start:server
```

## 10. Nginx 反向代理示例

示例，仅供参考：

```nginx
server {
    listen 80;
    server_name ops.example.com;

    root /opt/ops-platform/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

## 11. 迁移后验证清单

### 11.1 后端健康检查

```bash
curl http://localhost:3001/health/live
curl http://localhost:3001/health/ready
curl http://localhost:3001/api/health
```

期望：

```json
{"status":"alive"}
{"ready":true,"status":"healthy"}
{"ok":true,"status":"healthy"}
```

### 11.2 前端访问

打开：

```text
http://<新前端地址>/
```

检查：

- 登录页可打开
- 管理员账号可登录
- 仪表盘可加载
- 主机列表可加载
- 告警、自愈、审计页面可加载

### 11.3 数据完整性检查

重点检查：

- 账号和权限
- 主机列表
- 主机 Pull 凭据状态
- Agent Job 历史
- 告警记录
- 自愈规则
- 自愈执行历史
- 审计日志
- 慢查询记录
- 批处理任务
- 健康报告

### 11.4 自愈规则检查

本项目已支持自愈规则安全模式和受控执行模式。

迁移后建议检查：

- 已有规则默认是否仍为安全模式
- `受控执行` 规则是否确实需要开启
- 主机 Pull 凭据是否可解密、可连接
- Linux 目标服务是否为 systemd 服务
- Windows 目标服务是否可通过 WinRM 控制
- 主机维护状态是否正确

手动评估规则时注意：

- 安全模式只写执行历史，不真实执行服务命令。
- 受控执行模式会真实执行服务启动/重启。
- 受控执行只支持 `启动服务`、`重启服务`。
- 脚本、扩缩容、任意命令不会自动执行。

## 12. Agent 与远程主机迁移注意事项

如果平台迁移后后端地址变化，必须更新：

```env
OPS_AGENT_PUBLIC_URL=http://<新后端地址>:3001
```

否则新安装或重装 Agent 时，远端主机可能仍回连旧地址。

对于已经安装的 Agent：

- 如果 Agent 配置里写死旧后端地址，需要重新安装或修复配置。
- 主机自动 Pull 使用平台保存的 Pull 凭据；迁移后需要确认凭据可解密。
- Windows 主机 WinRM 需确认网络、防火墙、认证方式仍可用。
- Linux 主机 SSH 需确认端口、账号、密钥/密码仍可用。

## 13. Webhook 和外部系统回调

平台有 webhook 路由：

```text
/api/webhooks
```

迁移后需要检查所有外部系统：

- 告警平台
- 监控系统
- 内部系统回调
- 企业微信/钉钉通知配置

如果域名或 IP 改变，需要同步修改这些系统里的回调地址。

Webhook token 相关环境变量可能包括：

```env
GENERIC_WEBHOOK_TOKEN=<token>
<来源>_WEBHOOK_TOKEN=<token>
```

迁移时应保持 token 一致，或者同步更新调用方。

## 14. 常见问题

### 14.1 `npx prisma migrate dev` 报 shadow database 错误

已有数据库环境不要优先使用 `migrate dev`，建议使用：

```bash
npx prisma migrate deploy
```

本项目历史迁移中存在对旧表的幂等处理，`migrate dev` 在 shadow database 重放时可能因为历史上下文不同而失败。

### 14.2 登录后页面空白或接口 404

检查：

- 前端是否正确代理 `/api`
- 生产环境 Nginx 是否代理 `/api` 到后端 `3001`
- 后端是否启动
- 浏览器开发者工具 Network 中 `/api/health` 是否正常

### 14.3 数据库连接失败

检查：

```bash
psql "$DATABASE_URL" -c "SELECT 1;"
```

并确认：

- 数据库 IP/端口可达
- 用户名密码正确
- 数据库名正确
- PostgreSQL 防火墙/白名单允许新服务器访问

### 14.4 主机凭据无法使用

重点检查：

- `CREDENTIAL_ENCRYPTION_KEY` 是否与旧环境一致
- 如果旧环境未设置该变量，则 `JWT_SECRET` 是否与旧环境一致
- Pull 凭据是否启用
- Windows 是否使用密码认证

### 14.5 自愈受控执行没有真实启动服务

检查：

- 规则是否开启 `受控自动执行`
- 规则动作是否为 `启动服务` 或 `重启服务`
- 服务目标是否唯一
- 主机是否处于维护状态
- Pull 凭据是否启用且可连接
- 执行历史里的 `Agent Job ID`
- 主机任务日志里的 stdout/stderr

## 15. 回滚方案

### 15.1 应用层回滚

如果新版本启动异常：

1. 停止新后端和前端服务。
2. 切回旧代码目录或旧版本压缩包。
3. 恢复旧 `.env`。
4. 执行：

```bash
npm install
npm run db:generate
npm run build
npm run start:server
```

### 15.2 数据库回滚

如果迁移后数据异常，使用迁移前备份恢复：

```bash
pg_restore \
  --dbname="postgresql://ops_platform:<密码>@<数据库IP>:5432/ops_platform?schema=public" \
  --clean \
  --if-exists \
  ops_platform_backup.dump
```

恢复前务必停止应用写入。

### 15.3 自愈执行风险回滚

如果担心迁移后自愈规则误执行，可以先在数据库中批量关闭受控执行：

```sql
UPDATE self_healing_rules
SET auto_execute = false,
    execution_mode = 'safe';
```

这样所有自愈规则都会回到安全模式，只记录计划动作，不执行远程服务命令。

## 16. 最小迁移流程摘要

如果只要最短可执行流程：

```bash
# 1. 旧库备份
pg_dump "postgresql://ops_platform:<旧密码>@<旧库>:5432/ops_platform?schema=public" --format=custom --file=ops_platform_backup.dump

# 2. 复制项目到新服务器
# 排除 node_modules 和 dist，保留 prisma/server/src/package-lock.json/.env 等

# 3. 新库恢复
pg_restore --dbname="postgresql://ops_platform:<新密码>@<新库>:5432/ops_platform?schema=public" --clean --if-exists ops_platform_backup.dump

# 4. 新环境安装依赖
cd /path/to/ops-platform
npm install

# 5. 配置 .env
# 修改 DATABASE_URL、JWT_SECRET、CREDENTIAL_ENCRYPTION_KEY、OPS_AGENT_PUBLIC_URL 等

# 6. 应用迁移并生成 Prisma Client
npm run db:deploy
npm run db:generate

# 7. 构建与启动
npm run build
npm run start:server

# 8. 健康检查
curl http://localhost:3001/health/ready
```

## 17. 建议迁移窗口

建议按以下顺序执行：

1. 新环境预安装 Node.js、PostgreSQL 客户端。
2. 新建数据库和账号。
3. 复制项目文件和 `.env` 模板。
4. 停止旧服务写入。
5. 备份旧数据库。
6. 恢复到新数据库。
7. 修改新环境 `.env`。
8. 执行 `npm install`、`npm run db:deploy`、`npm run db:generate`、`npm run build`。
9. 启动后端和前端代理。
10. 做健康检查和页面验证。
11. 修改域名/DNS/反向代理指向新环境。
12. 观察自愈、告警、Agent Pull、Webhook 是否正常。
13. 保留旧环境只读一段时间，确认无误后下线。
