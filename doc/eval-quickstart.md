# IdeaMesh 本地试用指南（销售/评估版）

> 目标：拿到这份发布包之后，**15 分钟**在自己机器上跑起一套完整 IdeaMesh，重点验证 **LLM 私聊 / Bot / 自建模型接入** 这条路径。其他模块（推送、附件 R2、邮件、Passkey 多设备）不是本次评估核心，可以全部跳过。

---

## 1. 包里有什么

解压发布包 `polar-vX.Y.Z-<os>-<arch>.tar.gz` 之后：

```text
<os>_<arch>/
├── dock_<arch>_<os>            # 后端二进制（Go，单文件）
├── ui/                         # 前端静态资源 + Express 代理服务
│   ├── server.js
│   └── dist/                   # 已构建的 UI（ts → js）
├── scripts/
│   ├── db_init.sql             # 初次建库 SQL
│   ├── migrate_db_to_ideamesh.sh  # 老库迁移（可忽略）
│   └── eval_start.sh           # 一键启动脚本
├── doc/
│   ├── eval-quickstart.md      # 本文件
│   └── deploy-local.md         # 完整部署文档
├── README.md
└── LICENSE
```

## 2. 装两个依赖（一次）

| 组件 | 作用 | macOS 安装 | Linux 安装 |
| --- | --- | --- | --- |
| PostgreSQL 14+ | 主数据库 | `brew install postgresql@17 && brew services start postgresql@17` | `apt install postgresql` |
| Redis 6+ | 会话/限流 | `brew install redis && brew services start redis` | `apt install redis-server` |
| Node.js 18+ | UI 服务（已存在跳过） | `brew install node` | `apt install nodejs npm` |

> 用 [Postgres.app](https://postgresapp.com/) 也行，启动它就行，无需 brew。脚本会自动找 `psql`。

## 3. 一键启动

进入解压目录：

```bash
./scripts/eval_start.sh
```

脚本会按顺序：

1. 检查 Postgres / Redis 是否在跑
2. 没有 `ideamesh` 库就用 `db_init.sql` 创建（库名/用户名都叫 `ideamesh`，密码 `test123456`）
3. 启动后端二进制（`:8080`）
4. 在 `ui/` 里 `npm install --omit=dev`（首次）→ 启动 UI 服务（`:3000`）
5. 打印 `http://localhost:3000`

按 `Ctrl+C` 同时停掉两个进程。

## 4. 注册 → 体验 LLM

1. 浏览器打开 `http://localhost:3000`
2. 注册一个账号，登录（**第一个注册账号自动是 admin**）
3. 在左侧侧栏进入 **Bots / 管理后台 → LLM 配置**：
   - 配置一个全局或私有 LLM
   - **自建模型**：填你内网或本机的 OpenAI 兼容地址，例如：
     - `Base URL`：`http://your-llm-host:8000/v1/chat/completions`
     - `Model`：`qwen2.5-72b-instruct`（或你部署的模型 ID）
     - `API Key`：随便填一个非空字符串（自建无校验时）
   - **官方模型**：直接填 `https://api.openai.com/v1/chat/completions` + `gpt-4.1-mini` + 真实 key
   - **Anthropic**：填 `https://api.anthropic.com/v1/messages`，自动识别协议
   - **Gemini**：填 `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent`
   - **xAI**：填 `https://api.x.ai/v1/responses`
4. 创建/打开 **私聊**，选择 Bot 用户，发消息
5. 收到回复后，气泡顶部元信息会显示：

   ```
   gpt-4.1-mini · 14:32 · 1.83s
   ```

   `1.83s` 即本次 LLM 实测端到端耗时，可用于横评不同后端：本机 vLLM / Ollama / OpenAI / Claude / 自建 GPU 集群。

## 5. 关键卖点（和销售对话时可以强调）

- **多协议自动识别**：一个聊天界面，OpenAI / Anthropic / Gemini / xAI 兼容协议都能直连，自建 OpenAI-Compatible 服务（vLLM、Ollama、SGLang、TensorRT-LLM）零适配。
- **实测延迟可视**：每条 AI 回复带耗时；切换 Bot/模型/Base URL 即可对比，不用单独写测试脚本。
- **180s 长超时**：本地大模型推理慢也跑得通。
- **完全本地**：DB / Redis / 文件 / 推理服务都在自己机器/内网里，离线也能演示。
- **聊天即知识库**：AI 回复自动落库为 Markdown 文档，可二次编辑、分享、检索。

## 6. 想体验更多

| 功能 | 怎么开 |
| --- | --- |
| Bot 用户 | 管理后台 → Bots → 新建 Bot，配置自己的 LLM 凭据，与人 1:1 私聊 |
| Markdown 工作台 | 左侧栏 Markdown，自带 Tiptap 富文本和源码模式 |
| 登录历史/IP 定位 | 个人页 → 登录记录（GeoLite2 数据库可选） |
| 聊天附件 | 直接拖文件进对话框 |
| Passkey | 个人设置 → 绑定 Passkey（macOS 用 Touch ID） |

不感兴趣的可以全部跳过，不影响核心评估。

## 7. 常见问题

| 现象 | 解决 |
| --- | --- |
| `eval_start.sh` 提示 `psql not found` | 装 Postgres，或者加 `PG_BIN=/Applications/Postgres.app/Contents/Versions/latest/bin ./scripts/eval_start.sh` |
| `Connection refused localhost:6379` | Redis 没启动，`brew services start redis` 或 `redis-server &` |
| AI 回复转圈 / 报错 | 后端日志看 `ai agent request:` 和 `ai agent response:`，先确认 Base URL 真能 curl 通 |
| 端口 3000/8080 被占 | `PORT=3001 API_BASE=http://localhost:8081 ...`；或者 `kill $(lsof -ti :3000)` |
| 想换数据库 | 改环境变量 `POSTGRES_DSN='postgres://用户:密码@主机:端口/库?sslmode=disable'` 后重启 |

完整运维细节（HTTPS、Cloudflare R2、Apple 推送、SMTP、生产部署）见 `doc/deploy-local.md`。

---

**想清理**：

```bash
psql -d postgres -c 'DROP DATABASE ideamesh;'
psql -d postgres -c 'DROP ROLE ideamesh;'
rm -rf data/  # 上传的文件 / Markdown
```

至此本机所有 IdeaMesh 数据清除。
