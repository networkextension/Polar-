# 零工任务模块设计与 API

本文整理当前零工任务模块的业务设计、核心对象、状态流转与 HTTP API，便于 Web、iOS 与后端继续迭代。

## 1. 设计目标

零工任务模块复用现有「帖子 + 私聊」能力，不单独开辟平行内容系统：

- 任务本质上仍然是一个帖子，只是 `post_type = "task"`。
- 任务发布时补充时间范围、`working_hours`、申请截止时间、可选地理位置等任务字段。
- 申请、撤销申请、关闭申请、选择候选人属于任务专属动作。
- 发布者确认候选人后，会复用现有私聊系统自动发送一条模板消息。

这样设计的好处：

- 帖子广场天然具备任务曝光能力。
- 帖子详情页可直接承载申请动作。
- 不需要维护第二套内容发布、详情、互动与通知基础设施。

## 2. 核心对象

## 2.1 Post（任务帖）

当 `post_type = "task"` 时，`post` 对象代表一个零工任务。

字段 | 说明 | 类型
--- | --- | ---
id | 帖子 ID | number
user_id | 发布者用户 ID | string
username | 发布者用户名 | string
post_type | 帖子类型，任务帖固定为 `task` | string
content | 任务正文描述 | string
created_at | 发布时间 | string (ISO8601)
images | 图片列表 | string[]
videos | 视频列表 | string[]
task | 任务扩展信息 | object

## 2.2 TaskPost（任务扩展信息）

字段 | 说明 | 类型
--- | --- | ---
post_id | 对应帖子 ID | number
location | 可选地理位置 | string
start_at | 任务开始时间 | string (ISO8601)
end_at | 任务结束时间 | string (ISO8601)
working_hours | 工作时长/班次说明 | string
apply_deadline | 申请截止时间 | string (ISO8601)
application_status | 申请状态，`open` 或 `closed` | string
selected_applicant_id | 已选候选人 ID | string \| null
selected_applicant_name | 已选候选人用户名 | string \| null
selected_at | 选择候选人时间 | string \| null
invitation_template | 发送给候选人的私信模板 | string
invitation_sent_at | 模板消息发送时间 | string \| null
applicant_count | 当前有效申请人数 | number
applied_by_me | 当前登录用户是否已申请 | boolean
can_apply | 当前登录用户是否允许申请/撤销 | boolean
can_manage | 当前登录用户是否为发布者 | boolean

## 2.3 TaskApplication（任务申请）

字段 | 说明 | 类型
--- | --- | ---
id | 申请 ID | number
post_id | 任务帖 ID | number
user_id | 申请者用户 ID | string
username | 申请者用户名 | string
user_icon | 申请者头像 | string
applied_at | 申请时间 | string (ISO8601)

## 3. 数据表设计

当前服务端新增了两张任务相关表：

### 3.1 `task_posts`

- `post_id BIGINT PRIMARY KEY`
- `location TEXT`
- `start_at TIMESTAMPTZ`
- `end_at TIMESTAMPTZ`
- `working_hours TEXT`
- `apply_deadline TIMESTAMPTZ`
- `application_status TEXT DEFAULT 'open'`
- `selected_applicant_id TEXT NULL`
- `selected_at TIMESTAMPTZ NULL`
- `invitation_template TEXT`
- `invitation_sent_at TIMESTAMPTZ NULL`

### 3.2 `task_applications`

- `id BIGSERIAL PRIMARY KEY`
- `post_id BIGINT`
- `user_id TEXT`
- `applied_at TIMESTAMPTZ`
- `withdrawn_at TIMESTAMPTZ NULL`

说明：

- 有效申请定义为 `withdrawn_at IS NULL`。
- 同一用户对同一任务在同一时间只能存在一条有效申请。
- 撤销申请不会删除记录，而是写入 `withdrawn_at`，便于保留申请历史。

## 4. 业务规则

### 4.1 发布者侧

- 发布者可以发布普通帖子，也可以发布任务帖。
- 任务帖必须填写：
  - `content`
  - `task_start_at`
  - `task_end_at`
  - `working_hours`
  - `apply_deadline`
