# 运维平台 Linux / Docker 部署说明

本文档说明如何在 Linux 服务器上使用 Docker 部署 Ops Platform。

当前测试机约定：

- 服务器：`172.29.25.200`
- SSH：`ssh -i ~/.ssh/ai_ubuntu_key ai-agent@172.29.25.200`
- 部署目录：`/data/ops-platform`
- Compose 命令：当前服务器使用旧版 `docker-compose` 1.25.0，不是 `docker compose` 插件。

> 如果部署到其他服务器，请把下文 IP、目录和端口替换为实际环境。

## 部署结构

- `ops-platform-api`：Node.js API / Socket.IO，宿主机端口 `3001`。
- `ops-platform-web`：Nginx，默认映射宿主机 `18080`，提供前端静态文件并反代 API。
- PostgreSQL：由 `DATABASE_URL` 指定，可在宿主机、独立数据库服务器或同网络容器中。
- 批量任务文件：持久化到部署目录下的 `storage/batch-files`。

## 重要注意事项

1. 不要上传本地 `node_modules`、`dist`、`.env`、日志、截图和运行数据。
2. `.env.production` 只放在服务器上，不要提交到 GitHub。
3. `JWT_SECRET`、`OPS_AGENT_TOKEN_PEPPER`、`CREDENTIAL_ENCRYPTION_KEY` 必须使用 32 位以上强随机值。
4. 如果已有保存的主机凭据或 Agent token，不要随意更换 `CREDENTIAL_ENCRYPTION_KEY` / `OPS_AGENT_TOKEN_PEPPER`；确需轮换时先配置 legacy 环境变量并验证历史数据可用。
5. API 建议只运行 1 个副本，避免定时任务重复执行。

## 首次部署前检查

```bash
ssh -i ~/.ssh/ai_ubuntu_key ai-agent@172.29.25.200
hostname
id
docker version
docker-compose version
ss -ltnp | grep -E ':80 |:3001 |:5432 |:18080 '
```

## 服务器目录

```bash
mkdir -p /data/ops-platform/storage/batch-files /data/ops-platform/backups
cd /data/ops-platform
```

将项目源码同步到 `/data/ops-platform`，不要同步本地 `.env`、`node_modules`、`dist` 和运行产物。

## 一键全新安装（无历史数据）

如果是全新服务器、不需要导入历史数据库，可以使用内置脚本：

```bash
cd /data/ops-platform
chmod +x scripts/install-fresh.sh
./scripts/install-fresh.sh
```

脚本会：

- 生成 `.env.production`，并自动生成 PostgreSQL、JWT、Agent、凭据加密等随机密钥。
- 通过 `compose.yaml` + `compose.fresh.yaml` 启动 PostgreSQL、API 和 Web。
- 执行 Prisma 数据库迁移。
- 创建初始管理员账号。
- 默认设置 `SEED_DEMO_DATA=false`，只初始化权限和管理员，不导入演示主机、告警、日志和自愈规则。

如果需要演示数据，可安装后把 `.env.production` 中 `SEED_DEMO_DATA=true`，再执行：

```bash
docker-compose -f compose.yaml -f compose.fresh.yaml exec api npm run db:seed
```

## 生产环境变量

复制模板：

```bash
cp deploy/env.production.example .env.production
chmod 600 .env.production
```

必须配置：

- `DATABASE_URL`
- `CORS_ORIGINS`
- `JWT_SECRET`
- `OPS_AGENT_TOKEN_PEPPER`
- `CREDENTIAL_ENCRYPTION_KEY`
- `INITIAL_ADMIN_PASSWORD`

示例：

```env
NODE_ENV=production
PORT=3001
DATABASE_URL="postgresql://ops_platform:<db-password>@127.0.0.1:5432/ops_platform?schema=public"
WEB_PORT=18080
CORS_ORIGINS=http://172.29.25.200:18080
JWT_SECRET=<replace-with-at-least-32-random-characters>
OPS_AGENT_TOKEN_PEPPER=<replace-with-at-least-32-random-characters>
CREDENTIAL_ENCRYPTION_KEY=<replace-with-at-least-32-random-characters>
```

### Agent 回连地址

新增主机安装 Agent 时，后端默认优先使用 `OPS_AGENT_PUBLIC_URL`。如果未配置，才会使用平台服务器的非内部网卡 IPv4 加 `PORT`，例如：

```text
http://172.29.25.200:3001
```

当前测试环境外部入口走 Nginx `18080`，而 `3001` 不一定对被纳管主机开放，因此建议显式配置：

```env
OPS_AGENT_PUBLIC_URL=http://172.29.25.200:18080
```

不要在代码中重新加入旧的硬编码候选 IP。

## 数据库备份

部署或升级前先备份数据库。

如果宿主机有 `pg_dump`：

```bash
pg_dump -Fc --no-owner --no-acl -d ops_platform -f /data/ops-platform/backups/ops_platform_before_deploy.dump
```

如果 PostgreSQL 在 Docker 容器里：

```bash
docker exec <postgres-container> pg_dump -U ops_platform -Fc --no-owner --no-acl ops_platform > /data/ops-platform/backups/ops_platform_before_deploy.dump
```

## 启动或完整重建

```bash
cd /data/ops-platform
docker-compose build
docker-compose up -d --force-recreate
docker-compose ps
```

查看日志：

```bash
docker-compose logs -f api
docker-compose logs -f web
```

## 仅重建 API

后端代码变更时可只重建 API：

```bash
cd /data/ops-platform
docker-compose build api
docker-compose up -d --force-recreate api
docker-compose ps
```

如果服务器无法访问 Docker Hub，构建可能失败。应先恢复镜像源/网络，再重新执行完整构建，避免长期依赖手工 `docker commit`。

## 验证

API 直连：

```bash
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS http://127.0.0.1:3001/health/ready
```

通过 Web/Nginx 端口验证：

```bash
curl -fsS http://127.0.0.1:18080/api/health
```

浏览器访问：

```text
http://172.29.25.200:18080/
```

验证内容：

- 可以登录现有账号。
- 原有用户、主机、告警、日志可见。
- Socket.IO 实时通知无 400/502。
- 批量任务文件目录可写。
- API 日志无生产密钥缺失错误。
- 新增/重装主机 Agent 回连地址使用 `OPS_AGENT_PUBLIC_URL`，测试环境应为 `http://172.29.25.200:18080`。

## 回滚

如果新部署异常，可以先停止新容器：

```bash
cd /data/ops-platform
docker-compose down
```

如果保留了旧镜像 tag，可回滚镜像后重新启动。数据库如被误改，使用部署前 dump 恢复。
