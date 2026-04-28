# Latch 服务设计文档

> 版本：v1.0 · 2026-04-09

---

## 一、背景与目标

Latch 是面向移动客户端的代理服务配置管理模块，负责维护代理节点、规则文件和配置组合三类资源，并通过 API 下发给客户端使用。

设计目标：

- **内容可追溯**：每次变更产生不可变的版本快照，支持回滚
- **组合灵活**：Profile 自由组合多个代理节点和一个规则文件
- **权限分层**：管理员维护资源，普通登录用户只消费共享 Profile
- **结构简单**：不引入外部依赖（无 `lib/pq`），保持 schema 轻量

---

## 二、核心概念

### 2.1 三类资源

| 资源 | 英文 | 说明 |
|------|------|------|
| 代理节点 | Proxy | 单个代理的类型 + 连接配置，是最小可用单元 |
| 规则文件 | Rule | 纯文本路由规则，客户端按行解析 |
| 配置组合 | Profile | 将 0-N 个 Proxy 和 0-1 个 Rule 捆绑为一个命名配置下发 |

### 2.2 版本机制（SHA1 内容版本化）

Proxy 和 Rule 都采用同一套版本策略：

```
group_id  →  逻辑资源标识（创建时生成，永不变）
id        →  每个版本的唯一行标识
version   →  从 1 开始的单调递增整数
sha1      →  内容的 SHA1 哈希，用于判断是否真正变更
```

写入规则：

```
创建  →  INSERT，group_id = 新 UUID，version = 1
更新  →  计算新 SHA1
        ├── SHA1 与最新版本相同  →  UPDATE 当前行（仅改名称/类型），不新增版本
        └── SHA1 不同           →  INSERT 新行，version = 当前最大版本 + 1
读取  →  WHERE version = MAX(version) GROUP BY group_id
回滚  →  将目标历史版本的内容 INSERT 为新版本（最大版本 + 1）
```

这套机制保证：
- 历史版本行永不修改或删除（除非整个资源被 DELETE）
- 任意时刻都可以查看完整变更历史
- 回滚本质是"以旧内容重新写入"，不破坏历史链

### 2.3 Profile 与资源的关系

Profile 通过 `proxy_group_ids`（TEXT[]）和 `rule_group_id`（TEXT）持有 Proxy/Rule 的 `group_id` 引用，而不是具体版本的 `id`。

- **读取时**：服务端根据 `group_id` 实时查询各资源的最新版本并组装
- **优点**：Profile 无需关心版本号，代理或规则升级后 Profile 自动使用新版本
- **缺点**：不支持"锁定某个历史版本"。如需此能力，可在将来为 Profile 增加版本快照字段

---

## 三、数据模型

### 3.1 表结构

```sql
-- 代理节点版本表
CREATE TABLE latch_proxies (
    id         TEXT NOT NULL PRIMARY KEY,  -- 版本唯一 ID
    group_id   TEXT NOT NULL,              -- 逻辑资源 ID
    name       TEXT NOT NULL,
    type       TEXT NOT NULL,              -- 代理类型（见下文）
    config     JSONB NOT NULL DEFAULT '{}',-- 类型相关配置
    sha1       TEXT NOT NULL DEFAULT '',   -- config 的 SHA1
    version    INT  NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_latch_proxies_group_version ON latch_proxies(group_id, version DESC);

-- 规则文件版本表
CREATE TABLE latch_rules (
    id         TEXT NOT NULL PRIMARY KEY,
    group_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',   -- 规则全文
    sha1       TEXT NOT NULL DEFAULT '',   -- content 的 SHA1
    version    INT  NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_latch_rules_group_version ON latch_rules(group_id, version DESC);

-- 配置组合表（无版本，整行更新）
CREATE TABLE latch_profiles (
    id              TEXT NOT NULL PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    proxy_group_ids TEXT[] NOT NULL DEFAULT '{}',  -- 引用 latch_proxies.group_id
    rule_group_id   TEXT,                          -- 引用 latch_rules.group_id，可为空
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    shareable       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_latch_profiles_enabled_shareable ON latch_profiles(enabled, shareable, created_at DESC);
```

### 3.2 Go 模型

