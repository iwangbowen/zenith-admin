# HTTP 流量日志

本系统实现了对标 [Zalando Logbook](https://github.com/zalando/logbook) 的 HTTP 流量日志能力，同时覆盖：

- **入站（Incoming）**：进入本系统的所有 HTTP 请求/响应（通过 Hono 中间件实现）
- **出站（Outgoing）**：本系统通过 `http-client.ts` 发出的外部 HTTP 请求（第三方 API、OAuth、SMS、邮件等）

## 功能特性

| 特性 | 支持情况 |
|---|---|
| 请求 + 响应关联（correlation ID） | ✅ 复用 `hono/request-id` |
| 5 档精细日志级别 | ✅ off / access / headers / body / full |
| 全局级别 + 方法级别覆盖 | ✅ 独立配置每个 HTTP Method |
| 3 种输出格式 | ✅ json / text / curl |
| 敏感字段自动脱敏 | ✅ Headers 和 Body 均覆盖 |
| Body 大小截断 | ✅ 可配置字节上限 |
| 排除路径（health/ws/metrics 等） | ✅ 内置 + 可扩展 |
| 独立日志文件（http-traffic-*.log） | ✅ 可选，每日滚动 |
| 入站响应体记录 | ✅ 按需开启（克隆 Response） |
| 出站响应体记录 | ✅ 默认开启 |
| 出站重试序号记录 | ✅ 自动标注 attempt |
| 出站错误记录 | ✅ 网络错误 / 熔断器开启 |

## 默认行为

所有日志功能**默认关闭**，需要通过环境变量显式开启，避免生产环境意外记录敏感数据。

开启后的各项默认值如下：

| 配置项 | 入站默认值 | 出站默认值 |
|---|---|---|
| `enabled` | `false`（关闭）| `false`（关闭）|
| `level` | `access` | `full` |
| 方法级别覆盖 | 无（全部继承全局级别）| 无（全部继承全局级别）|
| `format` | `json` | `json` |
| `maxBodyBytes` | `65536`（64KB）| `4096`（4KB）|
| `logResponseBody` | `false`（不记录响应体）| `true`（记录响应体）|
| `excludePaths` | 空（仅内置排除生效）| 不适用 |
| `separateFile` | `false`（写入 app-*.log）| 不适用（始终写入 app-*.log）|

**内置排除路径**（始终跳过，不受配置影响）：

`/api/health`、`/api/ws`、`/api/metrics`、`/docs`、`/api/ui`、`/favicon.ico`

## 日志级别（Level）

| 级别 | 记录内容 | 适用场景 |
|---|---|---|
| `off` | 不记录 | 关闭特定方法 |
| `access` | 方法 + URL + 状态码 + 耗时 | 轻量默认，无额外 I/O |
| `headers` | access + 请求/响应 Headers | 排查鉴权问题（Authorization、Cookie 自动脱敏）|
| `body` | access + 请求/响应 Body | 排查数据异常 |
| `full` | 全量（access + headers + body）| 完整流量重现 |

## 输出格式（Format）

### json（推荐，适合 ELK / Grafana）

每个请求/响应各一行 JSON（NDJSON 格式），通过 `correlation` 字段关联：

```json
{"correlation":"req-abc123","direction":"incoming","phase":"request","method":"POST","url":"/api/users","requestHeaders":{"content-type":"application/json"},"requestBody":{"username":"test","password":"***"},"timestamp":"2026-05-30 10:23:41"}
{"correlation":"req-abc123","direction":"incoming","phase":"response","method":"POST","url":"/api/users","statusCode":201,"durationMs":45,"timestamp":"2026-05-30 10:23:41"}
```

### text（适合开发调试）

多行人类可读格式：

```
>> [IN] POST /api/users
   content-type: application/json
   body: {"username":"test","password":"***"}
<< [IN] POST /api/users → 201 (45ms)
   body: {"code":0,"data":{"id":1}}
```

### curl（适合问题复现）

请求阶段生成可直接执行的 curl 命令：

```bash
curl -X POST 'http://localhost:3300/api/users' \
  -H 'Content-Type: application/json' \
  -d '{"username":"test","password":"***"}'
```

响应阶段自动降级为 text 格式。

## 配置参考

所有配置通过环境变量控制，参见 [`packages/server/.env.example`](../../packages/server/.env.example) 中的 HTTP 日志配置节。

### 快速场景配置

#### 场景 1：排查某 POST 接口的 body 异常

```ini
HTTP_LOG_INCOMING_ENABLED=true
HTTP_LOG_INCOMING_LEVEL=access           # 大多数接口保持轻量
HTTP_LOG_INCOMING_METHOD_POST=full       # POST 全量
HTTP_LOG_INCOMING_RESPONSE_BODY=true     # 同时记录响应体
HTTP_LOG_INCOMING_FILE=true              # 写独立文件，不污染 app.log
```

#### 场景 2：监控出站第三方调用（OAuth、短信、邮件等）

```ini
HTTP_LOG_OUTGOING_ENABLED=true
HTTP_LOG_OUTGOING_LEVEL=full
HTTP_LOG_OUTGOING_FORMAT=curl            # 请求阶段生成可重放命令
HTTP_LOG_OUTGOING_FILE=true             # 出站日志写独立文件
```

#### 场景 3：开发环境全量调试

```ini
HTTP_LOG_INCOMING_ENABLED=true
HTTP_LOG_INCOMING_LEVEL=full
HTTP_LOG_INCOMING_FORMAT=text
HTTP_LOG_INCOMING_RESPONSE_BODY=true
HTTP_LOG_INCOMING_FILE=true             # 入站写独立文件
HTTP_LOG_OUTGOING_ENABLED=true
HTTP_LOG_OUTGOING_LEVEL=full
HTTP_LOG_OUTGOING_FORMAT=text
HTTP_LOG_OUTGOING_FILE=true             # 出站写独立文件（与入站共用 http-traffic-*.log）
```

#### 场景 4：精细控制——GET 降级，写接口全量

```ini
HTTP_LOG_INCOMING_ENABLED=true
HTTP_LOG_INCOMING_LEVEL=access           # 全局默认 access
HTTP_LOG_INCOMING_METHOD_GET=off         # GET 完全不记录
HTTP_LOG_INCOMING_METHOD_POST=full
HTTP_LOG_INCOMING_METHOD_PUT=body
HTTP_LOG_INCOMING_METHOD_PATCH=body
HTTP_LOG_INCOMING_METHOD_DELETE=headers
```

## 日志文件

| 文件 | 说明 |
|---|---|
| `logs/app-YYYY-MM-DD.log` | 主应用日志（默认，HTTP 日志条目带 `[http-in]` / `[http-out]` 前缀）|
| `logs/http-traffic-YYYY-MM-DD.log` | 独立 HTTP 流量日志（`HTTP_LOG_INCOMING_FILE=true` 或 `HTTP_LOG_OUTGOING_FILE=true` 时生成）|

日志文件每日滚动，默认保留 30 天，超过自动压缩归档（由 `LOG_MAX_FILES` 控制）。

## 安全说明

### 自动脱敏的 Header 字段

- `authorization`、`cookie`、`set-cookie`
- `proxy-authorization`、`x-auth-token`、`x-api-key`
- Header 名称包含 `token`、`secret`、`password`、`api-key` 的字段

### 自动脱敏的 Body 字段

通过 `sanitize.ts` 的 `redactBody()` 深度遍历，以下关键词匹配的字段值替换为 `***`：

`password`、`secret`、`token`、`accessKey`、`access_key`、`privateKey`、`private_key`

### 注意事项

- 响应体记录（`logResponseBody=true`）会将响应完整内容写入日志，**若响应包含用户敏感数据，请谨慎开启**
- `body` / `full` 级别在高并发场景下会增加内存和 I/O 开销，建议仅在需要时临时开启
- 出站日志的 `correlation` 字段格式为 `out-{timestamp}-{attempt}`，与入站的 `request-id` 不同

## 路由级与调用级覆盖

全局配置只是默认值，可以在更细粒度上覆盖。

### 入站：路由级覆盖（`withHttpLog`）

使用 `withHttpLog(level)` 工具中间件为单条路由指定日志级别，优先级高于全局配置和方法级配置：

```typescript
import { withHttpLog } from '../middleware/http-logger';
import { authMiddleware } from '../middleware/auth';

// 仅对 /api/payment 开启全量日志（全局可能是 access）
const createPaymentRoute = createRoute({
  middleware: [authMiddleware, withHttpLog('full')] as const,
  // ...
});

// 对含有敏感 PII 的接口关闭日志
const getUserSecretRoute = createRoute({
  middleware: [authMiddleware, withHttpLog('off')] as const,
  // ...
});
```

覆盖优先级：`withHttpLog(level)` > 方法级 `HTTP_LOG_INCOMING_METHOD_*` > 全局 `HTTP_LOG_INCOMING_LEVEL`

### 出站：调用级覆盖（`httpLog` 选项）

在调用 `httpRequest()` 时，通过 `httpLog` 选项覆盖出站日志配置，优先级高于全局配置和方法级配置：

```typescript
import { httpRequest } from '../lib/http-client';

// 单次调用开启全量日志（含请求/响应 body）
await httpRequest('https://api.example.com/webhook', {
  method: 'POST',
  body: payload,
  httpLog: { level: 'full', logResponseBody: true },
});

// 单次调用完全禁用日志（敏感数据场景）
await httpRequest('https://api.payment.com/charge', {
  method: 'POST',
  body: cardData,
  httpLog: { level: 'off' },
});

// 单次调用使用 curl 格式（方便复现请求）
await httpRequest('https://api.example.com/debug', {
  method: 'GET',
  httpLog: { level: 'full', format: 'curl' },
});
```

覆盖优先级：`httpLog.level` > 方法级 `HTTP_LOG_OUTGOING_METHOD_*` > 全局 `HTTP_LOG_OUTGOING_LEVEL`

## 架构与实现

```
lib/http-logger.ts           # 核心模块（类型、格式化器、脱敏、写入）
middleware/http-logger.ts    # 入站 Hono 中间件
lib/http-client.ts           # 出站日志（在 httpRequest 函数中增强）
config.ts                    # HttpLogLevel / HttpLogFormat / httpLog 配置
lib/sanitize.ts              # redactBody()（对象深度脱敏，返回克隆副本）
```

### Correlation ID 流转

```
Client → [requestId 中间件] → correlation = X-Request-Id
                           ↓
         [httpLoggerMiddleware]
              ├── 写请求条目（correlation = req-xxx）
              ├── await next()
              └── 写响应条目（同一 correlation）
```

### 出站日志中的重试处理

`http-client.ts` 内置指数退避重试（`retries` 参数）。每次重试都会产生独立的请求/响应/错误条目，通过 `attempt` 字段区分（`attempt=1` 时不显示该字段）：

```json
{"correlation":"out-1748600000000-1","direction":"outgoing","phase":"request","method":"POST","url":"https://api.example.com/send","timestamp":"..."}
{"correlation":"out-1748600000000-1","direction":"outgoing","phase":"response","statusCode":500,"durationMs":120,"error":null,"timestamp":"..."}
{"correlation":"out-1748600000000-2","direction":"outgoing","phase":"request","method":"POST","url":"https://api.example.com/send","attempt":2,"timestamp":"..."}
{"correlation":"out-1748600000000-2","direction":"outgoing","phase":"response","statusCode":200,"durationMs":95,"timestamp":"..."}
```

## 与现有日志体系的关系

| 日志来源 | 写入位置 | 触发条件 |
|---|---|---|
| `hono/logger`（原有）| `app-*.log` | 每个请求必然触发，记录一行 access log |
| HTTP 流量日志（本模块）| `app-*.log` 或 `http-traffic-*.log` | 仅在 `enabled=true` 且级别不为 `off` 时触发 |
| `guard()` 操作审计 | `operation_logs` 数据库表 | 仅在路由 `middleware` 中配置了 `audit` 选项时触发 |

三者互补，不互相替代：

- **hono/logger** 保证每个请求都有基础 access log（不可关闭）
- **HTTP 流量日志** 提供按需的详细 headers/body 文件日志（可关闭）
- **guard() 操作审计** 提供业务层面的 before/after diff 持久化审计（按路由配置）
