# Ops Platform 运维平台

Ops Platform 是一套面向中小型运维场景的统一运维平台，提供主机纳管、Agent 采集、日志查询与监控、告警处理、自愈规则、批处理任务、健康报告、账号权限和审计能力。

## 技术栈

- 前端：React + Vite + Ant Design + Tailwind CSS
- 后端：Node.js + Express + Socket.IO
- 数据库：PostgreSQL + Prisma
- 部署：Docker / Docker Compose + Nginx
- 主机能力：Linux SSH、Windows WinRM、平台 Agent

## 功能模块

- **仪表盘**：主机、告警、日志、任务等核心指标概览。
- **主机管理**：Linux / Windows 主机纳管、资源指标、Agent 状态、服务与容器信息。
- **Agent 采集**：采集 CPU、内存、磁盘、服务事件、容器和日志数据。
- **日志查询与监控**：集中查询日志，配置日志采集和关键字规则。
- **告警中心**：告警接入、降噪、处理规则和闭环记录。
- **自愈规则**：将监控规则与自动化动作绑定，实现常见故障自动处理。
- **批处理任务**：上传、审批、执行和追踪批量任务。
- **健康报告**：周期性生成系统健康报告。
- **账号权限与审计**：角色权限、操作审计和主机审计链。

## 目录结构

```text
ops-platform/
├── src/                  # React 前端
├── server/               # Express API、业务逻辑、Agent 接口
├── prisma/               # Prisma schema 和数据库迁移
├── public/               # 前端静态资源
├── deploy/               # Nginx 和生产环境示例配置
├── compose.yaml          # Docker Compose 部署编排
├── Dockerfile            # API 和 Web 多阶段镜像构建
├── .env.example          # 本地开发环境变量模板
└── LINUX_DEPLOYMENT.md   # Linux / Docker 部署说明
```

## 本地开发

### 1. 准备环境

建议版本：

- Node.js 22+
- npm 10+
- PostgreSQL 14+

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制模板：

```bash
cp .env.example .env
```

至少配置：

- `DATABASE_URL`
- `JWT_SECRET`
- `OPS_AGENT_TOKEN_PEPPER`
- `CREDENTIAL_ENCRYPTION_KEY`
- `INITIAL_ADMIN_PASSWORD`

生产或共享环境不要使用模板里的占位值。

### 4. 初始化数据库

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

如果是部署环境，通常使用：

```bash
npm run db:deploy
```

### 5. 启动开发服务

```bash
npm run dev:full
```

默认访问：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`
- 健康检查：`http://localhost:3001/api/health`

## 构建与检查

```bash
npm run build
npm run lint
```

## 一键全新安装

可以在一台已安装 Docker 的 Linux 服务器上执行：

```bash
chmod +x scripts/install-fresh.sh
./scripts/install-fresh.sh
```

脚本会生成 `.env.production`、启动 PostgreSQL/API/Web 容器、执行数据库迁移，并创建初始管理员账号。默认 `SEED_DEMO_DATA=false`，只初始化权限和管理员，不导入演示主机/告警/日志。

## Docker 部署

生产部署请参考：

- [LINUX_DEPLOYMENT.md](./LINUX_DEPLOYMENT.md)

当前 Docker Compose 包含：

- `ops-platform-api`：Node.js API / Socket.IO，默认端口 `3001`
- `ops-platform-web`：Nginx 前端和反向代理，默认宿主机端口 `18080`

## Agent 回连地址说明

新增主机安装 Agent 时，后端会优先使用平台服务器的非内部网卡 IPv4 地址加 `PORT` 生成回连地址，例如：

```text
http://<server-ip>:3001
```

`OPS_AGENT_PUBLIC_URL` 仅用于自动识别地址不可达、或必须走反向代理/公网地址时的备用配置。不要在代码中硬编码旧的候选 IP。

## GitHub 上传前安全清单



提交前建议检查：

```bash
git status --short --ignored
git diff --cached --name-only
git diff --cached --stat
```

如任何真实密钥曾经进入 Git 历史，应立即轮换对应密钥。
