# API 文档

基础路径：`/api`  
认证方式：基于 Cookie 的 Session，登录成功后服务端会下发 `session_id`。

## 通用返回

- 成功：HTTP 2xx + JSON
- 失败：HTTP 4xx/5xx + `{ "error": "..." }`

## 注册

**POST** `/api/register`

请求体：
```json
{
  "username": "johndoe",
  "email": "john@example.com",
  "password": "password123"
}
```

成功响应：
```json
{
  "message": "注册成功",
  "user_id": "xxxx",
  "username": "johndoe"
}
```

## 登录

**POST** `/api/login`

请求体：
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

成功响应：
```json
{
  "message": "登录成功",
  "user_id": "xxxx",
  "username": "johndoe"
}
```

## 登出

**POST** `/api/logout`

成功响应：
```json
{
  "message": "已成功退出登录"
}
```

## 获取当前用户

**GET** `/api/me`

成功响应：
```json
{
  "user_id": "xxxx",
  "username": "johndoe"
}
```

## 新建 Markdown 记录

**POST** `/api/markdown`

请求体：
```json
{
  "title": "Demo Note",
  "content": "# 标题\\n\\n正文内容"
}
```

成功响应：
```json
{
  "message": "保存成功",
  "id": 1,
  "file": "data/markdown/xxx.md",
  "username": "johndoe"
}
```

## 分页获取 Markdown 记录

**GET** `/api/markdown?limit=10&offset=0`

成功响应：
```json
{
  "entries": [
    {
      "id": 1,
      "user_id": "xxxx",
      "title": "Demo Note",
      "file_path": "data/markdown/xxx.md",
      "uploaded_at": "2026-03-18T00:00:00Z"
    }
  ],
  "has_more": true,
  "next_offset": 10
}
```

## 读取 Markdown 记录

**GET** `/api/markdown/:id`

成功响应：
```json
{
  "entry": {
    "id": 1,
    "user_id": "xxxx",
    "title": "Demo Note",
    "file_path": "data/markdown/xxx.md",
    "uploaded_at": "2026-03-18T00:00:00Z"
  },
  "content": "# 标题\\n\\n正文内容"
}
```

## 更新 Markdown 记录

**PUT** `/api/markdown/:id`

请求体：
```json
{
  "title": "新标题",
  "content": "# 新标题\\n\\n更新内容"
}
```

成功响应：
```json
{
  "message": "更新成功",
  "id": 1
}
```

## 删除 Markdown 记录

**DELETE** `/api/markdown/:id`

成功响应：
```json
{
  "message": "删除成功"
}
```