```go
type LatchProxy struct {
    ID        string          `json:"id"`
    GroupID   string          `json:"group_id"`
    Name      string          `json:"name"`
    Type      string          `json:"type"`
    Config    json.RawMessage `json:"config"`
    SHA1      string          `json:"sha1"`
    Version   int             `json:"version"`
    CreatedAt time.Time       `json:"created_at"`
}

type LatchRule struct {
    ID        string    `json:"id"`
    GroupID   string    `json:"group_id"`
    Name      string    `json:"name"`
    Content   string    `json:"content"`
    SHA1      string    `json:"sha1"`
    Version   int       `json:"version"`
    CreatedAt time.Time `json:"created_at"`
}

type LatchProfile struct {
    ID            string    `json:"id"`
    Name          string    `json:"name"`
    Description   string    `json:"description"`
    ProxyGroupIDs []string  `json:"proxy_group_ids"`
    RuleGroupID   string    `json:"rule_group_id"`
    Enabled       bool      `json:"enabled"`
    Shareable     bool      `json:"shareable"`
    CreatedAt     time.Time `json:"created_at"`
    UpdatedAt     time.Time `json:"updated_at"`
}

// 用户接口返回的展开视图
type LatchProfileDetail struct {
    LatchProfile
    Proxies []LatchProxy `json:"proxies"`
    Rule    *LatchRule   `json:"rule,omitempty"`
}
```

---

## 四、代理类型与 Config 结构

`type` 字段为字符串，当前支持 6 种取值。`config` 是自由 JSONB，结构约定如下：

### `ss` — Shadowsocks

```json
{
  "server":   "1.2.3.4",
  "port":     8388,
  "password": "your-password",
  "method":   "aes-256-gcm"
}
```

### `ss3` — Shadowsocks 扩展协议

与 `ss` 结构相同，`method` 可扩展为 ss3 专属加密方式。

```json
{
  "server":   "1.2.3.4",
  "port":     8388,
  "password": "your-password",
  "method":   "chacha20-ietf-poly1305"
}
```

### `kcp_over_http` — KCP over HTTP

```json
{
  "server":        "1.2.3.4",
  "port":          4000,
  "key":           "kcp-secret",
  "crypt":         "none",
  "mode":          "fast",
  "mtu":           1350,
  "snd_wnd":       1024,
  "rcv_wnd":       1024,
  "data_shard":    10,
  "parity_shard":  3,
  "no_comp":       false
}
```

### `kcp_over_ss` / `kcp_over_ss3` — KCP over Shadowsocks

在 KCP 基础上叠加 SS 加密层：

```json
{
  "server":        "1.2.3.4",
  "port":          4000,
  "password":      "ss-password",
  "method":        "aes-256-gcm",
  "key":           "kcp-secret",
  "crypt":         "none",
  "mode":          "fast",
  "mtu":           1350,
  "snd_wnd":       1024,
  "rcv_wnd":       1024,
  "data_shard":    10,
  "parity_shard":  3,
  "no_comp":       false
}
```

### `wireguard` — WireGuard

```json
{
  "private_key": "base64-private-key",
  "public_key": "base64-public-key",
  "endpoint": "1.2.3.4:51820",
  "allowed_ips": "0.0.0.0/0,::/0"
}
```

> `config` 没有服务端 schema 校验，由客户端按 `type` 解释。后续若需要加校验，在 `parseLatchProxyRequest` 中按 type 做结构断言即可。

---

## 五、API 路由总览

### 管理员接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/latch/proxies` | 获取所有代理（各取最新版本） |
| POST | `/api/latch/proxies` | 创建代理 |
| GET | `/api/latch/proxies/:group_id` | 获取单个代理最新版本 |
| PUT | `/api/latch/proxies/:group_id` | 更新代理（自动版本化） |
| DELETE | `/api/latch/proxies/:group_id` | 删除代理（含全部历史版本） |
| GET | `/api/latch/proxies/:group_id/versions` | 查看版本历史 |
| PUT | `/api/latch/proxies/:group_id/rollback/:version` | 回滚到指定版本 |
| GET | `/api/latch/rules` | 获取所有规则（各取最新版本） |
| POST | `/api/latch/rules` | 创建规则（内联文本） |
| POST | `/api/latch/rules/upload` | 创建规则（文件上传） |
| GET | `/api/latch/rules/:group_id` | 获取单个规则最新版本 |
| GET | `/api/latch/rules/:group_id/content` | 下载规则原始文本 |
| PUT | `/api/latch/rules/:group_id` | 更新规则（内联，自动版本化） |
| POST | `/api/latch/rules/:group_id/upload` | 更新规则（文件上传） |
| DELETE | `/api/latch/rules/:group_id` | 删除规则 |
| GET | `/api/latch/rules/:group_id/versions` | 查看版本历史 |
| PUT | `/api/latch/rules/:group_id/rollback/:version` | 回滚到指定版本 |
| GET | `/api/latch/admin/service-nodes` | 获取服务节点列表（支持 `include_deleted`） |
| POST | `/api/latch/admin/service-nodes` | 创建服务节点 |
| PUT | `/api/latch/admin/service-nodes/:id` | 更新服务节点 |
| DELETE | `/api/latch/admin/service-nodes/:id` | 软删除服务节点 |
| POST | `/api/latch/admin/service-nodes/:id/agent-token` | 为节点签发 Agent Token（仅显示一次明文） |
| GET | `/api/latch/admin/profiles` | 获取所有 Profile |
| POST | `/api/latch/admin/profiles` | 创建 Profile |
| GET | `/api/latch/admin/profiles/:id` | 获取单个 Profile |
| PUT | `/api/latch/admin/profiles/:id` | 更新 Profile |
| DELETE | `/api/latch/admin/profiles/:id` | 删除 Profile |