- `task_location` 可为空。
- `apply_deadline` 必须早于 `task_start_at`。
- 发布者可以在任何时间主动关闭申请。
- 发布者只能从当前有效申请者中选择候选人。
- 发布者确认候选人后，系统会：
  - 将任务申请状态改为 `closed`
  - 记录候选人信息
  - 通过私聊系统向候选人发送模板消息

### 4.2 申请者侧

- 申请者可以浏览任务帖并发起申请。
- 已申请用户可以撤销申请。
- 发布者不能申请自己发布的任务。
- 如果任务已关闭，或申请截止时间已过，则不能新申请。
- 如果用户已经申请，则仍允许撤销，直到候选人最终被选定。

### 4.3 私信模板

- 发布者确认候选人时，可传入自定义 `message_template`。
- 如果未传模板，服务端会生成默认模板：
  - 包含任务正文
  - 包含任务时间范围
  - 包含 `working_hours`
- 私信通过现有 chat thread 发送，不新增新的通知通道。

## 5. 状态流转

### 5.1 任务申请状态

状态 | 说明
--- | ---
open | 可继续申请
closed | 已关闭申请，不再接受新申请

进入 `closed` 的场景：

- 发布者手动关闭申请
- 发布者已选定候选人

### 5.2 申请状态

状态 | 判定方式
--- | ---
有效申请 | `withdrawn_at IS NULL`
已撤销申请 | `withdrawn_at IS NOT NULL`

## 6. HTTP API

基础路径：`/api`

认证方式：

- 所有任务接口都要求已登录。
- 未登录访问 `/api/*` 会返回 `401` JSON，而不是跳转页面。

## 6.1 发布任务帖

`POST /api/posts`

请求类型：`multipart/form-data`

普通帖子与任务帖共用此接口，发布任务帖时需传入：

字段 | 必填 | 说明
--- | --- | ---
post_type | 是 | 固定传 `task`
content | 是 | 任务正文
task_location | 否 | 任务地点
task_start_at | 是 | 任务开始时间，RFC3339
task_end_at | 是 | 任务结束时间，RFC3339
working_hours | 是 | 工作时长或班次说明
apply_deadline | 是 | 申请截止时间，RFC3339
images | 否 | 图片文件数组
videos | 否 | 视频文件数组

示例：

```bash
curl -X POST http://localhost:3000/api/posts \
  -b cookie.txt \
  -F post_type=task \
  -F content='周末商场活动需要 2 名兼职' \
  -F task_location='上海徐汇' \
  -F task_start_at='2026-03-28T09:00:00+08:00' \
  -F task_end_at='2026-03-28T18:00:00+08:00' \
  -F working_hours='9:00-18:00，共 8 小时' \
  -F apply_deadline='2026-03-27T20:00:00+08:00'
```

成功响应：

```json
{
  "message": "发布成功",
  "id": 101,
  "post_type": "task",
  "images": [],
  "videos": [],
  "video_items": [],
  "content": "周末商场活动需要 2 名兼职",
  "created": "2026-03-23T09:00:00+08:00"
}
```

## 6.2 获取帖子列表

`GET /api/posts?limit=10&offset=0`

任务帖会在普通帖子字段之外，附带 `task` 对象。

示例响应片段：

```json
{
  "posts": [
    {
      "id": 101,
      "user_id": "u_001",
      "username": "Alice",
      "post_type": "task",
      "content": "周末商场活动需要 2 名兼职",
      "created_at": "2026-03-23T09:00:00+08:00",
      "liked_by_me": false,
      "like_count": 0,
      "reply_count": 0,
      "images": [],
      "videos": [],
      "task": {
        "post_id": 101,
        "location": "上海徐汇",
        "start_at": "2026-03-28T09:00:00+08:00",
        "end_at": "2026-03-28T18:00:00+08:00",
        "working_hours": "9:00-18:00，共 8 小时",
        "apply_deadline": "2026-03-27T20:00:00+08:00",
        "application_status": "open",
        "applicant_count": 3,
        "applied_by_me": false,
        "can_apply": true,
        "can_manage": false
      }
    }
  ]
}
```

