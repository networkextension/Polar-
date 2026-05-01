# Polar 基础设施改造 2026 · P1-P5

> 起草: 2026-05-01
> 状态: **草案 (待 review)**
> 范围: 仅基础设施 (鉴权 / RBAC / ORM / 域名+TLS / wgcload 集成), 与"重大会议活动智能体系统 开发计划"(`meeting-agent-dev-plan.md`) 解耦, 由独立轨道并行推进
> 关键约束: 当前为产品内测期, 单根租户, 可手动迁数据, 优先迭代速度

---

## 0. 执行摘要

5 阶段 13 周改造, 把 Polar 的鉴权 / 数据访问层从手写 SQL + cookie session + admin/user 二元角色, 升级到:

- **GORM + Atlas 声明式 schema** (与 wgcload 一致)
- **短 JWT(15m) + 长 refresh JWT(7d) HS256** (与 wgcload 一致, 跨服务可信)
- **数据库 RBAC** (角色 / 权限 / 用户三表 + Redis 缓存)
- **wgcload 作为受 Polar 信任的子服务** (Polar 充当 IdP)
- **实例级白标** (logo / 主题色 / CSS / footer / 主办方 frame / 域名绑定 / TLS, 全在管理界面操作)

| 阶段 | 周 | 关键交付 |
| --- | --- | --- |
| P1 | W1-2 | RBAC 表 + 中间件 + 11 内置角色 |
| P2 | W3-4 | JWT 双轨 (Web cookie 不动, API/iOS/wgcload 用 Bearer) |
| P3 | W5-6 | Atlas baseline + GORM 入新模块 (RBAC + 会议域用 GORM) |
| P4 | W7-9 | wgcload SSO 集成 (按 `wgcload-integration` 方案 A) |
| P5 | W10-13 | 实例品牌化 + Caddy 反代 + TLS 自管 |

预算: 1 名后端工程师全程, 与会议域开发轨道 (其余 3-4 名后端) 并行。

---

## 1. P1 · 数据库 RBAC

### 1.1 背景

现状: `users.is_admin` 单 boolean 决定一切。**不能**支撑会议系统的多角色协作 (服务人员 / 安保 / 技术支持 / 资料整理 / 贵宾接待 / 排座员 / 网络管理员 / 审计员 / ...)。

需求侧约束: 内测期可手动配权限, 不需要权限管理 UI 上线即工作, 但**接口侧必须从 P1 起就走 RBAC 中间件**, 否则改造永远拖延。

### 1.2 选型

D2 数据库 RBAC (4 张表 + Redis 缓存)。理由:
- D1 静态枚举 → 角色一改要改代码, 不可能
- D3 Casbin / OPA → 策略外移调试痛, 单租户用不到这种复杂度
- D2 是行业默认起点

### 1.3 表结构

```sql
-- 角色 (内置 + 自定义)
CREATE TABLE roles (
    id          BIGSERIAL PRIMARY KEY,
    code        VARCHAR(64)  UNIQUE NOT NULL,   -- 'super_admin' / 'meeting_manager' / ...
    name        VARCHAR(128) NOT NULL,
    description TEXT,
    builtin     BOOLEAN NOT NULL DEFAULT FALSE,  -- 内置角色不可删
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 权限 (code = 'domain:action' 或 'domain:resource:action')
CREATE TABLE permissions (
    id          BIGSERIAL PRIMARY KEY,
    code        VARCHAR(128) UNIQUE NOT NULL,
    description TEXT
);

-- 角色 ←→ 权限
CREATE TABLE role_permissions (
    role_id       BIGINT NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
    permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 用户 ←→ 角色 (多对多)
CREATE TABLE user_roles (
    user_id    VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id    BIGINT      NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by VARCHAR(64),
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
```

### 1.4 权限码命名空间

`<domain>:<action>` 或 `<domain>:<resource>:<action>`, 全小写, 冒号分割。

```
admin:*
meeting:read   meeting:write   meeting:delete
agenda:read    agenda:write
guest:read     guest:write     guest:contact
guest:vip:read guest:vip:write guest:vip:contact
seat:plan      seat:approve
task:read      task:write      task:complete_self
incident:read  incident:write
livestream:read livestream:write
report:read    report:write    report:export
kb:read        kb:write
audit:read
system:health
transport:vip:assign
wireguard:device:read   wireguard:device:write   wireguard:admin
```