### Agent 接口（机器身份，Bearer Token）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/latch/agent/register` | agent 启动注册，拉取节点配置并写首条状态 |
| POST | `/api/latch/agent/heartbeat` | agent 定时心跳上报状态、连接数、流量等 |

### 用户接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/latch/profiles` | 获取所有 enabled+shareable 的 Profile（含展开的 proxies/rule） |

---

## 六、关键实现细节

### 6.1 stringArray（无 lib/pq 的 PostgreSQL text[] 支持）

`proxy_group_ids` 列类型为 `TEXT[]`，项目未引入 `lib/pq`，因此自实现了 `stringArray` 类型：

```go
type stringArray []string

// Scan 实现 sql.Scanner，解析 PostgreSQL text[] 字面量
func (a *stringArray) Scan(src any) error { ... }

// Value 实现 driver.Valuer，编码为 PostgreSQL text[] 字面量
// 注意：返回类型必须是 driver.Value（而非 any），否则 database/sql 无法识别接口
func (a stringArray) Value() (driver.Value, error) { ... }
```

编码格式示例：`{g_abc123,g_def456}`，含特殊字符的元素会加引号。

### 6.2 Profile 不做版本化

Profile 是"配置组合的描述"，不存放实际二进制内容，变更代价低，因此采用整行覆盖更新（UPDATE）而非版本化。如有审计需求，可在后续版本中增加 `latch_profile_history` 表记录变更日志。

### 6.3 用户接口的展开逻辑

`GET /api/latch/profiles` 的 `listSharedLatchProfiles` 实现：

1. 查询 `enabled=true AND shareable=true` 的全部 Profile
2. 对每个 Profile，按 `proxy_group_ids` 中的每个 `group_id` 调用 `getLatchProxy`（查最新版本）
3. 若 `rule_group_id` 非空，调用 `getLatchRule` 查最新版本
4. 组装成 `LatchProfileDetail` 返回

当前是 N+1 查询（每个 Profile 逐个查询 Proxy/Rule）。Profile 数量小时无问题；若 Profile 数量增大，可优化为 IN 批量查询。

### 6.4 Agent Token 鉴权（Step 2）

Agent 不复用用户登录 Cookie/Session，而是独立使用：

```
Authorization: Bearer <agent_token>
```

流程：

1. 管理员对指定 Service Node 调用 `POST /api/latch/admin/service-nodes/:id/agent-token`
2. 服务端生成随机 token，仅返回一次明文，数据库只保存 `token_hash`（SHA256）
3. Agent 启动后调用 `/api/latch/agent/register`
4. Agent 周期性调用 `/api/latch/agent/heartbeat`
5. 服务端记录 `latch_service_node_heartbeats`，并回写节点的 `status/last_updated_at`

---

## 七、Agent API 详细说明

### 7.1 签发 Agent Token（管理员）

**POST** `/api/latch/admin/service-nodes/:id/agent-token`

权限：`AuthMiddleware + AdminMiddleware`

成功响应（示例）：

```json
{
  "message": "agent token 已生成（仅显示一次）",
  "token": "QxYQ....(省略)",
  "meta": {
    "id": "tok_abc123",
    "node_id": "node_001",
    "created_by": "u_admin_001",
    "created_at": "2026-04-23T09:00:00Z",
    "revoked": false
  }
}
```