## 6.3 获取任务帖详情

`GET /api/posts/:id`

如果该帖子是任务帖，则返回的 `post.task` 会带完整任务状态。

## 6.4 申请任务

`POST /api/tasks/:id/apply`

说明：

- `:id` 为任务帖 ID
- 请求体为空

成功响应：

```json
{
  "message": "申请成功"
}
```

常见错误：

- `400`：发布者不能申请自己的任务
- `404`：任务不存在
- `409`：任务已关闭或申请截止时间已过

## 6.5 撤销申请

`DELETE /api/tasks/:id/apply`

成功响应：

```json
{
  "message": "已撤销申请"
}
```

## 6.6 查看申请者列表

`GET /api/tasks/:id/applications`

权限要求：仅任务发布者可访问。

成功响应：

```json
{
  "applications": [
    {
      "id": 9001,
      "post_id": 101,
      "user_id": "u_018",
      "username": "Bob",
      "user_icon": "/uploads/icon_xxx.png",
      "applied_at": "2026-03-23T12:00:00+08:00"
    }
  ]
}
```

## 6.7 关闭申请

`POST /api/tasks/:id/close`

权限要求：仅任务发布者可访问。

成功响应：

```json
{
  "message": "已关闭申请"
}
```

## 6.8 选择候选人并发送私信

`POST /api/tasks/:id/select-candidate`

权限要求：仅任务发布者可访问。

请求体：

```json
{
  "applicant_user_id": "u_018",
  "message_template": "你好，你已被选为该零工任务候选人。如果确认参与，请直接回复我。"
}
```

说明：

- `applicant_user_id` 必填，且必须是当前有效申请者。
- `message_template` 可为空；为空时服务端会生成默认模板。
- 成功后任务会自动关闭申请。
- 服务端会复用现有私聊线程，将模板消息作为一条 chat message 发出。

成功响应：

```json
{
  "message": "候选人已确认，私信已发送",
  "chat_id": 12,
  "message_id": 88,
  "message_template": "你好，你已被选为该零工任务候选人。如果确认参与，请直接回复我。"
}
```

## 7. 前端交互建议

### 7.1 发布页（`post.html`）

- 增加类型切换：
  - 普通帖子
  - 零工任务
- 选择“零工任务”后展示：
  - 地理位置
  - 开始时间
  - 结束时间
  - `working_hours`
  - 申请截止时间

### 7.2 帖子广场（`posts.html`）

- 对任务帖展示任务摘要：
  - 时间范围
  - `working_hours`
  - 申请截止时间
  - 当前申请人数

### 7.3 任务详情页（`post.html?id=:id`）

- 申请者看到：
  - 申请按钮
  - 已申请时展示“撤销申请”
- 发布者看到：
  - 关闭申请按钮
  - 查看申请者按钮
  - 每位申请者下方展示可编辑私信模板输入框
  - “确认并发送私信”按钮

## 8. 错误码约定

HTTP 状态码 | 含义 | 典型场景
--- | --- | ---
400 | 参数错误 | 缺少 `working_hours` 或时间格式错误
401 | 未登录 | Cookie 无效或 session 过期
403 | 权限不足 | 非发布者查看申请者列表
404 | 资源不存在 | 任务 ID 不存在
409 | 状态冲突 | 已关闭申请、截止时间已过、候选人非法
500 | 服务器错误 | 数据库或私聊发送异常

## 9. 与私聊系统的关系

任务模块不维护自己的站内信表，而是直接接入现有 chat：

1. 发布者确认候选人
2. 服务端 `ensureChatThread`
3. 服务端 `createChatMessage`
4. 候选人在私聊页看到一条新消息

因此：

- 任务通知天然拥有消息历史
- 后续候选人与发布者可直接在原线程继续沟通
- 前端不需要为“任务通知”再维护独立消息中心

## 10. 后续可扩展方向

- 增加任务专属列表页与筛选条件
- 增加“任务进行中 / 已完成 / 已取消”履约状态
- 增加候选人确认接口，而不仅是私聊回复
- 增加申请备注、报价、联系方式等字段
- 增加任务举报、任务下架与管理员审核流