通配规则: 检查权限 X 时, 若用户拥有 `<domain>:*` 或 `admin:*`, 视为通过。

### 1.5 内置 11 角色

| code | 显示名 | 权限集 |
| --- | --- | --- |
| `super_admin` | 超级管理员 | `admin:*` |
| `meeting_manager` | 会议筹备主管 | `meeting:*`, `agenda:*`, `task:*`, `seat:approve`, `incident:read` |
| `guest_concierge` | 嘉宾接待 | `guest:read`, `guest:contact`, `agenda:read`, `task:complete_self` |
| `vip_concierge` | 贵宾接待 | guest_concierge ∪ `guest:vip:*`, `transport:vip:assign` |
| `seat_planner` | 排座员 | `seat:*`, `guest:read`, `agenda:read` |
| `service_staff` | 现场服务人员 | `agenda:read`, `task:read`, `task:complete_self` |
| `security` | 安保 | `guest:read`, `incident:write`, `agenda:read` |
| `tech_support` | 技术支持 | `system:health`, `livestream:*`, `agenda:read`, `wireguard:device:read` |
| `archivist` | 资料整理 | `report:write`, `kb:write`, `meeting:read` |
| `network_admin` | 网络管理员 | `wireguard:*` |
| `auditor` | 审计员 | 通配 `*:read` (RBAC 引擎特殊语义) + `audit:read` |

> 现有 `users.is_admin = TRUE` 在 P1 上线后自动映射到 `super_admin` 角色; `is_admin = FALSE` 不映射任何角色 (RBAC 不返默认 member, 业务上 deny by default — 会议域所有写操作必须显式拿到角色)。

### 1.6 中间件 / API

```go
// internal/app/dock/rbac/rbac.go
type Engine struct {
    db     *sql.DB           // P3 之后改 *gorm.DB
    cache  *redisCache       // 60s TTL + invalidate channel
    local  *lru.Cache        // 5000 用户, 1s TTL
}

func (e *Engine) UserHas(ctx context.Context, userID, perm string) (bool, error)
func (e *Engine) UserPerms(ctx context.Context, userID string) ([]string, error)
func (e *Engine) GrantRole(ctx context.Context, userID string, roleCode string, grantedBy string) error
func (e *Engine) RevokeRole(ctx context.Context, userID string, roleCode string) error
func (e *Engine) InvalidateUser(userID string)  // 角色变更后调

// 中间件
func (s *Server) RequirePerm(perm string) gin.HandlerFunc
```

调用样例:
```go
v1.POST("/meetings",      s.RequirePerm("meeting:write"),      s.handleMeetingCreate)
v1.PATCH("/seats/approve", s.RequirePerm("seat:approve"),      s.handleSeatApprove)
v1.GET("/audit",          s.RequirePerm("audit:read"),         s.handleAuditList)
v1.PATCH("/wg/devices/:id", s.RequirePerm("wireguard:device:write"), s.handleWGDeviceUpdate)
```

### 1.7 缓存策略

- Redis key `rbac:perms:{user_id}` → JSON `[]string`, TTL 60s
- 内存 LRU: `hashicorp/golang-lru/v2`, 5000 entry, 1s TTL (跨请求短复用)
- 角色 / 权限变更: `PUBLISH rbac:invalidate <user_id>` → 各 Polar 实例订阅清本地内存 + Redis key
- Deny 时不缓存 (避免长期错权), Allow 才缓存

### 1.8 审计

每次 RBAC 决策点写一条:
```
{ user_id, perm, route, allow|deny, ts, request_id }
```
进现有审计表 (新加 `category='rbac'` 区分)。**deny 占比 > 5% 触发监控告警** — 检测错配。

### 1.9 风险

| 风险 | 应对 |
| --- | --- |
| 老接口未挂 RequirePerm, 默认裸奔 | P1 中点 (W1 末) 写脚本扫所有 router 注册, 列出未挂权限的路由, 灰名单逐个补 |
| `is_admin` 映射出错锁死管理员 | P1 上线第一步: 数据库直插 `super_admin` 给 founder 用户; 升级前先备份 users 表 |
| Redis 不可用导致请求全 deny | 降级: 跳过缓存直查 DB, 高延迟但不 deny |

### 1.10 验收

