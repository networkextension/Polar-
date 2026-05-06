# iOS 分发测试平台 — 开发计划 (DEV PLAN)

基于 `iosapp.md` 设计方案拆解的迭代开发计划。原则：先打通"上传 → 签名 → OTA 安装"主链路，再叠加资源管理、ASC 同步、自动重签等能力。每个阶段都给出可交付物与验收标准。

---

## 0. 里程碑总览

| 阶段 | 目标 | 周期(估) | 交付物 |
| --- | --- | --- | --- |
| M0 | 项目骨架 + 基础设施 | 1 周 | 仓库、CI、本地一键起服务 |
| M1 | 主链路 MVP（zsign + OTA） | 2-3 周 | 上传 IPA → 在线签名 → 扫码安装 |
| M2 | 资源中心（证书 / Profile / UDID） | 2 周 | 多证书隔离、KMS 加密、有效期看板 |
| M3 | Xcode 通道 + entitlements 场景 | 2 周 | mac agent、能力补全的重签 |
| M4 | ASC 同步（拉取） | 2 周 | TestFlight / 元数据 / 审核状态展示 |
| M5 | ASC 同步（推送）+ 元数据编辑 | 2 周 | 控制台一键提交描述/截图/What's New |
| M6 | 自动重签 + 灰度分组 + 审计 | 2 周 | 证书到期重签、分组下发、审计日志 |
| M7 | 性能 / 稳定性 / 安全加固 | 1-2 周 | 压测、配额、密钥审计、灾备演练 |

总计约 14-16 周（单团队 3-5 人）。M1 完成即可对外灰度试用。

---

## M0. 项目骨架 + 基础设施

**目标**：让团队在统一的开发环境里写代码、跑测试、起本地依赖。

**任务**
- 仓库结构：`server/`（Go monorepo，按 service 分子模块）、`web-console/`（Vue/React 后台）、`web-ota/`（H5 安装页）、`worker-zsign/`、`worker-mac-agent/`、`deploy/`（docker-compose / k8s）。
- docker-compose 起 Postgres 14、Redis 7、MinIO，本地 `make dev` 一键拉起。
- CI：lint + 单测 + 镜像构建（GitHub Actions / GitLab CI）。
- 配置体系：viper / env，分 dev / staging / prod，密钥走 .env.local 不入库。
- 日志规范：JSON 结构化日志 + trace_id，接 OpenTelemetry。
- 错误码 / API 响应格式约定。

**验收**：新人 clone 后 30 分钟内能在本地跑通 `make dev` 并访问空白控制台。

---

## M1. 主链路 MVP — zsign 在线签名 + OTA 安装

**目标**：跑通"上传原包 → 选证书 → 签名 → 二维码 → iPhone 装上"。这是平台的最小价值闭环。

### 后端（app-svc + sign-svc）
- 数据表：`apps`、`app_versions`、`builds`、`sign_tasks`、`certificates`（先放明文占位，M2 换 KMS）。
- API：
  - `POST /apps` / `GET /apps`
  - `POST /apps/:id/versions`（multipart 上传 IPA → MinIO）
  - `POST /sign-tasks`（入参：build_id + cert_id + profile_id）
  - `GET /sign-tasks/:id`（轮询状态）
  - `GET /install/:token` 返回 manifest.plist（XML）
  - `GET /download/:token` 短期签名 URL 走 MinIO presign
- 签名任务状态机：`pending → running → success / failed`，幂等键 = `sha256(ipa) + cert_fingerprint + profile_id`。
- Redis Stream 投递任务，worker 用 consumer group 消费。

### Worker（worker-zsign）
- Linux 容器，内置 zsign 二进制、p12/profile 临时挂载目录。
- 拉任务 → 下载 IPA → 取证书 → `zsign -k cert.p12 -m xx.mobileprovision -p pass -o signed.ipa src.ipa` → 上传回 MinIO → 回写状态。
- 失败重试 ≤ 2 次，超时 5 分钟。

### 前端
- 控制台：应用列表、版本上传、发起签名、查看任务状态、生成安装链接。
- OTA 安装页：极简 H5，渲染应用名 / 版本 / 二维码 / `itms-services://...` 按钮 + 开发者模式引导文案。

### 关键校验
- 上传时用 `ipatool`/解压 Info.plist 提取 bundleId、版本号、icon；与 profile 的 bundleId 比对。
- profile 的 UDID 列表在签名前先校验，不在列表内直接拒绝并提示。

**验收**：用一个真实 Ad-hoc 证书 + profile，能让非开发同学扫码装上 demo App。

---

## M2. 资源中心（证书 / Profile / UDID）

**目标**：把 M1 临时塞的证书/profile 升级为正式的资源管理。

**任务**
- `certificates` 表加 KMS 加密字段，p12 / p8 私钥落库前用 KMS DataKey 包一层；解密只在 worker 内存中。
- Profile 解析：读取 mobileprovision 内嵌 plist，提取 TeamID、AppID、UDID 列表、过期时间、entitlements。
- UDID 设备表：录入来源（手动 / mobileconfig 抓取页 / Apple 后台同步），打标分组。
- 有效期看板：证书 / profile 即将过期（≤ 14 天）红色高亮，邮件 / Webhook 告警。
- 资源与账号（Apple Developer Team）的归属关系，权限隔离（不同业务线只能用自己的证书）。
- mobileconfig UDID 抓取页（可选）：测试机扫码 → 安装描述文件 → 平台拿到 UDID 自动入库。

**验收**：管理员能新建一个完整的 Apple Team 配置，运营能在不接触 p12 文件的情况下完成签名。

---

## M3. Xcode 通道 — mac agent

**目标**：覆盖 zsign 搞不定的场景（修改 entitlements、加 Push / NE / Associated Domains、源码出包）。

