# 本地部署指南

把 IdeaMesh 跑在自己的笔记本或一台局域网机器上，30 分钟内拥有一套完整、私有、可写可改的工作站：账号体系、Markdown 工作台、AI 助理私聊、Latch 代理治理、Passkey 登录、推送、SMTP 邮件。除了 LLM 外不依赖任何第三方 SaaS，数据落在你自己的 PostgreSQL 与磁盘上。

> 适用范围：单人或小团队的自建实例。多机/生产部署见 `doc/deploy-prod.md`（待写）。

## 1. 你将得到什么

- **完整的 Web 应用**：账户、登录历史、IP/地理位置、Passkey、Markdown 创作、聊天与 AI 私聊、Bot、Latch 代理配置面板。
- **API + UI 双进程**：后端 Go (Gin) 监听 `:8080`，前端静态站点 + 代理监听 `:3000`，可独立替换。
- **本地优先的存储链路**：账户与元数据 → PostgreSQL；会话/限流 → Redis；Markdown 正文 → 磁盘；附件 → 磁盘或 R2（可选）。
- **可观测的 LLM 链路**：每条 AI 回复在 UI 元信息里显示模型名 + 实测耗时，方便测自建推理服务的吞吐和延迟。

## 2. 先决条件

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| Go | 1.22+ | 后端编译 |
| Node.js | 18+ | UI 构建 + 静态服务 |
| PostgreSQL | 14+ | 主存储 |
| Redis | 6+ | 会话/限流 |
| GeoLite2-City.mmdb | — | 选填，用于登录地理定位（不放也能跑） |

macOS 一行装齐：

```bash
brew install go node postgresql@16 redis
brew services start postgresql@16
brew services start redis
```

## 3. 初始化数据库

应用默认 DSN：`postgres://ideamesh:test123456@localhost:5432/ideamesh?sslmode=disable`。

**全新部署**：

```bash
psql -d postgres -f scripts/db_init.sql
```

> macOS 用 Postgres.app 的话 `psql` 不一定在 `$PATH`。可以用 `/Applications/Postgres.app/Contents/Versions/latest/bin/psql` 直接调用，或者把这个目录加到 `~/.zshrc` 的 PATH。Homebrew 安装的 `postgresql@17` 已经在 PATH 里。