- [ ] 4 张表 + 11 内置角色 + 50+ 权限码落库
- [ ] `RequirePerm` 中间件单测覆盖 allow / deny / 通配 / 缓存命中四类
- [ ] 全部新加 (会议域) 路由强制经过 RBAC, CI 加 lint 检查 router 注册
- [ ] 老接口至少把"写"操作全部挂上 RBAC, "读"操作 W4 末完成
- [ ] 审计日志含 deny 流, 监控仪表板可查

---

## 2. P2 · JWT 双轨

### 2.1 背景

现状: web 走 cookie session + refresh token, iOS 走自有 token, wgcload 集成需要可跨服务验证的 token。

目标: 与 wgcload 鉴权对齐 (HS256 短 access 15m + refresh 7d), 同时保留 Web 的 cookie session 体验 (避免 XSS 自管 + refresh 复杂化前端)。

### 2.2 选型

C2 双轨:
- **Web (浏览器主站)**: 继续 cookie session, 不动现有体验
- **API / iOS / 跨服务 (wgcload)**: 短 JWT (15m) + 长 refresh JWT (7d), HS256

理由:
- C1 一刀切 → Web 改 fetch wrapper + refresh 逻辑成本高且 XSS 面扩大
- C3 自建 OAuth2 IdP (Hydra / Authelia) → 单租户内测期不必要

### 2.3 Token 结构

**Access JWT** (HS256, 15m TTL):
```json
{
  "iss": "polar",
  "sub": "user_xxx",
  "aud": ["polar", "wgcload"],
  "exp": 1714572900,
  "iat": 1714572000,
  "jti": "<random>",
  "kid": "k1",
  "perms": ["meeting:read", "guest:write", ...],
  "roles": ["meeting_manager", "vip_concierge"],
  "sid": "<session_id>"
}
```

**Refresh JWT** (HS256, 7d TTL):
```json
{
  "iss": "polar",
  "sub": "user_xxx",
  "aud": "polar",
  "type": "refresh",
  "exp": 1715177700,
  "kid": "k1",
  "fid": "<family_id>"  // refresh token rotation
}
```

`perms` 字段在签发时从 RBAC 引擎拉一次, 嵌入 token 减少接收方查 DB; 但**变更角色后要等 ≤ 15m** 生效 (access 自然过期), 高紧急场景可调用 `/api/v1/sessions/revoke`。

### 2.4 端点

```
POST /api/v1/token             body: { grant_type: "password" | "refresh_token", ... }  → { access, refresh, expires_in }
POST /api/v1/token/refresh     body: { refresh: "..." }                                 → { access, refresh }
POST /api/v1/sessions/revoke   header: Authorization: Bearer <access>                   → 204
GET  /api/v1/me                                                                          → user + roles + perms
```

`POST /api/v1/token` 与现有 `/api/v1/auth/login` 共存, 登录密码校验路径复用。

### 2.5 中间件 (双轨)

```go
func (s *Server) RequireAuth() gin.HandlerFunc {
    return func(c *gin.Context) {
        // 1. 优先 Authorization: Bearer <jwt>
        if tok := c.GetHeader("Authorization"); strings.HasPrefix(tok, "Bearer ") {
            claims, err := s.jwtMgr.Verify(tok[7:])
            if err == nil {
                c.Set("user_id", claims.Sub)
                c.Set("perms", claims.Perms)
                c.Set("auth_method", "jwt")
                c.Next()
                return
            }
        }
        // 2. 回退: cookie session
        if uid, ok := s.sessionMgr.UserFromCookie(c); ok {
            c.Set("user_id", uid)
            c.Set("auth_method", "session")
            // perms 从 RBAC 现查 (cookie 路径不携带 perms)
            c.Next()
            return
        }
        c.AbortWithStatusJSON(401, gin.H{"error": "unauthorized"})
    }
}
```

`RequirePerm` 中间件兼容两轨: JWT 路径直接读 token 里的 `perms`, cookie 路径走 RBAC 引擎查询。

### 2.6 密钥管理

- HS256 共享密钥从 env `POLAR_JWT_SECRET` 注入 (32+ 字节随机)
- 多 kid 支持: 配置 `current` + `previous` 两把, 验签按 `kid` 选择, 签发只用 `current`
- 轮换流程:
  1. 部署 `previous = current`, `current = <new_key>`
  2. 24h 后下掉 `previous` (老 token 都过期)
- wgcload 端配同样的 secret + kid (env 同步)

### 2.7 Refresh Token Rotation

