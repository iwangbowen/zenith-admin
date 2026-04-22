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

认证中间件会在上下文中注入用户信息，供后续权限判断使用：

```typescript
// 通过 authMiddleware 注入
const user = c.get('user'); // JwtPayload
```

## 参数校验

所有入参通过 `@hono/zod-openapi` 的 `createRoute` 中 `request.body / request.params / request.query` 定义的 Zod schema 自动校验，验证结果通过 `c.req.valid()` 读取。

校验失败时统一返回：

```json
{
  "code": 400,
  "message": "<Zod 校验错误信息>",
  "data": null
}
```

推荐写法：

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AuthEnv } from '../middleware/auth';
import { apiResponse, paginatedResponse, jsonContent, MessageResponse, ErrorResponse, PaginationQuery, validationHook, commonErrorResponses } from '../lib/openapi-schemas';

const xxxRouter = new OpenAPIHono<AuthEnv>({ defaultHook: validationHook });

// 路由内通过 c.req.valid() 取已验证的类型安全数据
xxxRouter.openapi(createRoute({
  method: 'post', path: '/',
  request: { body: { content: jsonContent(createXxxSchema), required: true } },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(XxxDTO)), description: 'ok' },
  },
}), async (c) => {
  const data = c.req.valid('json');  // 类型安全，已验证
  // ...
});
```

> `validationHook` 将 Zod 校验失败自动转为 `{ code: 400, message, data: null }` 标准格式，**创建 `OpenAPIHono` 实例时必须传入 `{ defaultHook: validationHook }`**。`commonErrorResponses` 已包含 400/401/403/404/500 标准错误码，所有路由的 `responses:` 块均需通过 `...commonErrorResponses` 展开。Zod schema 可直接从 `@zenith/shared/src/validation.ts` 导入（shared 已升级至 Zod v4），或在路由文件内本地声明。共享的辅助类型与工具函数位于 `packages/server/src/lib/openapi-schemas.ts`。

## 响应实体 DTO（中心化）

所有响应实体 DTO 统一定义在 `packages/server/src/lib/openapi-dtos.ts`，由各路由通过 `import { XxxDTO } from '../lib/openapi-dtos'` 引用：

```typescript
import { UserDTO, RoleDTO, MenuDTO } from '../lib/openapi-dtos';

xxxRouter.openapi(createRoute({
  // ...
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(UserDTO)), description: 'ok' },
  },
}), handler);
```

**约束：**

- ❌ **禁止**在路由文件中本地声明带 `.openapi('EntityName')` 的实体 DTO（会导致 Swagger Components 重复或冲突）
- ✅ 所有实体（`UserDTO` / `RoleDTO` / `MenuDTO` / `DepartmentDTO` / `TenantDTO` / `DictDTO` 等 50+）在 `openapi-dtos.ts` 中集中注册
- ✅ 内联使用的 request body schema、不作为 Component 的一次性匿名对象无需搬到中心文件
- ✅ 新增实体模块时，先在 `openapi-dtos.ts` 添加 `export const XxxDTO = z.object({...}).openapi('Xxx');`，再在路由中导入

这样做的好处：Swagger Components 有单一来源，避免同名冲突；前端/第三方可直接使用稳定的 OpenAPI Components 名称。

## 常用错误码

| code | 含义 |
|------|------|
| `0` | 成功 |
| `400` | 参数校验失败 |
| `401` | 未登录或 token 无效 |
| `403` | 无权限访问该资源 |
| `404` | 资源不存在 |
| `500` | 服务端内部错误 |

## 路由组织建议

- 按资源拆分到 `packages/server/src/routes/`
- 保持资源命名直观，如 `users.ts`、`roles.ts`、`dicts.ts`
- 和前端页面、共享 schema 尽量保持一一对应，便于排查问题
- 每个路由文件使用 `OpenAPIHono` 实例，在 `src/index.ts` 统一注册

## 数据删除规范

- 单条删除：`DELETE /api/resource/:id`
- 批量删除：`DELETE /api/resource/batch`，body 传 `{ ids: number[] }`
- 批量修改状态：`PATCH /api/resource/batch-status`，body 传 `{ ids: number[], status: 'active' | 'disabled' }`

## 文件上传

`POST /api/files/upload`，使用 `multipart/form-data`，返回文件 URL。

## 健康检查

`GET /api/health` — 无需鉴权，返回服务运行状态（包含 Node.js 版本、内存占用、运行时长）。

## 共享约定

- 类型统一放到 `@zenith/shared/src/types.ts`
- Zod schema 统一放到 `@zenith/shared/src/validation.ts`
- 枚举和常量统一放到 `@zenith/shared/src/constants.ts`

## Server-Timing 性能分析头

当 `SERVER_TIMING_ENABLED=true`（默认值）时，服务端会自动在每个响应中附加 [`Server-Timing`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing) 响应头：

```http
Server-Timing: total;dur=45.2;desc="Total Response Time"
```

**使用方式：**

打开 Chrome DevTools → Network → 选中任意 API 请求 → Timing 面板，即可查看各阶段耗时。

若需要对某个路由内部的关键操作（如数据库查询）埋点，可使用 `hono/timing` 提供的工具函数：

```typescript
import { startTime, endTime } from 'hono/timing';
import type { TimingVariables } from 'hono/timing';

// 路由 handler 中使用
app.get('/api/heavy', async (c) => {
  startTime(c, 'db');
  const data = await db.query.users.findMany();
  endTime(c, 'db');
  return c.json({ code: 0, data });
});
```

响应头将包含：

```http
Server-Timing: total;dur=45.2;desc="Total Response Time", db;dur=12.3
```

**环境变量配置：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SERVER_TIMING_ENABLED` | `false` | 设为 `true` 可开启，生产环境建议保持关闭以避免暴露内部耗时信息 |

## 请求体大小限制与请求超时

为防止大请求体导致服务端资源耗尽、长连接挂起等问题，服务端提供两个可选的防护中间件，均基于 Hono 官方实现（`hono/body-limit`、`hono/timeout`），**默认均不启用**。

### 请求体大小限制（Body Limit）

- 作用范围：全局所有请求。
- 超出限制时返回：`{ code: 413, message: '请求体超出大小限制', data: null }`（HTTP 413）。
- 生产环境建议开启，视业务场景设定合理值。

### 请求超时（Request Timeout）

- 作用范围：`/api/*`，但**自动排除以下长耗时路径**：
  - `/api/ws` — WebSocket 连接
  - `/api/files/*` — 文件上传/下载
  - `/api/db-backups/*` — 数据库备份
  - 所有以 `/export` 结尾的导出接口（如 `/api/users/export`、`/api/operation-logs/export` 等）
- 超时后返回：`{ code: 408, message: '请求处理超时（Xms）', data: null }`（HTTP 408）。

**环境变量配置：**

| 变量                 | 默认值 | 说明                                                                                        |
| -------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `REQUEST_BODY_LIMIT` | `0`    | 请求体大小上限（字节）。`0` 或未设置 = 不限制。常用值：`10485760` (10MB)、`104857600` (100MB) |
| `REQUEST_TIMEOUT_MS` | `0`    | 请求超时时间（毫秒）。`0` 或未设置 = 不启用                                                 |
