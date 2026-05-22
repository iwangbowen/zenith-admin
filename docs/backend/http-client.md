# 统一外呼 HTTP 客户端

服务端所有对外 HTTP 调用（OAuth、链接预览、第三方 API 等）统一通过 `packages/server/src/lib/http-client.ts` 发出，**禁止**在业务代码中直接使用全局 `fetch()`。

底层基于 Node 22 原生 `fetch`（undici），在其之上提供超时、重试、代理、熔断、Header 脱敏与结构化日志等能力。

## 设计目标

- **可观测**：每次请求/响应/重试/错误均写入 winston 日志，敏感 Header 自动脱敏。
- **可靠**：可选指数退避重试、按 host 维度的熔断器，防止单一故障域拖垮整个进程。
- **可控**：超时、代理、重试次数由调用方在代码中显式声明，**不从环境变量读取**，避免隐式行为。
- **统一错误**：失败一律抛出 `HttpClientError`，便于上层精确捕获与映射为业务错误。

## API

### 导出

```ts
import {
  httpRequest,
  httpGet, httpPost, httpPut, httpPatch, httpDelete,
  HttpClientError,
  resetHttpCircuitBreakers,
} from '@/lib/http-client';
```

### `httpRequest(url, options?)`

```ts
interface HttpRequestOptions extends Omit<RequestInit, 'signal' | 'body'> {
  baseURL?: string;          // 相对路径前缀
  body?: BodyInit | Record<string, unknown> | unknown[] | null;
  timeout?: number;          // ms，0 / 未设置 = 无超时（默认）
  retries?: number;          // 5xx 与网络错误重试次数，默认 0
  retryDelay?: number;       // 指数退避基准毫秒，默认 300
  proxy?: string;            // 仅由调用方代码传入，不读环境变量
  signal?: AbortSignal;      // 与超时信号合并
  logBodyLimit?: number;     // 日志中 body 截断长度，默认 2048；设 0 关闭 body 日志
}
```

返回 `HttpResponse`：

```ts
interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  url: string;                                  // 最终 URL（含重定向）
  text: () => Promise<string>;
  json: <T = unknown>() => Promise<T>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  raw: Response;                                // 原始 Response 对象
}
```

### 便捷方法

```ts
httpGet(url, options?)
httpPost(url, body?, options?)   // body 为对象时自动 JSON 序列化并补 Content-Type
httpPut(url, body?, options?)
httpPatch(url, body?, options?)
httpDelete(url, options?)
```

## 使用示例

### GET（含 Header）

```ts
const resp = await httpGet('https://api.github.com/user', {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
});
if (!resp.ok) {
  throw new HttpClientError('GitHub 用户信息获取失败', { status: resp.status, url: resp.url });
}
const user = await resp.json<Record<string, unknown>>();
```

### POST JSON

```ts
const resp = await httpPost('https://github.com/login/oauth/access_token', {
  client_id: clientId,
  client_secret: clientSecret,
  code,
}, {
  headers: { Accept: 'application/json' },
});
```

### 超时与重试

```ts
const resp = await httpGet('https://api.example.com/users', {
  timeout: 5000,        // 5s 超时
  retries: 2,           // 5xx / 网络错误最多重试 2 次
  retryDelay: 500,      // 退避基准 500ms：500 / 1000 / 2000
});
```

### 通过代理

```ts
const resp = await httpGet('https://www.google.com', {
  proxy: 'http://127.0.0.1:7890',   // 由调用方决定，不会自动读取 HTTPS_PROXY
});
```

### 取消请求

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 3000);
await httpRequest('https://example.com/big', { signal: ac.signal });
```

### baseURL

```ts
await httpGet('/v1.0/users/me', {
  baseURL: 'https://api.dingtalk.com',
});
```

## 错误处理

所有失败都抛出 `HttpClientError`：

```ts
class HttpClientError extends Error {
  readonly status: number;          // 0 = 网络/熔断/超时；非 0 = HTTP 状态码
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly bodySnippet: string;     // 最多 2KB 响应正文片段，便于诊断
  readonly cause?: unknown;
}
```

业务侧建议：

```ts
try {
  const resp = await httpGet(url);
  if (!resp.ok) {
    throw new HttpClientError('上游返回非 2xx', {
      status: resp.status,
      url: resp.url,
      bodySnippet: (await resp.text()).slice(0, 500),
    });
  }
} catch (err) {
  if (err instanceof HttpClientError && err.status === 0) {
    // 网络异常 / 熔断 / 超时
  }
  throw err;
}
```

## 熔断器

- **粒度**：按目标 URL 的 host。
- **触发**：滚动窗口内连续 **5 次失败**（5xx 或网络错误）。
- **冷却**：默认 **30s**，期间所有命中该 host 的请求直接抛 `HttpClientError`（`status: 0`），不会发起真实请求。
- **恢复**：冷却后进入半开状态，下一次成功则关闭熔断。

如需手动重置（测试用）：

```ts
import { resetHttpCircuitBreakers } from '@/lib/http-client';
resetHttpCircuitBreakers();
```

## 日志与 Header 脱敏

每条请求在 winston 中产生 1–N 条结构化日志：

- `[http] request` — 发起请求（debug）
- `[http] retry on 5xx` / `[http] retry on error` — 触发重试（warn）
- `[http] response` — 收到响应（info）
- `[http] error` — 最终失败 / 熔断 / 超时（warn）

以下 Header 在日志中始终替换为 `***`：

- 精确匹配：`authorization`、`cookie`、`set-cookie`、`proxy-authorization`、`x-auth-token`
- 模糊匹配：包含 `token` / `secret` / `password` / `api[_-]?key`（大小写不敏感）

响应正文按 `logBodyLimit`（默认 2048 字节）截断后写入日志，避免大对象污染日志文件。

## 代理策略

**调用方代码显式传入**：

```ts
httpGet(url, { proxy: 'http://127.0.0.1:7890' });
```

> 设计上不读取 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 环境变量。代理是否启用、对哪些目标启用，由业务代码自行决定，避免运维环境差异导致难以排查的行为漂移。

如确实需要按环境切换代理，建议在调用处通过 `getSystemConfig` 等业务渠道读取后再传入。

## 当前迁移情况

下列出站调用已全部走 `http-client`：

- [`packages/server/src/lib/oauth/github.ts`](https://github.com/iwangbowen/zenith-admin/blob/master/packages/server/src/lib/oauth/github.ts) — GitHub OAuth `access_token` 与 `user` 接口
- [`packages/server/src/lib/oauth/dingtalk.ts`](https://github.com/iwangbowen/zenith-admin/blob/master/packages/server/src/lib/oauth/dingtalk.ts) — 钉钉新版 OAuth 2.0
- [`packages/server/src/lib/oauth/wechat-work.ts`](https://github.com/iwangbowen/zenith-admin/blob/master/packages/server/src/lib/oauth/wechat-work.ts) — 企业微信 OAuth
- [`packages/server/src/services/chat.service.ts`](https://github.com/iwangbowen/zenith-admin/blob/master/packages/server/src/services/chat.service.ts) — 消息链接预览抓取（保留 SSRF 防护：`redirect: 'manual'` + 私网 IP 拦截）

新增任何外呼请直接使用 `httpRequest` / `httpGet` / `httpPost` 等，**不要**重新引入 `fetch()`。