防 token 泄露重放:
- 每次刷新, 新签 refresh + 旧 refresh 进黑名单 (`fid` 串成 family, 一旦同 family 被刷两次 → 整 family 撤销 + 强制重新登录)
- 黑名单存 Redis, key `jwt:refresh:revoked:{jti}`, TTL = 7d

### 2.8 风险

| 风险 | 应对 |
| --- | --- |
| Web 端意外切到 JWT 路径丢 cookie | 中间件优先级: cookie 路径在站内 host 下生效, JWT 仅 `/api/v1/*` |
| iOS 旧 token 不兼容 | 加 `Accept: application/vnd.polar.v2+json` header 区分; v1 端点继续工作 6 个月 |
| 共享密钥泄露 | kid 轮换 + 密钥 Vault 注入 (P5 引入), 内测期 env 注入即可 |
| 黑名单 Redis 故障 | 降级: 黑名单查不到当通过, 加 metrics 告警 |

### 2.9 验收

- [ ] `/api/v1/token` + `/refresh` + `/revoke` 三端点上线
- [ ] iOS 客户端切到 v2, 旧 token 6 月后下线
- [ ] wgcload 用同一 secret 验签 Polar JWT (不验证 sub 之外的 claims)
- [ ] kid 轮换演练通过
- [ ] refresh rotation 安全 (家族重用即整族失效)

---

## 3. P3 · Atlas + GORM 入新模块

### 3.1 背景

现状: 所有 schema 变更靠 `internal/app/dock/store.go` 的 `openDB()` 中 `ALTER TABLE IF NOT EXISTS ...`, 已经几千行, 难以审计 / diff / rollback。

目标: 与 wgcload 一致 (Atlas 声明式 + GORM), 但**不一次性切**, 仅新模块 (会议域 / RBAC 表) 上 GORM, 旧模块保持 lib/pq, 永远不切也行。

### 3.2 选型

A2 + B1:
- 新建 `internal/orm/` 子包, 仅会议域 + RBAC 4 张表用 GORM
- 旧表用 `atlas schema inspect` 反向 introspect 一次, 锁定 baseline
- 之后**所有** schema 变更 (新旧表都包括) 走 Atlas migrations, 内嵌 ALTER 全部下线

### 3.3 目录结构

```
internal/
├── app/
│   └── dock/
│       ├── store.go              ← 旧 lib/pq 代码不动
│       ├── meeting/              ← 新模块, 仅用 GORM
│       │   ├── models.go         (gorm:"...")
│       │   ├── repo.go           (*gorm.DB)
│       │   └── ...
│       └── rbac/                 ← P1 表也迁 GORM
│           └── ...
├── orm/                          ← GORM 公共: db conn, hooks, migrate runner
│   ├── conn.go
│   └── tx.go
└── ...

migrations/
├── atlas.hcl                     ← Atlas 配置
├── schema/                       ← 声明式 schema 文件 (HCL or SQL)
│   ├── 0001_baseline.sql         ← inspect 现有库导出
│   ├── 0002_rbac.sql
│   ├── 0003_meeting_domain.sql
│   └── ...
└── seed/                         ← 内置角色 / 权限种子
```

### 3.4 数据库连接

主进程持两种 handle:
- `*sql.DB` (lib/pq, 给老代码)
- `*gorm.DB` (pgx, 给新代码)

两者指同一 PG, 同一库; gorm 用 `pgx` driver (`gorm.io/driver/postgres`)。

> 一致性提醒: 跨两种 driver 写同一表会有 prepared statement cache 各自维护 (无业务影响), 但**事务**不能跨两个 handle, 设计时新模块写自己的表, 不写老表; 老模块同理。

### 3.5 迁移流程

开发期:
```bash
# 1. 改 migrations/schema/000X_xxx.sql
# 2. 生成 migration plan
atlas migrate diff --env local

# 3. 应用到本地 dev DB
atlas migrate apply --env local

# 4. 启动 Polar, GORM AutoMigrate 关闭 (Atlas 全权管)
```

生产: CI 推 main 后跑 `atlas migrate apply --env prod` (同步 / 异步取决于运维口味, 建议同步, 部署前先迁)。

### 3.6 风险

