# API 规范

后端 API 由 `packages/server/src/app.ts` 统一装配，业务路由统一挂载在 `/api` 前缀下。常规业务接口使用 Hono + `@hono/zod-openapi`，以 Zod schema 同时驱动运行时校验与 OpenAPI 文档。

## 统一响应格式

成功响应统一由 `okBody(data, message?)` 构造：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

失败响应统一由 `errBody(message, code?)` 构造，`code` 与 HTTP 状态码保持同语义，`data` 为 `null`：

```json
{
  "code": 404,
  "message": "资源不存在",
  "data": null
}
```

路由 handler 中使用 `return c.json(okBody(...), 200)` 或 `return c.json(errBody(...), status)`，不要内联 `{ code, message, data }` 字面量。文件下载类响应通过 `okExcel()` / `okCsv()` / `okFile()` 声明 OpenAPI，handler 中使用 `excelBody()` / `excelStreamBody()` / `csvStreamBody()` / `fileBody()` 或直接返回 `Response`。

## 分页返回格式

列表接口返回 `PaginatedResponse<T>`，并放在统一响应的 `data` 字段内：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "list": [],
    "total": 100,
    "page": 1,
    "pageSize": 10
  }
}
```

分页查询参数在契约中用 `paginationQuery.extend({ ... })` 声明，分页响应用 `paginated(xxxSchema)`。默认 `page=1`、`pageSize=10`，`pageSize` 最大 200。Service 层 SQL-builder 查询使用 `withPagination(query.$dynamic(), page, pageSize)`；RQB 查询使用 `pageOffset(page, pageSize)`。

## 日期时间格式

所有对外 API 响应和业务日期时间入参统一使用 `YYYY-MM-DD HH:mm:ss`，例如：`2026-03-22 20:09:37`。

- 数据映射、导出和文件时间戳使用 `packages/server/src/lib/datetime.ts` 中的 `formatDateTime()` / `formatNullableDateTime()` / `formatDate()` / `formatFileTimestamp()`。
- 单点时间入参使用 `parseDateTimeInput()`。
- 范围端点使用 `parseDateRangeStart()` / `parseDateRangeEnd()`，或直接使用 `dateRangeConditions()`。
- 路由查询 schema 中的范围端点用 `dateRangeBound('说明')`，接受 `YYYY-MM-DD` 与 `YYYY-MM-DD HH:mm:ss`。
- 业务接口契约不要使用 ISO datetime，数据映射不要直接 `toISOString()`。

## 认证方式

管理端使用 Access Token + Refresh Token：

| Token | 前端存储 Key | 说明 |
| --- | --- | --- |
| Access Token | `zenith_token` | 短期凭证，通过请求头传递 |
| Refresh Token | `zenith_refresh_token` | 长期凭证，用于 `/api/auth/refresh` 换发 Access Token |

需要认证的请求携带：

```http
Authorization: Bearer <accessToken>
```

管理端 `authMiddleware` 同时支持以 `zat_` 开头的 API Token。管理员 token 与会员 token 严格隔离：`authMiddleware` 拒绝 `type: 'member'` 的 token，会员接口由 `memberAuthMiddleware` 校验 `type: 'member'`。

认证中间件会在 Hono 上下文中注入 `user`。路由守卫可通过 `c.get('user')` 读取；Service 层统一使用 `currentUser()` / `currentUserOrNull()`，避免在 route handler 与 service 之间透传 Context。

```ts
import { currentUser } from '../lib/context';

const user = currentUser();
```

## 参数校验与路由声明

每个端点由 `@zenith/shared/{业务域}/contracts/` 中的契约操作定义：方法、路径、`params` / `query` / `headers` / `body`
schema 与响应 schema（`headers` 只声明业务请求头，如幂等键 `x-idempotency-key`；认证头由 security 表达）。
路由文件用 `defineContractRoute(op, { middleware, handler })`（`lib/contract-route.ts`）
把契约变成 Hono 路由，入参按契约 schema 校验，由 `validationHook` 统一转为标准错误响应。

```json
{
  "code": 400,
  "message": "<Zod 校验错误信息>",
  "data": null
}
```

契约（`packages/shared/src/platform/contracts/xxxs.ts`）：

```ts
import * as z from 'zod';
import { auditFieldsSchema, defineContract, idParam, op, paginated, paginationQuery } from '../../core';
import { createXxxSchema, updateXxxSchema } from '../validation';

