# 用户 Profile 与 Recommendation 设计

本文整理当前用户 Profile 页面、资料字段、Recommendation 机制，以及和零工任务模块的关系，方便 Web、iOS 与后端继续迭代。

## 1. 设计目标

Profile 模块的目标是让用户在站内拥有可被查看的“个人名片”，用于：

- 展示头像、自我介绍、注册时间等基础信息
- 展示其他用户对 TA 的 Recommendation
- 在零工任务场景下，帮助发布者更快判断候选人是否可靠

当前设计遵循以下原则：

- 自己看自己时，重点是“完善资料”
- 看别人时，重点是“查看资料 + 写 Recommendation”
- Profile 作为任务模块的配套能力，头像和用户名可直接跳转

## 2. 核心对象

## 2.1 User 基础资料

用户资料目前基于 `users` 表扩展得到。

字段 | 说明 | 类型
--- | --- | ---
id | 用户 ID | string
username | 用户名 | string
icon_url | 头像地址 | string
bio | 自我介绍 | string
created_at | 注册时间 | string (ISO8601)

## 2.2 UserProfileDetail

用于 Profile 页面接口返回。

字段 | 说明 | 类型
--- | --- | ---
user_id | 用户 ID | string
username | 用户名 | string
icon_url | 头像地址 | string
bio | 自我介绍 | string
created_at | 注册时间 | string (ISO8601)
is_me | 当前查看者是否为本人 | boolean
can_recommend | 当前查看者是否可写 Recommendation | boolean
recommendations | Recommendation 列表 | ProfileRecommendation[]

## 2.3 ProfileRecommendation

字段 | 说明 | 类型
--- | --- | ---
id | Recommendation ID | number
target_user_id | 被推荐用户 ID | string
author_user_id | 推荐人用户 ID | string
author_username | 推荐人用户名 | string
author_user_icon | 推荐人头像 | string
content | Recommendation 内容 | string
created_at | 首次创建时间 | string (ISO8601)
updated_at | 最近更新时间 | string (ISO8601)

## 3. 数据表设计

## 3.1 `users`

在现有用户表上新增：

- `bio TEXT NOT NULL DEFAULT ''`

## 3.2 `profile_recommendations`

