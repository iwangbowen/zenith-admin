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

## 日期时间格式

所有对外 API 响应和日期时间入参统一使用 `YYYY-MM-DD HH:mm:ss`，例如：`2026-03-22 20:09:37`。

- Service 层 DTO 映射、导出和文件时间戳统一使用 `packages/server/src/lib/datetime.ts` 中的 `formatDateTime()` / `formatNullableDateTime()` / `formatDate()` / `formatFileTimestamp()`。
- 查询参数或 JSON 入参中的日期时间统一使用 `parseDateTimeInput()`、日期范围使用 `parseDateRangeStart()` / `parseDateRangeEnd()` 解析。
- 共享 Zod schema 中的日期时间字段使用 `YYYY-MM-DD HH:mm:ss` 正则校验，禁止继续使用 ISO datetime 作为业务接口契约。
- 禁止在 route/service/DTO 映射中直接使用 `toISOString()` 作为对外响应格式。

## 认证方式

项目采用 **Access Token + Refresh Token 双 token** 机制：

| Token | 存储 Key | 说明 |
| --- | --- | --- |
| Access Token | `zenith_token` | 短期 token，附在每次请求头中 |
| Refresh Token | `zenith_refresh_token` | 长期 token，用于在 Access Token 过期时自动续期 |

需要认证的请求需携带：

```http
Authorization: Bearer <access_token>
```

当 Access Token 过期时，前端 `request.ts` 会自动携带 Refresh Token 向后端换取新的 Access Token，对业务代码透明。

认证中间件会在上下文中注入用户信息。路由守卫可通过 `c.get('user')` 读取；业务 Service 中统一使用 `currentUser()` 零参获取当前用户，避免在 route handler 与 service 之间层层透传：

```typescript
import { currentUser } from '../lib/context';

const user = currentUser(); // JwtPayload
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
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { ErrorResponse, jsonContent, PaginationQuery, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, errBody } from '../lib/openapi-schemas';

// 不使用 <AuthEnv> 泛型，不添加全局 use('*', authMiddleware)
const xxxRouter = new OpenAPIHono({ defaultHook: validationHook });

// 每个路由定义为命名常量，middleware 中显式声明 authMiddleware
const createXxxRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:xxx:create', audit: { description: '创建XXX', module: 'XXX管理' } })] as const,
    request: { body: { content: jsonContent(createXxxSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(XxxDTO, 'ok'),
    },
  }),
  handler: async (c) => {
    const data = c.req.valid('json');  // 类型安全，已验证
    // ...
  },
});

// 收集所有路由常量，统一注册（放在 export 之前）
xxxRouter.openapiRoutes([createXxxRoute, /* 其他路由 */] as const);
```

> `validationHook` 将 Zod 校验失败自动转为 `{ code: 400, message, data: null }` 标准格式，**创建 `OpenAPIHono` 实例时必须传入 `{ defaultHook: validationHook }`**。`commonErrorResponses` 已包含 400/401/403/404/500 标准错误码，所有路由的 `responses:` 块均需通过 `...commonErrorResponses` 展开。Zod schema 可直接从 `@zenith/shared/src/validation.ts` 导入（shared 使用 Zod v4），或在路由文件内本地声明。共享的辅助类型与工具函数位于 `packages/server/src/lib/openapi-schemas.ts`，文件下载类响应使用 `okExcel()` / `okCsv()` / `okFile()` 声明，handler 中配合 `excelBody()` / `excelStreamBody()` / `csvStreamBody()` / `fileBody()` 返回内容。
>
> **响应体构造**：handler 内部统一使用 `okBody(data, msg?)` / `errBody(msg, code?)` 构造响应体，禁止内联写字面量对象：
>
> ```typescript
> // ✅ 正确
> return c.json(okBody(user), 200);
> return c.json(okBody({ list, total, page, pageSize }), 200);
> return c.json(okBody(null, '删除成功'), 200);
> return c.json(errBody('用户不存在', 404), 404);
> // ❌ 禁止
> return c.json({ code: 0 as const, message: 'success', data: user }, 200);
> return c.json({ code: 404, message: '用户不存在', data: null }, 404);
> ```

## Service 层规范

业务逻辑、数据映射、前置校验从路由中提取到 `packages/server/src/services/` 下，每个业务模块对应一个 `xxx.service.ts` 文件。所有路由均已完成 service 层提取。

### 职责划分