`db_init.sql` 创建库 `ideamesh`、用户 `ideamesh`、授予所有权限。建表与所有迁移由 Go 进程在启动时通过 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE IF NOT EXISTS` 完成，无需额外迁移工具。

**从老版本（gin_auth/gin_tester）迁移**：

```bash
./scripts/migrate_db_to_ideamesh.sh
```

默认行为：原子地 `ALTER DATABASE` 改名 → 终止旧连接 → 把 `gin_tester` 角色改名为 `ideamesh` → 重设密码、owner、grants。改不动可换 `MODE=dump-restore` 走 pg_dump/pg_restore，原库保留以便对比验证。

脚本会自动从 `$PATH`、Postgres.app（`/Applications/Postgres.app/Contents/Versions/{latest,17,16,...}/bin`）和 Homebrew 路径里找 `psql`/`pg_dump`/`pg_restore`，找不到就 `PG_BIN=/your/path/bin ./scripts/migrate_db_to_ideamesh.sh` 显式指定。

可调环境变量见脚本顶注释（`OLD_DB`/`NEW_DB`/`OLD_USER`/`NEW_USER`/`NEW_USER_PASSWORD`/`PG_HOST`/`PG_PORT`/`MODE`/`RENAME_USER`/`PG_BIN`）。

## 4. 启动后端

```bash
env GOCACHE=/tmp/polar-go-cache go run ./cmd/dock
```

启动后默认监听 `:8080`，所有 API 在 `/api/*`。日志会打印 schema 自动迁移的状态、AI 请求耗时（`ai agent reply ok in Xms`）、Latch 代理同步进度等。

修改默认连接：

```bash
export POSTGRES_DSN='postgres://ideamesh:你的密码@localhost:5432/ideamesh?sslmode=disable'
export REDIS_ADDR='localhost:6379'
go run ./cmd/dock
```

## 5. 启动 UI

```bash
cd ui
npm install     # 首次
npm run build   # 编译 TS → dist + public/scripts
node server.js
```

UI 默认监听 `:3000`，把 `/api/*` 反向代理到后端。开发时改完 `ui/src/*.ts` 重跑 `npm run build`（增量编译几十毫秒）。

打开 `http://localhost:3000` 注册第一个账号，自动成为管理员。

## 6. 选填：AI 助理与 Bot

编辑环境变量启用站内 system 助理（Markdown 写作、文档问答）：

```bash
export AI_AGENT_API_KEY='sk-...'
export AI_AGENT_BASE_URL='https://api.openai.com/v1/chat/completions'
export AI_AGENT_MODEL='gpt-4.1-mini'
export AI_AGENT_SYSTEM_PROMPT='你是站内 system 助理...'
```

支持的协议：OpenAI Chat Completions、Anthropic Messages、Google Gemini generateContent、xAI Responses。`Base URL` 自动识别协议，自建 OpenAI-兼容服务直接填 `http://your-host:port/v1/chat/completions` 即可。

每个 Bot 用户可以在面板里配置自己的 LLM 凭据，不必复用全局 system 凭据。聊天界面会显示 `username · model · 时间 · 耗时`，可直接横评不同后端的延迟（180s 上限超时）。

## 7. 选填：附件存储 → Cloudflare R2

不配 R2 时，聊天附件存到 `data/uploads/`，本机够用。要走 R2：

```bash
export CF_R2_ACCOUNT_ID=...
export CF_R2_ACCESS_KEY_ID=...
export CF_R2_SECRET_ACCESS_KEY=...
export CF_R2_BUCKET=ideamesh-attachments
export CF_R2_PUBLIC_URL=https://pub-xxx.r2.dev
```

五个变量同时存在才会启用 R2，缺任一都自动回退本地。

## 8. 选填：邮件验证 / 推送

- **SMTP**（找回密码、邮箱验证）：`SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `SMTP_FROM_EMAIL` / `SMTP_FROM_NAME`。iCloud 自定义域 + 应用专用密码可直接用。
- **Apple 推送**（iOS 客户端）：`APPLE_PUSH_TEAM_ID` / `APPLE_PUSH_KEY_ID` / `APPLE_PUSH_TOPIC`，`.p8` 文件路径在 `apns_keys/`。Dev/Prod 分别用 `_DEV`/`_PROD` 后缀的环境变量覆盖。

不配置时这两个模块静默跳过，不影响其他功能。

## 9. 选填：登录地理定位

下载 [MaxMind GeoLite2-City](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data) 放到 `data/GeoLite2-City.mmdb`，登录历史里就会显示城市/国家。无文件时只记 IP。

## 10. 健康自检

启动后跑：

```bash
./scripts/test_api.sh        # 注册→登录→拉用户信息→登出
./scripts/test_markdown.sh   # 创建/读取/更新/删除 Markdown
```

两个脚本都用 cookie 跑完整链路，能跑通就代表 DB / Redis / 会话 / 鉴权 / 业务接口都正常。

## 11. 常见坑

| 现象 | 排查 |
| --- | --- |
| 启动报 `pq: password authentication failed` | DSN 用户名密码不对，或刚改了 `ideamesh` 用户密码没同步到环境变量 |
| `pq: database "ideamesh" does not exist` | 跑过 `scripts/db_init.sql` 或 `migrate_db_to_ideamesh.sh` 了吗？ |
| `dial tcp [::1]:6379: connect: connection refused` | Redis 没启动；macOS 上 `brew services start redis` |
| AI 回复一直转圈 | 检查 `AI_AGENT_BASE_URL` 是否带 `/v1/chat/completions`；查后端日志的 `ai agent request:` 行 |
| Passkey 注册失败 | `PASSKEY_RP_ID` 必须等于浏览器看到的域名（无端口，无协议），`PASSKEY_ORIGIN` 必须包含协议和端口 |
| 上传附件 502 | 没配 R2 时检查 `data/uploads/` 是否可写；配了 R2 就看后端日志里 R2 的 sigv4 报错 |

## 12. 升级

发布版：

```bash
./update.sh              # 拉 GitHub release，原地替换二进制
```

源码部署直接 `git pull && go build -o dock ./cmd/dock`。Schema 兼容靠 `IF NOT EXISTS` 的 ALTER 串，向前升级不需要手动迁移。需要回滚时备份 `pg_dump -Fc ideamesh > backup.sqlc` 即可。

## 13. 卸载

```bash
psql -d postgres -c 'DROP DATABASE ideamesh;'
psql -d postgres -c 'DROP ROLE ideamesh;'
rm -rf data/  # Markdown / 上传文件 / 缓存
```

至此与 IdeaMesh 相关的本地数据全部清除。
