# 重大会议活动智能体系统 · 开发计划 v0.1

> 起点: Polar `main` (含 PR #23 流式聊天 + PR #24 Video Studio + 编辑器 drawer/modal)
> 范围: **仅开发**, 不含等保 / 部署 / 培训 / 销售
> 起算: 2026-05-05 (W1)
> 节奏: 12 个 sprint × 2 周 = 24 周 (≈ 5.5 月)

---

## 1. 现状盘点 · Polar 已具备的可复用能力

| 能力 | 代码位置 | 复用到目标方案 |
| --- | --- | --- |
| 用户 / 组织 / RBAC / Passkey / Refresh Token | `internal/app/dock/{auth,user,bot}_*.go` | 团队角色, 三级组织树 (3.1.2) |
| 聊天线程 + LLM 调度 + WS 流式 | `chat_handlers.go`, `ai_agent_stream.go`, `ws_hub.go` | 智能咨询 (4.1) + 智能体执行 (5.2) |
| Bot users + LLM 配置 (provider_kind) | `llm_bot_handlers.go`, `llm_configs` | Agent 注册 / 路由载体 (5.3) |
| Markdown 编辑 (drawer + modal) | `ui/src/editor.ts`, `posts/markdowns` | 方案 (3.1.1) / 总结材料 (3.4.25) |
| 文件 / 对象存储抽象 (R2 + 本地) | `storage` interface | 物料 / 嘉宾文件 (3.1.6, 3.2.9) |
| WS 实时推送 (event-type 多路) | `ws_hub.go`, `video_events.go` 模式 | 事件总线 / 大屏 / 通知 |
| Video Studio (Seedance + ffmpeg + 角色参考) | `video_*.go` | 暂不直接映射, 后期作为成果生成路径 |
| iOS 壳 (外仓 networkextension/Polar) | 外部 | 移动端管理后台壳 |
| eval bundle 一键启动 | `release.sh`, `ui/server.js` | 客户演示 / PoC 环境 |

---

## 2. Gap 分析 · 需新建

### 2.1 业务域 (空白)
- `meetings` / `agendas` / `agenda_items`
- `guests` / `guest_profiles` / `guest_check_in`
- 资源池: `hotels` / `rooms` / `vehicles` / `drivers` / `meals` / `tables` / `materials`
- `seat_layouts` (matrix / round_table 拓扑) + `seat_assignments`
- `risk_register` / `tasks_meeting` (与现有 todo 区分)
- `surveys` / `survey_responses`
- `kb_collections` / `kb_documents` (RAG 库)

### 2.2 算法引擎 (全新)
| 引擎 | 选型 | 实现位置 |
| --- | --- | --- |
| 排座 ≤60 (CP-SAT) | OR-Tools | Python 子进程 + gRPC |
| 排座 60-500 (SA) | 自研 SA | Python |
| 排座 >500 (聚类→分桌→桌内 SA) | sklearn + SA | Python |
| 匹配 (Hungarian) | scipy.optimize 或 Go 实现 | Go (主进程) |
| RAG 问答 | Qdrant + bge-m3 (ONNX) + bge-reranker | Go 主进程, 调外部 LLM |
| 报告生成 | 模板槽位 + LLM 叙述 | Go (复用现有 LLM 调用层) |
| 数据洞察 | statsmodels (STL/IQR) + mlxtend (FP-Growth) | Python |
| RPA 编排 | n8n (self-host) + 自定义 webhook 节点 | n8n + Go adapter |
| Agent 编排 | 自研轻量 DAG (yaml + ToolRegistry + Redis state + OTel) | Go |

### 2.3 端 (全新)
- 嘉宾 H5 (在 ui/ 多入口加页, 不另建仓)
- 大屏驾驶舱 SPA (`ui/dashboard-tv/`)
- Android 客户端 (KMP, 二期可降级)

---

## 3. 模块依赖图

```
Spr 1  域模型 + DDL
        │
        ├──→ Spr 2  会前模块 (方案/任务/风险)
        │
        ├──→ Spr 3  嘉宾模块 (导入/画像/H5 雏形)
        │       │
        │       └──→ Spr 6  RAG 知识库 + 智能咨询
        │
        ├──→ Spr 4  资源池 + 匹配 PoC
        │       │
        │       └──→ Spr 5  排座算法 PoC ──┐
        │                                    │
        ├──→ Spr 7  议程 + 签到 + 同传 ────┤
        │                                    │
        ├──→ Spr 8  报告生成 + 数据洞察 ───┤
        │                                    │
        └──→ Spr 9  Agent 编排 + RPA ──────┤
                                              │
                Spr 10  大屏驾驶舱 + 现场指挥 ┘
                Spr 11  移动端 + E2E 联调
                Spr 12  试点 + 性能压测 + 修复
```

**关键路径**: Spr 1 (域模型) → Spr 5 (排座 PoC) → Spr 9 (Agent 编排) → Spr 11 (E2E)。
任意一环延误 ≥ 1 sprint, 砍 P2 范围 (见 §6.10 砍线表) 而不是延总工期。

---

## 4. 时间线

按 2 周 sprint, W1 = 2026-05-05 周一。

| Spr | 周 | 起止 | 主题 | 关键交付 |
| --- | --- | --- | --- | --- |
| 1 | W1-2 | 5/5-5/16 | 域模型 + 骨架 | meetings/guests/resources/agendas/seats 全 schema, 仓储层接口签名, polar_adapter, CI 加新目录 |
| 2 | W3-4 | 5/19-5/30 | 会前模块 | 方案编辑 (复用 markdown), 任务派发 (复用 todo 加会议域字段), 风险点台账, 倒计时看板 |
| 3 | W5-6 | 6/2-6/13 | 嘉宾模块 | Excel 批量导入 (含字段智能映射), 名片 OCR (调外部 / Tesseract fallback), 画像页, 接送机, 日程卡 H5 v1 |
| 4 | W7-8 | 6/16-6/27 | 资源池 + 匹配 PoC | 酒店/车辆/餐饮 CRUD, Hungarian 接口跑通, 软硬约束建模 |
| 5 | W9-10 | 6/30-7/11 | 排座 PoC | OR-Tools 60 人精确解, SA 500 人解, SVG 拖拽前端, 礼宾规则 DSL |
| 6 | W11-12 | 7/14-7/25 | RAG + 智能咨询 | Qdrant 部署, bge-m3 ONNX 嵌入, 权限隔离检索, 嘉宾 H5 问答闭环 |
| 7 | W13-14 | 7/28-8/8 | 议程 + 签到 + 同传 | 多版本议程, 扫码/NFC 签到 (人脸延后到二期), 译员频道, 议程变更广播 |
| 8 | W15-16 | 8/11-8/22 | 报告 + 数据洞察 | 模板槽位 + LLM 叙述, 数字一致性校验, 一键导出 Word/PDF, STL+IQR 异常检测 |
| 9 | W17-18 | 8/25-9/5 | Agent 编排 + RPA | 规划/执行/质检三智能体, n8n 接入, 4 类 RPA 链 (航班/低分回访/抵达/超时) |
| 10 | W19-20 | 9/8-9/19 | 大屏驾驶舱 + 现场指挥 | 三屏联动 SPA, 工单流转, 应急 SOP, 工作人员对讲集成 |
| 11 | W21-22 | 9/22-10/3 | 移动端 + 联调 | iOS 加会议中心 tab, Android KMP 起步, 会前-会中-会后 E2E |
| 12 | W23-24 | 10/6-10/17 | 试点 + 压测 + 修复 | 1 场真实会议演练, 2000 并发压测, 全 P0 缺陷清零 |

> **缓冲**: 每 sprint 末第 5 个工作日为 buffer / bug fix, 不安排新功能。
> **demo gate**: 每 sprint 末必须有可点的 demo, 否则 sprint 不算关闭。

---

## 5. 算法 PoC 优先级

| 引擎 | PoC 周期 | 启动周 | 验收线 |
| --- | --- | --- | --- |
| 匹配 (Hungarian) | 1 周 | W7 | 100×100 二部图 < 1s, 软硬约束生效 |
| RAG 问答 | 2 周 | W11 | 100 文档命中, 引文核验, 权限隔离正确 |
| 排座 ≤60 | 2 周 | W9 | 60 人精确解 < 30s, 礼宾规则全覆盖 |
| 排座 60-500 | 3 周 | W9 (并行) | 500 人解 < 2 min, 解质量 ≥ 人工基线 95% |
| 报告生成 | 1 周 | W15 | 数字一致性零错, 1 篇真会议样本评审通过 |
| 数据洞察 | 1 周 | W15 | STL 趋势 + IQR 离群 + FP-Growth top-10 关联 |
| RPA 链 4 类 | 2 周 | W17 | 4 链端到端, 失败重试 + 审计完整 |
| Agent 编排 | 持续 | W1 起持续打磨 | DAG/Tool/Trace/超时熔断/人在回路全闭环 |

**最高风险两项**: 排座 SA (调参) + Agent 编排 (自研框架)。两者均设 W10 / W18 末的 review gate, 不达标走 §6.10 砍线表。

---

## 6. 关键技术决策

1. **代码组织**: 新建 `internal/app/dock/meeting/` 子包, 不污染现有 dock 平面。Schema 集中在 `meeting/schema.go`, 仓储 `meeting/store.go`, handlers `meeting/handlers_*.go`。
2. **算法子进程**: Go 主进程 + Python 算法子进程, gRPC over unix socket。Python 进程由 Go supervisor 守护 + 健康检查 + 超时熔断。
3. **Agent 编排**: 不引入 LangGraph。自研 ≤ 1500 行 Go 框架: yaml DAG 定义 + ToolRegistry + Redis state store + OTel trace。理由: Go/Python 互通成本太高; 自研对调试 + 审计 + 工具白名单完全可控。
4. **RAG**: Qdrant 单节点起步, bge-m3 ONNX 在 Go 主进程内调用 (避免 Python 来回); 大模型走现有 `llm_configs`, 新增 `provider_kind=rag.local` / `rag.api` 两值。
5. **嘉宾 H5**: 复用 `ui/` monorepo, 新建 `ui/public/guest-portal.html` + `ui/src/guest-portal.ts` 多入口。esbuild 已支持。微信 / 短信下发抽象到 `internal/notify/{wechat,sms}/`。
6. **大屏驾驶舱**: 同 monorepo, `ui/dashboard-tv/` 独立 SPA, 共享 `ui/src/api/*` 和类型。可视化用 D3 + 自研 (与 Polar 主体一致, 不引 ECharts)。
7. **移动端**: iOS 在外仓 `networkextension/Polar` 加会议中心 tab, 复用现有 SSO + WS + IM。Android 用 KMP 复用 iOS 领域层, UI 重写。**Android 列为 P2, 一期可降级到只交付 iOS + H5**。
8. **WS 总线**: 在 `ws_hub.go` 上加 `RegisterEventType(name, handler)` 注册表, 业务模块不再借 chat 通道。video_studio 已经是这种用法, 复制模式即可。
9. **测试金字塔**:
   - 仓储层 100% 覆盖, testcontainers PG/Redis/Qdrant
   - 算法 case-driven, fixture 数据集放 `testdata/meetings/`
   - 编排 / e2e: 1 个完整 fixture 会议 (200 嘉宾, 80 桌, 3 天议程)
   - 前端: 关键流程 Playwright, 不追求全覆盖
10. **CI**: 现有 GitHub Actions 加 `make test-meeting` (含算法 benchmark 跟踪回归), 排座 SA 解质量进 CI 监控曲线。
11. **i18n**: 新页面遵循 `feedback_response_terseness` 与 i18n key 现有命名 (`meeting.*` / `guest.*` / `seat.*`); 中英双语同步。
12. **主题 / 页面初始化**: 每个 ui 页面入口必须 `initStoredTheme() + bindThemeSync()` (见 `project_ui_page_init_checklist`)。

### 6.10 砍线表 (任一关键路径延 ≥ 1 sprint 时启用)

| 砍线优先级 | 项 | 影响 |
| --- | --- | --- |
| L1 (先砍) | Android 客户端 | iOS + H5 兜底 |
| L2 | 大屏 D3 自研 → 改用 ECharts | 包体大但快 1-2 周 |
| L3 | 排座 >500 人聚类分桌 | 改为 SA 直跑 + 大于 500 时人工分桌 |
| L4 | 数据洞察 FP-Growth | 仅留 STL + IQR |
| L5 | 名片 OCR | 仅 Excel 导入 |
| L6 | 译员频道 | 改外部第三方 |

---

## 7. 工时估算 (开发净人月)

| 角色 | 人数 | 投入 (人月) | 备注 |
| --- | --- | --- | --- |
| 后端 Go (业务 + 编排) | 4 | 22 | 1 人专注 Agent 编排 |
| 算法 (Python + Go binding) | 2 | 11 | 1 排座 + 1 通用 |
| 前端 Web (后台 + 大屏) | 2 | 11 | 1 后台 + 1 大屏 |
| 嘉宾 H5 + iOS | 2 | 11 | 共用领域层 |
| Android | 1 | 5.5 | 可砍 |
| **合计** | **11** | **60.5 人月** |

**外加 (本计划不覆盖)**: PM 1 + 测试 1-2 + 安全 / DevOps 1 = 3-4 人。

---

## 8. 风险 (开发视角)

| 风险 | 概率 | 影响 | 应对 |
| --- | --- | --- | --- |
| 排座 SA 不收敛 / 解质量差 | 中 | 高 | W10 demo gate, 不达标降级到分桌内精确解 |
| Agent 编排自研失控 | 中 | 高 | W18 gate, 不达标切到极简模板 + 人工审 |
| Polar main 接口变动 | 低 | 中 | 全部 Polar 调用过 `meeting/polar_adapter.go` 隔离 |
| Python 子进程稳定性 | 低 | 中 | supervisor + 健康检查 + 超时熔断 + 自动重启 |
| 嘉宾 H5 + 微信对接拖延 | 中 | 中 | Spr 6 末跑通真实嘉宾 demo, 否则降级 SMS |
| 移动端双端工时穿底 | 高 | 中 | Android 列 P2, 早决定砍 / 留 |
| RAG 检索效果不达 85% 自助率 | 中 | 中 | 加 LLM rerank + 多路召回; 真不行就低置信度转人工 |
| testcontainers CI 慢 | 低 | 低 | 拆 fast / slow lane, slow 仅 main 触发 |

---

## 9. 验收 (开发完成判定)

W24 末:
- [ ] 36 项功能可点开各自最小路径 (CRUD + 主流程), 无 P0 缺陷
- [ ] 7 算法引擎单测 ≥ 90% 行覆盖, 集成测试达 §5 验收线
- [ ] 1 场真实数据集 E2E 演练通过 (200 嘉宾 / 80 桌 / 3 天议程)
- [ ] OpenAPI / Swagger 接口 100% 覆盖, 含错误码表
- [ ] main 分支 CI 全绿, 含算法 benchmark
- [ ] 性能: 问答 P95 ≤ 3s, 排座 500 ≤ 2 min, WS 推送 P95 ≤ 200ms
- [ ] 自动化 E2E 用例 ≥ 30 个

> 注: 等保 / 安全测评 / 培训 / 部署交付**不在本验收范围**, 由独立计划承接。

---

## 10. W1 立即开工清单

1. 拉新分支 `feat/meeting-foundation` (从 main, 在 PR #24 合并后)
2. 锁版本本文档到 `doc/meeting-agent-dev-plan.md` (本文件), 在 PR 中评审通过后开干
3. 创建 `internal/app/dock/meeting/{schema,models,store,polar_adapter}.go` 骨架
4. 起草 `internal/app/dock/meeting/api.md`, 列出 W1-W2 要落地的 30 个 endpoint 签名
5. 选定算法子进程协议: gRPC + protobuf vs HTTP + JSON。**默认 gRPC**, 1 个 hello-world 跑通
6. CI: `Makefile` 加 `test-meeting` target; GitHub Actions matrix 加该子目录
7. 起一份 `meeting/README.md` 写明子模块定位与子包边界
8. **排座算法**: 同步在算法仓 (新建 `algo/seat_planner/`) 起 OR-Tools hello-world, 跑通 4 人主席台样例

---

> 本计划仅覆盖**开发**, 与"重大会议活动智能体系统_技术方案_v3"中的 §7 (等保) / §11 (资源部署) 解耦。等保整改 / 测评 / 部署 / 培训 / 试点上线另立计划承接, 并行进行。
