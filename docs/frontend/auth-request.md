# 认证与请求

这一页说明前端如何维护登录态，以及请求层如何与后端接口协作。

## 登录态管理

- 通过 `useAuth` hook 管理认证状态
- token 存储在 `localStorage`
- 存储 key 为 `zenith_token`（来自 `@zenith/shared` 常量）

## 请求封装

前端 HTTP 请求统一封装在：

`packages/web/src/utils/request.ts`

主要职责：

- 自动附加 Bearer Token
- 统一处理接口响应
- 在 401 场景下跳转登录页

## 与后端的协作方式

### 请求头

需要认证的请求应自动带上：

```http
Authorization: Bearer <token>
```

### 响应读取

优先按统一响应格式读取：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

### 共享类型

接口类型、实体定义和校验 schema 尽量复用 `@zenith/shared`，避免前后端各写一套。

## 开发建议

- 新增接口前，先确认是否已有共享类型或校验 schema
- 对需要登录的页面，优先复用现有登录态与跳转机制
- 请求错误处理尽量集中在封装层，不把每个页面都写成“各自为战”