| 层 | 职责 | 禁止事项 |
| --- | --- | --- |
| **route handler** | 取参数（`c.req.valid()`）、调 service 函数、返回 HTTP 响应 | 不得包含业务逻辑、数据映射、DB 查询 |
| **service** | 数据映射、前置校验、复杂 DB 查询、事务、关联写操作；需要当前用户时通过 `currentUser()` 获取 | 不得调用 `c.json()`、直接访问 Hono `Context`、使用 `console.*` |

### 命名约定

```typescript
// 数据映射（纯函数，DB 行 → 公开 DTO 字段）
export function mapXxx(row: XxxRow) { ... }

// 前置校验（直接 throw HTTPException，由全局 onError 转为 JSON 错误响应）
export async function ensureXxxExists(id: number) {
  const [row] = await db.select()...;
  if (!row) throw new HTTPException(404, { message: 'XXX 不存在' });
  return row;
}
```

### 错误处理：HTTPException

使用 Hono 原生 `HTTPException`（`hono/http-exception`），由 `packages/server/src/index.ts` 的全局 `onError` 统一处理：

```typescript
import { HTTPException } from 'hono/http-exception';

// service 中
throw new HTTPException(400, { message: '用户名已存在' });
throw new HTTPException(404, { message: '资源不存在' });

// service 中（DB 唯一约束错误统一映射为 HTTPException(400)）
try {
  await db.insert(xxxs).values(data);
} catch (err: unknown) {
  rethrowPgUniqueViolation(err, '该名称已存在');
}
```

## 响应实体 DTO（中心化）

所有响应实体 DTO 按业务域拆分在 `packages/server/src/lib/dtos/` 下，`openapi-dtos.ts` 作为 re-export 入口。各路由通过 `import { XxxDTO } from '../lib/openapi-dtos'` 引用，**新增实体请直接在对应子文件中维护**：

```typescript
import { UserDTO, RoleDTO, MenuDTO } from '../lib/openapi-dtos';

const listXxxRoute = defineOpenAPIRoute({
  route: createRoute({
    // ...
    responses: {
      ...commonErrorResponses,
      ...ok(UserDTO, 'ok'),
    },
  }),
  handler: async (c) => { /* ... */ },
});
```

**约束：**

- ❌ **禁止**在路由文件中本地声明带 `.openapi('EntityName')` 的实体 DTO（会导致 Swagger Components 重复或冲突）
- ✅ 所有实体 DTO 按业务域拆分在 `packages/server/src/lib/dtos/` 子目录，当前导出文件包括：`roles.ts`、`positions.ts`、`user-groups.ts`、`users.ts`、`menus.ts`、`departments.ts`、`tenants.ts`、`api-tokens.ts`、`auth.ts`、`dict.ts`、`files.ts`、`business-files.ts`、`logs.ts`、`announcements.ts`、`system-configs.ts`、`cron-jobs.ts`、`email-config.ts`、`cache.ts`、`db-backups.ts`、`db-admin.ts`、`monitor.ts`、`sessions.ts`、`workflow.ts`、`workflow-events.ts`、`dashboard.ts`、`region.ts`、`sms.ts`、`email.ts`、`in-app.ts`、`chat.ts`、`tags.ts`、`rate-limit.ts`、`ai.ts`、`data-mask.ts`、`oauth2.ts`、`maintenance.ts`、`terminal-files.ts`、`terminal-recordings.ts`、`processes.ts`、`analytics.ts`、`ssh-profiles.ts`、`ssh-sftp.ts`、`terminal-sessions.ts`、`frontend-errors.ts`、`payment.ts`、`member.ts`；`_audit.ts` 供 DTO 审计字段复用，`index.ts` 统一 re-export
- ✅ 内联使用的 request body schema、不作为 Component 的一次性匿名对象无需搬到中心文件
- ✅ 新增实体模块时，先在 `packages/server/src/lib/dtos/` 下对应的子文件（或新建子文件）中添加 `export const XxxDTO = z.object({...}).openapi('Xxx');`，再在路由中从 `'../lib/openapi-dtos'` 导入

这样做的好处：Swagger Components 有单一来源，避免同名冲突；前端/第三方可直接使用稳定的 OpenAPI Components 名称。

## 常用错误码

| code | 含义 |
| --- | --- |
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
- 每个路由文件使用 `OpenAPIHono` 实例，在 `packages/server/src/index.ts` 统一注册

## 数据删除规范