- `id BIGSERIAL PRIMARY KEY`
- `target_user_id TEXT NOT NULL`
- `author_user_id TEXT NOT NULL`
- `content TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

索引与约束：

- `(target_user_id, author_user_id)` 唯一约束
- `target_user_id, updated_at DESC` 查询索引

说明：

- 同一个用户对同一个对象只保留一条 Recommendation
- 重复提交时，视为“更新原 Recommendation”

## 4. 业务规则

### 4.1 查看自己的 Profile

- 可以查看自己的头像、自我介绍、Recommendation 列表
- 可以修改自己的 `bio`
- 可以上传/更新自己的头像
- 不允许给自己写 Recommendation

### 4.2 查看他人的 Profile

- 可以查看对方头像、自我介绍、加入时间
- 可以查看对方收到的 Recommendation
- 可以给对方写 Recommendation
- 再次提交时会覆盖自己之前的 Recommendation

### 4.3 Recommendation 规则

- 内容不能为空
- 长度上限为 1000 字
- 不支持匿名
- 当前展示顺序按 `updated_at DESC`

## 5. 页面设计

## 5.1 页面地址

- 我的资料：`/profile.html`
- 查看他人资料：`/profile.html?user_id=<targetUserId>`

## 5.2 页面结构

页面由三块组成：

1. 资料头部
   - 头像
   - 用户名
   - 用户 ID
   - 注册时间
2. 自我介绍区
   - 本人查看时：可编辑
   - 他人查看时：只读展示
3. Recommendation 区
   - 他人查看时：显示提交表单
   - 所有人都可查看历史 Recommendation

## 5.3 Dashboard 入口

当前已在 dashboard 顶部加入：

- “我的 Profile” 入口

## 6. 与零工任务模块的关系

Profile 模块重点服务于任务匹配：

- 任务详情页中，发布者头像可点入 Profile
- 申请者列表中，每位候选人的头像与用户名可点入 Profile
- 任务成果列表中，执行者头像与用户名可点入 Profile

这样发布者在选择候选人时，可以结合以下信息判断：

- 自我介绍
- 过往 Recommendation
- 头像与基本资料

## 7. HTTP API

基础路径：`/api`

认证方式：

- 所有 Profile 接口都要求已登录
- 未登录访问返回 `401`

### 7.1 获取用户 Profile

`GET /api/users/:id/profile`

说明：

- `:id` 为目标用户 ID
- 返回完整 Profile 数据

成功响应：

```json
{
  "profile": {
    "user_id": "u_018",
    "username": "Bob",
    "icon_url": "/uploads/icon_u_018.png",
    "bio": "做过活动执行、打扫卫生、搬运协助类零工，周末时间比较灵活。",
    "created_at": "2026-03-21T09:00:00+08:00",
    "is_me": false,
    "can_recommend": true,
    "recommendations": [
      {
        "id": 1,
        "target_user_id": "u_018",
        "author_user_id": "u_001",
        "author_username": "Alice",
        "author_user_icon": "/uploads/icon_u_001.png",
        "content": "做事很靠谱，现场响应很快，沟通也顺畅。",
        "created_at": "2026-03-23T10:00:00+08:00",
        "updated_at": "2026-03-23T10:00:00+08:00"
      }
    ]
  }
}
```

### 7.2 更新自己的 Profile

`PUT /api/users/me/profile`

请求体：

```json
{
  "bio": "我擅长活动执行、临时搬运和打扫整理，周末全天可接单。"
}
```

说明：

- 当前接口只更新 `bio`
- 头像继续通过现有 `/api/user/icon` 上传接口更新

成功响应：

```json
{
  "message": "保存成功",
  "profile": {
    "user_id": "u_018",
    "username": "Bob",
    "icon_url": "/uploads/icon_u_018.png",
    "bio": "我擅长活动执行、临时搬运和打扫整理，周末全天可接单。",
    "created_at": "2026-03-21T09:00:00+08:00",
    "is_me": true,
    "can_recommend": false,
    "recommendations": []
  }
}
```

### 7.3 写入或更新 Recommendation

`POST /api/users/:id/recommendations`

请求体：

```json
{
  "content": "做事很认真，沟通及时，现场执行力不错。"
}
```

说明：

- `:id` 为被推荐用户 ID
- 不允许给自己写 Recommendation
- 同一推荐人再次提交时会覆盖之前内容

成功响应：

```json
{
  "message": "Recommendation 已保存",
  "profile": {
    "user_id": "u_018",
    "username": "Bob",
    "icon_url": "/uploads/icon_u_018.png",
    "bio": "做过活动执行、打扫卫生、搬运协助类零工，周末时间比较灵活。",
    "created_at": "2026-03-21T09:00:00+08:00",
    "is_me": false,
    "can_recommend": true,
    "recommendations": [
      {
        "id": 1,
        "target_user_id": "u_018",
        "author_user_id": "u_001",
        "author_username": "Alice",
        "author_user_icon": "/uploads/icon_u_001.png",
        "content": "做事很认真，沟通及时，现场执行力不错。",
        "created_at": "2026-03-23T10:00:00+08:00",
        "updated_at": "2026-03-23T12:00:00+08:00"
      }
    ]
  }
}
```

## 8. 错误码约定

HTTP 状态码 | 含义 | 场景
--- | --- | ---
400 | 参数错误 | `bio` 或 Recommendation 为空 / 超长
401 | 未登录 | Session 失效
404 | 用户不存在 | 目标用户不存在
500 | 服务器错误 | 数据库或服务异常

## 9. 后续可扩展方向

- 增加推荐标签，如“守时”“沟通顺畅”“执行力强”
- 增加任务完成次数、被选中次数等信誉指标
- 增加 Recommendation 删除或举报能力
- 增加更完整的履历字段，如擅长类别、可服务区域、可服务时间
