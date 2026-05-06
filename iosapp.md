下面是这个 iOS 分发测试平台的设计方案。整体思路是把"应用包"、"签名资源"、"签名引擎"、"OTA 分发"、"ASC 同步"五件事拆成独立的服务，签名优先走容器化的 zsign 池，需要改 entitlements 或者从源码出包的场景再走 macOS 上的 Xcode 通道。

## 总体架构按层说明：

前端层分为两个用户面：管理控制台给运营和开发用，做应用管理、签名操作、资源维护、ASC 同步触发；OTA 安装页给测试设备访问，通常通过短链或二维码进入，页面要尽量轻量、加载快。

服务层是平台核心。应用管理负责 App、版本、构建记录、灰度分组、下载与安装统计。签名引擎做签名任务的调度、状态机、幂等处理，同时支持单包在线签、批量重签、以及证书过期前的定时重签。资源中心是证书 (.p12)、Provisioning Profile、UDID 设备列表的统一仓库，所有签名都从这里取资源。ASC 同步通过 App Store Connect API 双向同步 TestFlight 构建状态、外部测试组成员、App Store 版本元数据（标题、描述、关键词、What's New、截图）。

工作进程层是签名的执行端。zsign 池跑在 Linux 容器里，启动快、资源开销小，覆盖大部分企业证书或个人证书的重签场景。Xcode 构建机是 mac mini 池（自建机房或 MacStadium / AWS EC2 mac），处理需要修改 entitlements、加 Push / Network Extension、或者从源码 archive 出包的场景。

外部依赖只跟两家服务通信：Apple 开发者后台用于注册 UDID 和刷新 Profile（可以走 fastlane 或直接用 Apple Developer Enterprise API），ASC API 用于 TestFlight 和 App Store 元数据同步。鉴权用 ASC API Key（Issuer ID + Key ID + p8 私钥），自己签 JWT，token 有效期 ≤ 20 分钟，要做缓存。

存储层是 PostgreSQL 放结构化元数据，对象存储（S3 / OSS / 自建 MinIO）放原包、签名包、截图等大文件，Redis 兼任任务队列和缓存。

## 签名与一键安装流程详细步骤是：运营或 CI 上传原包到对象存储；前端选好证书和 Profile 后提交签名任务，平台先校验证书有效期、Profile 是否覆盖目标 bundleId 和 UDID 列表；任务进入 Redis 队列后由 worker 拉取，调用 zsign 或者 xcodebuild 出签名包；签名完写入对象存储，平台同时生成 manifest.plist 和带短期 token 的下载链接，再生成 itms-services://?action=download-manifest&url=https://... 的二维码；测试设备扫码（或在 Safari 里点链接）触发系统弹窗，用户确认后开始下载安装。

重签走的是同一条流水线，输入换成已签名 IPA，输出换证书。同 IPA + 同资源指纹的签名做幂等缓存，重复请求直接返回上次的产物。

## ASC 同步

跟 App Store Connect 是双向：拉取侧定时增量拉 TestFlight 构建（Build 状态从 PROCESSING 到 VALID 这段时间会比较长，建议结合 Apple 的 Webhook 而非纯轮询）、外部测试组成员、内外测分发状态、App Store 版本审核状态和审核反馈；推送侧是在控制台改的元数据（描述、关键词、What's New、各语言截图、价格层级）一键提交 ASC，省去切回 ASC 网页的来回。如果团队也用 fastlane，pilot 和 deliver 这两块可以直接复用，平台只做封装和审计。

## 技术选型建议

后端用 Go 或 Java 都行，签名调度本身并发不高，Go 写 worker 比较顺手；队列先用 Redis Stream 起步，量大了再换 Kafka；签名机 zsign 跑 Linux Docker（x86_64 即可），Xcode 通道用 mac mini 物理机或 EC2 mac 实例挂在自研 agent 上；前端 Vue 或 React + Ant Design Pro / Element Plus 做后台，OTA 安装页单独一个 H5 子工程；对象存储自建 MinIO 或者云上 OSS / S3 都可以；密钥（p12、p8）必须走 KMS 或者 Vault 加密存储，绝对不要明文落库；下载链接用短期签名 URL，控制台所有签名/下发动作都进审计日志。

## 几个坑要提前规避

zsign 改不了 entitlements，也加不了 Push、Network Extension、Associated Domains 这些能力，遇到要走 Xcode 通道用 codesign。OTA 安装页和 manifest 里的 url 都必须是有效证书的 HTTPS，自签证书 iOS 不认。ASC API 有速率限制，要做指数退避，TF 构建处理时间是几分钟到几十分钟级，最好用 Webhook 通知而不是轮询。iOS 16.4 之后开发者签的包要用户在系统设置里打开"开发者模式"才能装，安装页要带这个引导说明。证书快过期时（一般提前 7-14 天）自动批量重签存量包并通知关联团队，否则用户打开 App 会闪退。设备 UDID 注册有 100 台/年的硬上限（个人开发者账号），企业账号不限设备但有自己的合规要求，资源中心要显式分账号管理。

需要我继续展开成完整的设计文档（数据库表、API 列表、签名 worker 的状态机、ASC OAuth/JWT 流程时序图）吗？或者直接写一个最小可运行的 zsign worker + manifest 生成的 demo 也可以。