说明：

- 同一节点签发新 token 时，旧 token 会自动标记为 `revoked=true`
- 明文 token 仅在本接口返回一次，后续不可回查

### 7.2 Agent 注册

**POST** `/api/latch/agent/register`

鉴权：`Authorization: Bearer <agent_token>`

请求体（示例）：

```json
{
  "agent_version": "wire-agent/0.1.0",
  "hostname": "wg-node-01",
  "status": "up",
  "payload": {
    "boot_id": "abc",
    "platform": "linux"
  }
}
```

成功响应（示例）：

```json
{
  "message": "registered",
  "node": {
    "id": "node_001",
    "name": "Tokyo-A",
    "ip": "1.2.3.4",
    "port": 51820,
    "proxy_type": "wireguard",
    "config": {
      "private_key": "...",
      "public_key": "...",
      "endpoint": "1.2.3.4:51820",
      "allowed_ips": "0.0.0.0/0,::/0"
    },
    "status": "up"
  },
  "heartbeat": {
    "status": "up"
  }
}
```

### 7.3 Agent 心跳上报

**POST** `/api/latch/agent/heartbeat`

鉴权：`Authorization: Bearer <agent_token>`

请求体（示例）：

```json
{
  "status": "up",
  "connected_peers": 12,
  "rx_bytes": 1024000,
  "tx_bytes": 2048000,
  "agent_version": "wire-agent/0.1.0",
  "hostname": "wg-node-01",
  "reported_at": "2026-04-23T09:10:00Z",
  "payload": {
    "iface": "wg0",
    "cpu": 0.21
  }
}
```

成功响应（示例）：

```json
{
  "message": "heartbeat accepted",
  "heartbeat": {
    "node_id": "node_001",
    "status": "up",
    "connected_peers": 12,
    "rx_bytes": 1024000,
    "tx_bytes": 2048000
  }
}
```

---

## 八、权限控制

所有 `/api/latch/proxies/*`、`/api/latch/rules/*`、`/api/latch/admin/profiles/*` 路由均经过：

```
AuthMiddleware()  →  AdminMiddleware()
```

`/api/latch/profiles`（用户接口）只经过 `AuthMiddleware()`，普通登录用户可访问。

---

## 九、已知限制与迭代方向

| 问题 | 当前状态 | 建议方向 |
|------|----------|----------|
| Proxy config 无 schema 校验 | 客户端自行解释 | 在 `parseLatchProxyRequest` 按 type 做结构校验 |
| Profile 不支持锁定特定版本 | 始终用最新版本 | Profile 增加 `proxy_versions` / `rule_version` 快照字段 |
| 用户接口展开为 N+1 查询 | Profile 少时无影响 | 改为 IN 批量查询 + 内存 join |
| 规则内容存数据库 | 当前直接存 TEXT | 若规则文件较大，可迁移到对象存储，DB 只存 URL |
| 删除操作不可恢复 | 删除即清除所有版本 | 增加软删除（`deleted_at` 字段）或归档机制 |
| 无 Profile 变更历史 | 整行覆盖更新 | 增加 `latch_profile_history` 审计表 |
| 多代理顺序无优先级 | 按 `proxy_group_ids` 数组顺序 | 可增加 `priority` 字段或让客户端自行排序 |

---

## 十、源码文件索引

| 文件 | 说明 |
|------|------|
| `internal/app/dock/latch_store.go` | 数据模型、DB 操作、stringArray、SHA1 工具函数 |
| `internal/app/dock/latch_proxy_handlers.go` | 代理 CRUD + Service Node + Agent（register/heartbeat）相关 Handler |
| `internal/app/dock/latch_rules_handlers.go` | 规则 CRUD + 文件上传 + 版本历史 + 回滚 Handler |
| `internal/app/dock/latch_profile_handlers.go` | Profile 管理员 CRUD + 用户展开接口 Handler |
| `internal/app/dock/store.go` | 建表 SQL（`CREATE TABLE IF NOT EXISTS latch_*`） |
| `internal/app/dock/app.go` | 路由注册（`/api/latch/*`） |
| `ui/src/types/dashboard.ts` | 前端 TypeScript 类型定义 |
| `ui/src/api/dashboard.ts` | 前端 API 调用函数 |
| `ui/public/dashboard.html` | 管理后台 3-tab UI（代理/规则/配置） |
| `doc/api.md` | 完整 HTTP API 文档 |