**任务**
- mac mini agent（Go 写守护进程）：
  - 启动时注册到调度中心，上报机器指纹、Xcode 版本、可用磁盘。
  - 拉任务后用 `xcodebuild -exportArchive` 或 `codesign --entitlements` 出包。
  - 工作目录用 ramdisk，签名完即清。
- 调度策略：根据任务 `channel = zsign | xcode` 路由到不同队列。
- entitlements 编辑器：控制台可视化勾选能力 → 生成 `.entitlements` 注入。
- Apple 开发者后台联动（fastlane spaceship 或 App Store Connect API）：UDID 注册、profile 重新生成。
- 至少 2 台 mac agent 做主备，单点宕机自动转移。

**验收**：能从源码 archive 出包，并在签名时新增 Push 能力且装机后通知到达。

---

## M4. ASC 同步 — 拉取侧

**目标**：把 TestFlight 与 App Store 的状态拉到平台展示，减少切 ASC 网页。

**任务**
- ASC 鉴权模块：Issuer ID + Key ID + p8 私钥 → 自签 JWT（exp ≤ 20 分钟），结果按 Key 缓存到 Redis。
- 接入 App Store Connect API：
  - `/v1/builds`：构建列表 + 处理状态（PROCESSING / VALID / INVALID）。
  - `/v1/betaGroups` / `/v1/betaTesters`：外测组与成员。
  - `/v1/appStoreVersions` / `/v1/appStoreVersionLocalizations`：版本元数据。
  - `/v1/appStoreReviewDetails`：审核状态。
- 同步策略：增量拉取（按 `updated_at`），优先用 Apple Webhook（如已开通），降级为 5 分钟轮询。
- 速率限制保护：全局令牌桶 + 指数退避（429 触发）。
- 控制台：构建时间线、外测组成员、审核状态卡片。

**验收**：ASC 上发生的状态变化 ≤ 2 分钟内在控制台可见。

---

## M5. ASC 同步 — 推送侧 + 元数据编辑

**目标**：在控制台一键提交描述、关键词、What's New、截图、价格层级。

**任务**
- 多语言元数据编辑器（i18n 表 + 富文本/纯文本字段）。
- 截图上传 + 设备尺寸校验（6.7" / 6.5" / 5.5" / iPad 12.9" 等），自动批量提交。
- 提交流程：草稿 → 校验 → 推 ASC → 标记已同步；失败带原因（字段超长 / 截图尺寸错 / 截图缺失）。
- What's New 字段做版本快照，回溯历史版本写过什么。
- 与 fastlane deliver 二选一对接（团队已用 fastlane 时直接复用）。

**验收**：能在控制台改完所有元数据后直接提交审核，不再回 ASC 网页。

---

## M6. 自动重签 + 灰度 + 审计

**目标**：解决长尾运维问题。

**任务**
- 自动重签：证书过期前 N 天扫描所有"在用"包，批量重签 + 邮件通知，旧链接保留 7 天回退窗口。
- 灰度分组：UDID / 测试组维度生成不同安装链接，统计每组下载与安装数。
- 安装统计：OTA 页埋点 + manifest 拉取日志，区分扫码 / 下载 / 安装失败。
- 审计日志：所有签名、证书操作、ASC 推送都落审计表，含操作人、IP、入参摘要。
- RBAC：管理员 / 运营 / 开发 / 只读 四种角色。

**验收**：模拟证书 7 天后过期，平台自动重签 200 个历史版本无人工介入。

---

## M7. 性能 / 稳定性 / 安全加固

**任务**
- 压测：1000 个并发签名任务、worker 横向扩到 N 个，瓶颈定位（IO / CPU / 网络）。
- 大文件优化：S3 multipart upload、断点续传。
- 密钥审计：所有 KMS 解密调用打日志；定期 rotate DataKey。
- 灾备：MinIO bucket 跨区复制、Postgres 主从 + 定时快照、密钥脱机备份流程。
- 渗透测试 / 依赖扫描（trivy / snyk）。
- SLO：签名 P95 < 60s，OTA 链接首字节 < 500ms，可用性 99.5%。

**验收**：通过一次内部红蓝演练，并跑过 24h 压力测试无内存泄漏。

---

## 风险与依赖

- **HTTPS 证书**：OTA 必须有效 CA 签名，自建机房要提前申请；优先放 CDN（Cloudflare / 阿里云）。
- **mac agent 资源**：自建 mac mini 池采购周期长，过渡期可用 MacStadium / AWS EC2 mac（按小时计费）。
- **Apple 后台变更**：ASC API 字段会变，留好版本切换开关；监控官方 Release Notes。
- **iOS 16.4+ 开发者模式**：OTA 页务必带引导，否则装完打不开 App 会被误判平台问题。
- **设备 UDID 100 台/年上限**：个人开发者账号要在资源中心做配额管理；企业账号注意合规。
- **zsign 能力边界**：M1 阶段就要在 UI 上明确"加能力请走 Xcode 通道"，避免运营误用。

---

## 团队建议分工（5 人配置）

- 后端 2 人：app-svc / sign-svc / asc-svc / worker 调度。
- 前端 1 人：控制台 + OTA 安装页。
- 平台 / DevOps 1 人：mac agent、KMS、k8s、监控告警。
- TL / 全栈 1 人：架构 owner、ASC 联调、跨服务接口评审。

---

## 下一步动作

1. 评审本计划，确认里程碑顺序与人力。
2. 立项 M0，搭仓库 + CI + 本地 docker-compose。
3. 同步申请 Apple 开发者账号资源、ASC API Key、mac agent 机器。
4. 启动 M1 sprint，目标 3 周内出第一版可扫码安装的 demo。