- 单条删除：`DELETE /api/resource/:id`
- 批量删除：`DELETE /api/resource/batch`，body 传 `{ ids: number[] }`
- 批量修改状态：`PATCH /api/resource/batch-status`，body 传 `{ ids: number[], status: 'enabled' | 'disabled' }`

## 文件上传

`POST /api/files/upload`，使用 `multipart/form-data`，返回文件 URL。

## 健康检查

`GET /api/health` — 无需鉴权，返回服务健康状态、运行时长以及数据库 / Redis 连通性检查结果。

## Prometheus 指标

`GET /metrics` — 无需鉴权，返回 Prometheus 文本格式指标，可直接被 Prometheus Server 抓取。

当前指标来源包括：

- `@hono/prometheus` 自动生成的 HTTP RED 指标（请求总量、请求耗时）
- `prom-client` 默认进程指标（事件循环、GC、进程 / Node.js 运行时指标等）

该端点返回 `text/plain`，**不属于 OpenAPI / Swagger 文档的一部分**。

## OpenTelemetry Trace

服务端已接入 `@hono/otel`，可对 Hono 请求生命周期生成 Trace Span。

### 当前行为

- 默认关闭，避免在未配置 OTLP Collector 时产生无效导出
- 当 `OTEL_ENABLED=true` 时强制启用
- 若未显式设置 `OTEL_ENABLED`，但配置了 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 或 `OTEL_EXPORTER_OTLP_ENDPOINT`，也会自动启用
- 当前会附带采集以下请求 / 响应头：`x-request-id`、`user-agent`

### 常用环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `OTEL_ENABLED` | `false` | 是否启用 Trace。若未设置但存在 OTLP endpoint，也会自动启用 |
| `OTEL_SERVICE_NAME` | `zenith-admin-server` | 服务名，写入 Span 资源属性 |
| `OTEL_SERVICE_VERSION` | 当前 `npm package version` | 服务版本，便于在可观测平台区分发布版本 |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | 空 | OTLP traces 专用导出地址，推荐显式配置为 `http://host:4318/v1/traces` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 空 | 通用 OTLP 导出地址；未设置 traces 专用地址时可使用该项 |
| `OTEL_EXPORTER_OTLP_HEADERS` | 空 | 导出请求头，适用于 SaaS 观测平台鉴权 |

## 共享约定

- 类型统一放到 `@zenith/shared/src/types.ts`
- Zod schema 统一放到 `@zenith/shared/src/validation.ts`
- 枚举和常量统一放到 `@zenith/shared/src/constants.ts`

## Server-Timing 性能分析头

当 `SERVER_TIMING_ENABLED=true` 时，服务端会自动在每个响应中附加 [`Server-Timing`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing) 响应头（默认关闭）：

```http
Server-Timing: total;dur=45.2;desc="Total Response Time"
```

**使用方式：**

打开 Chrome DevTools → Network → 选中任意 API 请求 → Timing 面板，即可查看各阶段耗时。

若需要对某个路由内部的关键操作（如数据库查询）埋点，可使用 `hono/timing` 提供的工具函数：

```typescript
import { startTime, endTime } from 'hono/timing';
import type { TimingVariables } from 'hono/timing';
import { okBody } from '../lib/openapi-schemas';

// 路由 handler 中使用
app.get('/api/heavy', async (c) => {
  startTime(c, 'db');
  const data = await db.query.users.findMany();
  endTime(c, 'db');
  return c.json(okBody(data), 200);
});
```

响应头将包含：

```http
Server-Timing: total;dur=45.2;desc="Total Response Time", db;dur=12.3
```

**环境变量配置：**

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
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
  - `/api/db-admin/*` — 数据库管理
  - `/api/log-files/*` — 日志文件读取
  - `/api/monitor/stream/*` — 监控流
  - `/api/ai/conversations/*` — AI 对话流
- 超时后返回：`{ code: 408, message: '请求处理超时（Xms）', data: null }`（HTTP 408）。

业务导出统一通过 [导出中心](/backend/export-center) 创建任务。同步导出会在创建任务时生成文件，仍受请求超时配置影响；大数据导出应在实体定义中配置 `execution.mode` 为 `auto` 或 `async`。

**环境变量配置：**

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `REQUEST_BODY_LIMIT` | `0` | 请求体大小上限（字节）。`0` 或未设置 = 不限制。常用值：`10485760` (10MB)、`104857600` (100MB) |
| `REQUEST_TIMEOUT_MS` | `0` | 请求超时时间（毫秒）。`0` 或未设置 = 不启用 |