| 风险 | 应对 |
| --- | --- |
| Atlas baseline 和真实库不一致 | 上线前 `atlas migrate diff` 必须 0 差异; 不一致先手工对齐再锁定 |
| 老代码 ALTER 没下线导致 schema drift | 写 lint: grep `ALTER TABLE` 在 `store.go` 报错 |
| GORM N+1 / 隐性 join | code review 检查 `Preload` 用法; 加 GORM logger 阈值 (>200ms slow query) |
| pgx 与 lib/pq 同库连接数翻倍 | 各自池子限 25 连, 总 50, 可控 |

### 3.7 验收

- [ ] `migrations/atlas.hcl` 配置就绪, baseline diff = 0
- [ ] 会议域 + RBAC 4 表全部 GORM 实现 + 单测
- [ ] CI 跑 `atlas migrate diff` 检测未声明的 schema 变更
- [ ] `store.go` 内 ALTER 数量减少到只剩 baseline 锁定的部分
- [ ] 部署文档更新: `make migrate` 等价于 `atlas migrate apply`

---

## 4. P4 · wgcload 集成 (Polar 当 IdP)

参见 `wgcload-integration` 方案 A (此 doc 不复制)。要点:

- Polar 签发 `aud=["polar","wgcload"]` 的 access JWT, 含 `perms` 字段
- wgcload `auth.mode = polar` 用同一 HS256 secret 验签
- wgcload `users` 表加 `external_id, provider` 列, 首次见到该 sub 自动 provision
- wgcload 自身 RBAC 退化: 仅检查 token `perms` 是否含 `wireguard:*` 子集 (不再维护独立 role)
- UI: Polar 主导航加"网络"菜单, iframe 或新窗口打开 wgcload SPA, 携带 access token (URL fragment 或 sessionStorage)
- token 续期: Polar 透明 refresh, wgcload SPA 调 Polar `/api/v1/token/refresh` (CORS allowlist)

依赖: P2 完成 (JWT 双轨)。

### 4.1 wgcload 仓库改动

- 新增 `internal/auth/verifier.go`: `AuthVerifier` 接口, 实现 `LocalJWT` + `PolarJWT`
- `config.yaml` 加 `auth.mode` + `auth.polar.{shared_secret, allowed_iss, kids}`
- `users` 表加 2 列, migration 走 wgcload 自己的 Atlas
- 中间件 `JWTAuth` 改为读 verifier 配置选实现

预算: ~ 200-400 行 Go + 1 个 atlas migration。

### 4.2 Polar 仓库改动

- `internal/app/dock/wireguard/`:
  - `adapter.go`: 签发 wgcload 专用 token (audience claim)
  - `account_link.go`: `wireguard_account_link(polar_user_id, wgcload_user_id, linked_at)`
  - `proxy.go` (可选): 反代 wgcload API 给 Polar 自己的 UI 直接调
- `ui/`: "网络"菜单 + iframe 容器页

预算: ~ 300-500 行 Go + UI 1-2 页。

### 4.3 验收

- [ ] Polar 用户登录 → 点"网络" → wgcload 列表加载, 用户感知是同一系统
- [ ] wgcload 仍可独立部署 (auth.mode=local 回退)
- [ ] token 过期自动续, 用户无感知
- [ ] 撤销 Polar 用户的 `wireguard:device:read` → wgcload 立即拒绝其请求 (≤ 15m)

---

## 5. P5 · 实例品牌化 + 域名 + TLS

### 5.1 背景

私有化部署场景, 用户希望:
- 改 logo / favicon / 站点名
- 设置主题色 / 暗色变体
- 上传自定义 CSS
- 编辑主页 footer
- 主办方 frame: 电话 / 地址 / 联系人
- 绑定自有域名 + HTTPS 证书自管
- **全部在管理界面操作**, 不要 SSH / nginx config

### 5.2 选型 (推荐默认)

| 子能力 | 推荐 |
| --- | --- |
| 品牌基础 | E1 前端启动拉 `/api/v1/branding` 应用 DOM |
| CSS 自定义 | F3 双轨 (默认 F1 变量限定, super_admin 可开 F2 任意 CSS) |
| Footer / 主办方 frame | G2 结构化字段 + G1 Markdown 自由文 |
| 域名绑定 | H1 前置 Caddy + admin API 动态加 vhost |
| TLS | I1 Caddy on-demand TLS + I3 手动上传 (回退) |

### 5.3 Open Questions (review 时定)

