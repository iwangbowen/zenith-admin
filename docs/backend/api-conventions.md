# API 规范

后端所有路由统一挂载在 `/api` 前缀下，并遵循一致的响应与校验规则。

## 统一响应格式

成功响应：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

失败时 `code` 为非零值，并包含明确的错误信息。

## 分页返回格式

所有列表接口返回 `PaginatedResponse<T>`：

```json
{
  "list": [],
  "total": 100,
  "page": 1,
  "pageSize": 10
}
```

## 认证方式

项目采用 **Access Token + Refresh Token 双 token** 机制：

| Token | 存储 Key | 说明 |
|-------|----------|------|
| Access Token | `zenith_token` | 短期 token，附在每次请求头中 |
| Refresh Token | `zenith_refresh_token` | 长期 token，用于在 Access Token 过期时自动续期 |

需要认证的请求需携带：

```http
Authorization: Bearer <access_token>
```

当 Access Token 过期时，前端 `request.ts` 会自动携带 Refresh Token 向后端换取新的 Access Token，对业务代码透明。

认证中间件会在上下文中注入用户信息，供后续权限判断使用。

## 参数校验

所有入参必须通过 `schema.safeParse()` 进行校验。

校验失败时，应返回：

```json
{
  "code": 400,
  "message": "参数错误"
}
```

## 路由组织建议

- 按资源拆分到 `packages/server/src/routes/`
- 保持资源命名直观，如 `users.ts`、`roles.ts`、`dicts.ts`
- 和前端页面、共享 schema 尽量保持一一对应，便于排查问题

## 共享约定

- 类型统一放到 `@zenith/shared/src/types.ts`
- Zod schema 统一放到 `@zenith/shared/src/validation.ts`
- 枚举和常量统一放到 `@zenith/shared/src/constants.ts`