export const xxxSchema = z.object({
  id: z.int(),
  name: z.string(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'Xxx' });
export type Xxx = z.infer<typeof xxxSchema>;

export const xxxContract = defineContract('/api/xxxs', {
  list: op.get('/', { query: paginationQuery.extend({ keyword: z.string().optional() }), response: paginated(xxxSchema), summary: 'XXX 列表' }),
  detail: op.get('/{id}', { params: idParam, response: xxxSchema, summary: 'XXX 详情' }),
  create: op.post('/', { body: createXxxSchema, response: xxxSchema, summary: '创建 XXX' }),
  update: op.put('/{id}', { params: idParam, body: updateXxxSchema, response: xxxSchema, summary: '更新 XXX' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除 XXX' }),
}, { tags: ['Xxx'] });
```

路由（`packages/server/src/routes/platform/xxxs.ts`）：

```ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { xxxContract } from '@zenith/shared/platform';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';

const xxxRouter = new OpenAPIHono({ defaultHook: validationHook });

const createXxxRoute = defineContractRoute(xxxContract.create, {
  middleware: [authMiddleware, guard({ permission: 'system:xxx:create', audit: { description: '创建 XXX', module: 'XXX 管理' } })],
  handler: async (c) => c.json(okBody(await createXxx(c.req.valid('json')), '创建成功'), 200),
});

xxxRouter.openapiRoutes([createXxxRoute] as const);
export default xxxRouter;
```

要点：

- 每个 `OpenAPIHono` 实例传入 `{ defaultHook: validationHook }`。
- 每个路由用命名常量声明，并通过 `router.openapiRoutes([... ] as const)` 统一注册；挂载路径取 `xxxContract.basePath`。
- 认证与权限只出现在 `middleware:`（`authMiddleware` / `guard(...)`）；文档中的 `security` 由契约推导：
  默认 `BearerAuth`，公开接口标 `public: true`（`security: []`），IoT 设备签名与开放平台网关接口标
  `security: 'device-signature' | 'open-gateway'`（对应 `IotDeviceSignature` / `OpenGatewayToken` + `OpenGatewaySignature`
  安全方案，由 `lib/contract-route.ts` 的 `CONTRACT_SECURITY_SCHEMES` 注册）。`commonErrorResponses` 与 200 响应信封由适配层统一施加。
- `handler` 内 `c.req.valid('param' | 'query' | 'json')` 与 `c.json(okBody(...), 200)` 均按契约类型检查：
  service 返回值与契约实体不一致时编译失败。
- 路径参数用 `idParam`；自定义路径参数写 `z.object({ code: z.string().meta({ description, example }) })`；
  OpenAPI 元数据一律用 zod 原生 `.meta()`（组件名 `.meta({ id })`）。
- 部分更新（`PUT` / `PATCH`）的请求体 schema 一律用 `partialForUpdate(createXxxSchema)`（`@zenith/shared/core`）派生，
  它会剥离全部 `.default()` 再置为可选：省略的字段表示「保持不变」。禁止直接调用 `.partial()`（ESLint 封禁），
  契约测试会拒绝任何请求体属性携带 `default` 的 `PUT` / `PATCH` 操作；全量替换 / upsert 端点需在
  `src/app.contract.test.ts` 的整体替换例外清单登记理由。
- 全量集合赋值端点（`PUT /{id}/roles` 等）的集合字段必填，不得 `.default([])`：字段缺失应校验失败而非静默清空。
- 上传接口的请求体用 `multipart(z.object({ file: fileField() }))` 声明，handler 内 `c.req.parseBody()` 读取；
  文件类响应用 `kind: 'excel' | 'csv' | 'file'`。

## Service 层规范

业务逻辑、数据映射、前置校验统一放在 `packages/server/src/services/{业务域}/` 下，目录与 `src/routes/{业务域}/` 对齐。

| 层 | 职责 | 禁止事项 |
| --- | --- | --- |
| route handler | 读取 `c.req.valid()`、调用 service、返回 HTTP 响应、设置必要审计快照 | 直接写业务规则、数据映射、DB 查询 |
| service | 业务规则、数据映射、前置校验、复杂查询、事务、关联写操作；通过 `currentUser()` 获取登录用户 | `c.json()`、直接依赖 Hono `Context`、`console.*` |

常用命名：

```ts
export function mapXxx(row: XxxRow) { ... }

export async function ensureXxxExists(id: number) {
  const [row] = await db.select().from(xxxs).where(eq(xxxs.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: 'XXX 不存在' });
  return row;
}
```

业务错误抛 `HTTPException(statusCode, { message })`，由 `app.onError()` 转为统一 JSON。唯一约束冲突使用 `rethrowPgUniqueViolation(err, message, byConstraint?)` 映射为 400。

## 响应实体 schema（契约单一来源）

响应实体形状定义在契约文件的 `xxxSchema`（`.meta({ id: 'Xxx' })` 即 OpenAPI 组件名），
`type Xxx = z.infer<typeof xxxSchema>` 是前后端共用的实体类型；服务端没有独立的响应 DTO 层。

- 组件名全局唯一，按「域 + 实体」命名（`CmsContent` / `WikiComment`）。
- 精简变体用 `xxxSchema.pick({...})`，附带关联数据的详情用 `xxxSchema.extend({...})`，各自给独立的 `id`。
- 请求体 schema 在 `validation.ts`（`createXxxSchema` / `updateXxxSchema`），契约只引用不复制。

## 常用错误码

| code | 含义 |
| --- | --- |
| `0` | 成功 |
| `400` | 参数校验失败或业务前置条件不满足 |
| `401` | 未登录、token 无效或会话失效 |
| `403` | 权限不足、账号禁用、功能授权不满足 |
| `404` | 资源不存在 |
| `408` | 请求处理超时（启用 `REQUEST_TIMEOUT_MS` 时） |
| `409` | 并发冲突、乐观锁重试耗尽 |
| `410` | 导出文件等资源已过期 |
| `413` | 请求体超出大小限制（启用 `REQUEST_BODY_LIMIT` 时） |
| `423` | 登录账号被锁定 |
| `429` | 触发接口级限流 |
| `500` | 服务端内部错误 |

## 路由组织

- 路由文件位于 `packages/server/src/routes/{业务域}/`，每个文件导出一个子路由器。
- 每个业务域在 `routes/{业务域}/index.ts` 中用 `defineRouteDomain` 声明挂载清单。
- `routes/index.ts` 的 `ROUTE_DOMAINS` 声明域顺序：`ops → identity → member → platform → files → tasks → analytics → report → messaging → payment → open-platform → workflow → chat → mp → biz-demo → ai → cms → wiki`。
- `src/app.ts` 的 `createApp()` 按域装配常规 API，再挂载 `/api/mastra/*`，再注册 Swagger 文档和 fallback 路由。
- CMS 前台 SSR 等兜底路由放在域的 `fallback()` 中，保证晚于全部 API 与文档路由。
- 全量 method + path 由 `src/app.contract.test.ts` 快照锁定；增删接口需更新该快照。

## 数据删除与批量操作规范

- 单条删除：`DELETE /api/resource/{id}`。
- 批量删除：`DELETE /api/resource/batch` 或按领域既有约定使用 `POST /batch-delete`，body 传 `{ ids: number[] }`。
- 批量修改状态：`PUT /api/resource/batch-status`，body 传 `{ ids: number[], status: 'enabled' | 'disabled' }`。
- `DELETE /batch` 必须注册在 `DELETE /{id}` 之前，避免被动态参数捕获。

## 文件上传

标准文件上传由文件域提供。小文件使用 `POST /api/files/upload`（`multipart/form-data`）；大文件使用上传会话与分片接口。文件下载、预览和业务附件关系由 `packages/server/src/routes/files/` 与 `services/files/` 收口。

## 健康检查

`GET /api/health` 无需鉴权，返回服务状态、版本、运行时长，以及数据库 / Redis 连通性：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "status": "ok",
    "version": "1.90.0",
    "uptimeSeconds": 12345,
    "checks": { "database": "ok", "redis": "ok" }
  }
}
```

## Prometheus 指标

`GET /metrics` 无需鉴权，返回 Prometheus 文本格式指标，不属于 OpenAPI 文档。指标来源包括：

- `@hono/prometheus` HTTP RED 指标；
- `prom-client` 默认进程指标；
- `registerZenithMetrics()` 注册的 Zenith 业务 / 系统指标（CPU、内存、HTTP、WebSocket、DB、Redis 等）。

## OpenTelemetry Trace

服务端通过 `@hono/otel` 接入 Hono 请求 Trace。`OTEL_ENABLED=true` 时启用；未显式设置 `OTEL_ENABLED` 但配置了 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 或 `OTEL_EXPORTER_OTLP_ENDPOINT` 时也会启用。采集请求 / 响应头包括 `x-request-id`、`user-agent`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `OTEL_ENABLED` | `false` | 是否启用 Trace |
| `OTEL_SERVICE_NAME` | `zenith-admin-server` | 服务名 |
| `OTEL_SERVICE_VERSION` | npm package version | 服务版本 |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | 空 | OTLP traces 专用导出地址 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 空 | 通用 OTLP 导出地址 |
| `OTEL_EXPORTER_OTLP_HEADERS` | 空 | 导出请求头 |

## 共享约定

- 类型、Zod schema、枚举和常量按域放到 `@zenith/shared/{业务域}` 子路径。
- 禁止从 `@zenith/shared` 根入口导入。
- 种子数据统一从 `@zenith/shared/seed` 导入。

## Server-Timing 性能分析头

`SERVER_TIMING_ENABLED=true` 时，服务端通过 `hono/timing` 为响应附加 `Server-Timing` 头。默认关闭。

```http
Server-Timing: total;dur=45.2;desc="Total Response Time"
```

路由内部可使用 `startTime(c, name)` / `endTime(c, name)` 标记关键阶段。

## 请求防护

服务端在 `createApp()` 中装配以下中间件：

| 能力 | 实现 | 说明 |
| --- | --- | --- |
| Request ID | `hono/request-id` | 为请求设置 `requestId` 上下文 |
| Trace ID | `requestTraceMiddleware` | 接收 `X-Trace-Id`（≤64 字符）或生成 UUID，并回写响应头 |
| 安全响应头 | `hono/secure-headers` | API 场景下放开 CORP / COOP / X-Frame-Options 的不适用限制 |
| 压缩 | `hono/compress` | WebSocket、文件、日志流、监控流、AI 流式、公开制品等长连接 / 二进制端点排除 |
| CORS | `hono/cors` | `/api/mastra/*` 反射 Origin 并允许 credentials，其余路径使用 `CORS_ORIGIN` |
| CSRF | `hono/csrf` | 按 `ALLOWED_ORIGINS` 校验 Origin；SAML ACS、OAuth2 authorize/token、开放网关 `/api/open/*` 豁免 |
| Body Limit | `hono/body-limit` | `REQUEST_BODY_LIMIT > 0` 时启用，超限返回 413 |
| Timeout | `hono/timeout` | `REQUEST_TIMEOUT_MS > 0` 时对 `/api/*` 启用，WebSocket / 文件 / DB 管理 / 日志 / 监控流 / AI 流 / 应用发布制品 / `*/export` 排除 |
| IP 访问控制 | `ipAccessMiddleware` | 对 `/api/*` 生效 |
| 限流 | `rate-limit.ts` | 登录、验证码、注册 / 找回 / 重置密码和路径绑定限流 |
| 维护模式 | `maintenanceMiddleware` | 对 `/api/*` 生效，认证与公开维护接口除外 |
| License 门控 | `licenseFeatureGate` | 域挂载声明 `feature` 时整体套功能授权 |