1. **Q1 多主办方支持**: 一个 Polar 实例多场会议各自品牌 (path / subdomain 切 brand) — 默认**单 brand**, 多 brand 留二期?
2. **Q2 CSS 自定义粒度**: F1 / F2 / F3? 默认 **F3**, 开关默认值是 F1 only?
3. **Q3 引入 Caddy 反代**: docker-compose 加 caddy 容器? 默认 **是**。
4. **Q4 TLS 自动签发模式**: on-demand TLS (用户先配 A 记录) vs ACME 显式验证流程? 默认 **on-demand**, 不能用时手动上传。

### 5.4 表结构 (默认假设)

```sql
-- 实例级单例 (id=1 永远只有一行)
CREATE TABLE site_settings (
    id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    site_name       VARCHAR(128) NOT NULL DEFAULT 'Polar',
    logo_url        TEXT,
    favicon_url     TEXT,
    theme_vars      JSONB NOT NULL DEFAULT '{}'::jsonb,    -- { primary: '#xx', bg: '#xx', radius: '8px', ... }
    custom_css_url  TEXT,                                   -- F2 上传产物
    custom_css_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    footer_md       TEXT,                                   -- Markdown
    sponsor_frame   JSONB,                                  -- { name, address, phone, contact, logo_url }
    canonical_host  VARCHAR(255),                           -- 用于绝对 URL
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      VARCHAR(64)
);

-- 域名绑定
CREATE TABLE domains (
    id          BIGSERIAL PRIMARY KEY,
    host        VARCHAR(255) UNIQUE NOT NULL,
    status      VARCHAR(32) NOT NULL,           -- 'pending'|'verifying'|'active'|'failed'
    primary_domain BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ
);

-- TLS 证书 (用户手动上传或 ACME 落地)
CREATE TABLE tls_certs (
    id            BIGSERIAL PRIMARY KEY,
    domain_id     BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    source        VARCHAR(16) NOT NULL,         -- 'manual'|'acme'|'on_demand'
    not_before    TIMESTAMPTZ NOT NULL,
    not_after     TIMESTAMPTZ NOT NULL,
    cert_pem      TEXT NOT NULL,                -- 加密存储 (字段级 AES, 见 P5.7)
    key_pem_enc   BYTEA NOT NULL,               -- AES-GCM 加密, key 在 env / Vault
    chain_pem     TEXT,
    fingerprint   VARCHAR(128) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 静态资产 (logo / favicon / custom CSS)
CREATE TABLE brand_assets (
    id          BIGSERIAL PRIMARY KEY,
    kind        VARCHAR(32) NOT NULL,            -- 'logo'|'favicon'|'css'|'sponsor_logo'
    storage_url TEXT NOT NULL,
    mime        VARCHAR(64),
    size_bytes  BIGINT,
    sha256      VARCHAR(64),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    uploaded_by VARCHAR(64)
);
```

### 5.5 架构

```
Internet
   │ :443 / :80
   ▼
┌──────────────────────────────────────────────────┐
│  Caddy (单容器)                                   │
│  - 监听 80 / 443                                  │
│  - 内置 ACME (HTTP-01 / on-demand TLS)           │
│  - admin API on 127.0.0.1:2019                   │
│  - 动态 vhost: 多域名 → 同一上游                  │
└──────────────────────────┬───────────────────────┘
                           │ http://polar:8080
                           ▼
                   Polar 主进程
                   ├── 业务 API
                   ├── /api/v1/branding (read)
                   └── /api/v1/admin/site/* (write)
                              │ (Caddy admin API)
                              ▼
                   增删 vhost / 上传 cert
```

### 5.6 关键流程

#### 5.6.1 域名绑定 + on-demand TLS

1. 用户管理界面填入 `meeting2026.example.com`
2. Polar 写入 `domains(host='...', status='pending')`
3. UI 显示"请把该域名 A 记录指向 `<server_ip>`, 然后点击验证"
4. 用户点验证, Polar 调 Caddy admin API:
   ```
   POST /config/apps/http/servers/srv0/routes
   { match: [{host: ['meeting2026.example.com']}], handle: [...] }
   ```
5. Caddy 在用户首次访问时自动走 ACME HTTP-01 签发证书
6. 证书生效后, Polar 通过 `GET /pki/...` 拉证书入库 → `domains.status = 'active'`

#### 5.6.2 手动上传证书 (回退路径)

1. 用户上传 `.crt + .key + chain.pem`
2. Polar 校验: parse + hostname match + expiry > 30d + 私钥匹配证书
3. AES-GCM 加密私钥后入库 `tls_certs`
4. 调 Caddy admin API 加载该证书 (`POST /load`)

#### 5.6.3 证书续期监控

- Ticker 每天检查所有 `tls_certs.not_after < now() + 30d`
- 自动续 (ACME) 或推送提醒 (manual)
- 提醒渠道: Polar IM + 邮件

#### 5.6.4 品牌应用

- 前端 `index.html` 加 inline `<script>` 启动时 `fetch('/api/v1/branding')`, 应用:
  - `site_name` → `<title>`
  - `logo_url` → 顶栏 img.src
  - `theme_vars` → CSS custom properties on `:root`
  - `custom_css_url` → `<link rel="stylesheet">` (sha256 integrity 校验)
  - `footer_md` → 渲染到 footer slot
  - `sponsor_frame` → 渲染到角落 frame component

### 5.7 安全 / 风险

| 风险 | 应对 |
| --- | --- |
| 自定义 CSS 注入 (XSS via `expression()`, `url()`) | F2 路径解析 CSS, 拒绝 `expression`/`@import`/`url(http*)`, 仅允许 `url(/static/*)`; CSP `style-src 'self' 'sha256-<hash>'` |
| Logo / favicon 上传作为 XSS 媒介 (svg with `<script>`) | 服务端转 PNG (svg → png 转换或拒绝 svg) |
| 私钥落库泄露 | AES-GCM 加密, 主密钥从 env 注入 (P5 后期接 Vault) |
| Caddy admin API 暴露 | 仅 `127.0.0.1:2019`, 不监听公网 |
| 用户绑了无主域名 (拒签) | 状态机 `verifying → failed`, 30min 超时给出诊断 (DNS 查 A 记录 / 反向 PTR / Caddy log 摘要) |
| ACME 限流 (Let's Encrypt 50/week) | 加 backoff + 报警, 内测期不会触发 |

### 5.8 验收

- [ ] super_admin 在管理界面可改 logo / favicon / 主题色, 即时生效
- [ ] 上传自定义 CSS, 限制 100KB 内, 危险规则被拒
- [ ] Footer Markdown + 主办方 frame 可编辑, 多页面统一显示
- [ ] 绑定 1 个新域名, 5 分钟内 HTTPS 可访问 (on-demand)
- [ ] 手动上传证书, 私钥加密入库, 部署生效
- [ ] 证书 30 天内到期, 通过 IM + 邮件收到提醒
- [ ] Caddy admin API 不暴露公网 (扫端口验证)

---

## 6. 总体风险 / 进度跟踪

| 阶段 | 关键依赖 | 上线前必须完成 |
| --- | --- | --- |
| P1 | 无 | RBAC 中间件全量挂载, 老 super_admin 映射 |
| P2 | P1 (perms 注入 token 需要 RBAC 引擎) | iOS / wgcload 切到 v2 token; refresh rotation 演练 |
| P3 | 无 (与 P1/P2 解耦, 独立轨道) | atlas baseline diff = 0; 老 ALTER 下线 |
| P4 | P2 (JWT) + P3 (RBAC GORM 表) | wgcload `auth.mode=polar` 验签通过, SSO E2E |
| P5 | 无 (与上述解耦; 表自包含) | Caddy + 域名 + TLS 全流程, 内部 demo 演练 |

每阶段末 1 天为 buffer, 不达标本阶段不关闭, 砍掉非必要项 (例: P5 的 Markdown footer 可砍, 改成纯文本)。

---

## 7. 文档化与流程

每阶段开发期前: 起 PR 改动设计点 (本 doc 即为 P1-P5 总章, 各章如有大改另起子 doc)
每阶段中点 (sprint 第一周末): demo gate, 后端工程师演示给 user / PM
每阶段末: 更新本 doc 的"验收"勾选状态; CHANGELOG 一行总结

> 本 doc 与 `meeting-agent-dev-plan.md` 解耦但同期推进; 如发生冲突 (例: 会议域 sprint 1 起表却 P3 还没切 GORM), P1-P5 优先, 会议域临时用 lib/pq 起表, P3 完成后回迁。

---

## 8. Open Questions Recap

P5 的 4 个开关 (Q1-Q4) 在 review 时定。其余阶段 (P1-P4) 选型已锁定, 如 review 反馈大改, 再起补丁 PR。
