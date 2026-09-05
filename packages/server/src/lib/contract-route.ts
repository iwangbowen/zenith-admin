/**
 * 契约 → Hono 路由适配。
 *
 * 路由文件只提供 `middleware` 与 `handler`，方法 / 路径 / 入参 schema / 响应 schema /
 * security / tags 全部来自 `@zenith/shared` 的契约对象；OpenAPI 文档因此与前端调用、MSW mock
 * 同源。`commonErrorResponses` 与统一响应信封由本模块统一施加，路由文件无需再写。
 *
 * ```ts
 * const listRoute = defineContractRoute(tenantContract.list, {
 *   middleware: [authMiddleware, platformAdminMiddleware],
 *   handler: async (c) => c.json(okBody(await listTenants(c.req.valid('query'))), 200),
 * });
 * ```
 */
import { createRoute, defineOpenAPIRoute, type OpenAPIRoute, type RouteConfig, type RouteHandler, type RouteHook } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import type { z } from 'zod';
import { isMultipart, MULTIPART_CONTENT_TYPE, type AnyOperation, type MultipartBody, type ParamsSchema, type SecurityScheme } from '@zenith/shared/core';
import { IOT_SIGN_HEADER, IOT_SN_HEADER, IOT_TIMESTAMP_HEADER } from '@zenith/shared/iot';
import { OPEN_SIGNATURE_HEADERS } from '@zenith/shared/open-platform';
import { apiResponse, commonErrorResponses, jsonContent, okCsv, okExcel, okFile } from './openapi-schemas';

/**
 * 契约凭证类型对应的 OpenAPI securitySchemes 组件（`BearerAuth` 为全局默认方案，由 app.ts 注册）。
 * 契约路由引用到的方案都在这里声明，app.ts 装配时整体注册。
 */
export const CONTRACT_SECURITY_SCHEMES = {
  IotDeviceSignature: {
    type: 'apiKey',
    in: 'header',
    name: IOT_SIGN_HEADER,
    description: `设备 HMAC 签名（基于原始请求体）；须同时携带 ${IOT_SN_HEADER} 与 ${IOT_TIMESTAMP_HEADER}`,
  },
  OpenGatewayToken: {
    type: 'http',
    scheme: 'bearer',
    description: '开放平台 OAuth2 access_token',
  },
  OpenGatewaySignature: {
    type: 'apiKey',
    in: 'header',
    name: OPEN_SIGNATURE_HEADERS.signature,
    description: `AppKey + HMAC 签名；须同时携带 ${OPEN_SIGNATURE_HEADERS.appKey} / ${OPEN_SIGNATURE_HEADERS.timestamp} / ${OPEN_SIGNATURE_HEADERS.nonce}`,
  },
} as const;

/** 契约凭证类型 → OpenAPI security 要求；数组内多项为「任一满足即可」 */
const SECURITY_REQUIREMENTS: Record<SecurityScheme, Array<Record<string, string[]>>> = {
  none: [],
  bearer: [{ BearerAuth: [] }],
  'device-signature': [{ IotDeviceSignature: [] }],
  'open-gateway': [{ OpenGatewayToken: [] }, { OpenGatewaySignature: [] }],
};

type JsonBody<B extends z.ZodType> = {
  readonly content: { readonly 'application/json': { readonly schema: B } };
  readonly required: true;
};

type MultipartRequestBody<B extends z.ZodType> = {
  readonly content: { readonly 'multipart/form-data': { readonly schema: B } };
  readonly required: true;
};

/** 由契约推导 `createRoute` 的 request 段；未声明的段不出现 */
type RequestFor<Op extends AnyOperation> = Record<never, never> &
  (Op['params'] extends ParamsSchema ? { params: Op['params'] } : unknown) &
  (Op['query'] extends ParamsSchema ? { query: Op['query'] } : unknown) &
  (Op['headers'] extends ParamsSchema ? { headers: Op['headers'] } : unknown) &
  (Op['body'] extends MultipartBody ? { body: MultipartRequestBody<Op['body']> } : Op['body'] extends z.ZodType ? { body: JsonBody<Op['body']> } : unknown);

type JsonSuccess<R extends z.ZodType> = {
  200: { content: { 'application/json': { schema: ReturnType<typeof apiResponse<R>> } }; description: string };
};

type SseSuccess = { 200: { content: { 'text/event-stream': { schema: z.ZodString } }; description: string } };

/** 由契约推导成功响应段 */
type SuccessFor<Op extends AnyOperation> =
  Op['kind'] extends 'json' ? JsonSuccess<Op['response']>
    : Op['kind'] extends 'excel' ? ReturnType<typeof okExcel>
      : Op['kind'] extends 'csv' ? ReturnType<typeof okCsv>
        : Op['kind'] extends 'file' ? ReturnType<typeof okFile>
          : SseSuccess;

type ExtraResponses = Record<number, { description: string; content?: Record<string, { schema: z.ZodType }> }>;

export type RouteOptions<M extends readonly MiddlewareHandler[], Extra extends ExtraResponses> = {
  /** 路由级中间件：认证 / 权限 / 审计；顺序即执行顺序 */
  readonly middleware: M;
  /** 契约之外的额外响应（如 `conflictResponse`） */
  readonly responses?: Extra;
  /** 不进入 OpenAPI 文档 */
  readonly hide?: boolean;
};

/** 契约 + 路由选项推导出的 `RouteConfig` 精确类型（供 handler 入参 / 响应类型推导） */
export type RouteOf<Op extends AnyOperation, M extends readonly MiddlewareHandler[], Extra extends ExtraResponses> = {
  method: Op['method'];
  path: Op['path'];
  tags: string[];
  summary: string;
  description?: string;
  deprecated?: boolean;
  security: Array<Record<string, string[]>>;
  middleware: [...M];
  hide?: boolean;
  request: RequestFor<Op>;
  responses: SuccessFor<Op> & typeof commonErrorResponses & Extra;
};

/**
 * 契约推导出的路由类型对泛型 `Op` 而言是未求值的条件类型，无法直接满足 `RouteConfig` 约束；
 * 经条件分发后，具体契约实例化出的路由类型才进入 hono 的 handler / hook 类型推导。
 */
type HandlerFor<R> = R extends RouteConfig ? RouteHandler<R> : never;
type HookFor<R> = R extends RouteConfig ? RouteHook<R> : never;
type Registered<R> = R extends RouteConfig ? OpenAPIRoute<R> : never;

function buildRequest(op: AnyOperation): RouteConfig['request'] {
  const request: NonNullable<RouteConfig['request']> = {};
  if (op.params) request.params = op.params;
  if (op.query) request.query = op.query;
  if (op.headers) request.headers = op.headers;
  if (op.body) {
    request.body = isMultipart(op.body)
      ? { content: { [MULTIPART_CONTENT_TYPE]: { schema: op.body } }, required: true }
      : { content: jsonContent(op.body), required: true };
  }
  return request;
}

function buildSuccess(op: AnyOperation): RouteConfig['responses'] {
  switch (op.kind) {
    case 'excel':
      return okExcel(op.summary);
    case 'csv':
      return okCsv(op.summary);
    case 'file':
      return okFile(op.summary);
    case 'sse':
      return { 200: { content: { 'text/event-stream': { schema: op.response } }, description: op.summary } };
    default:
      return { 200: { content: jsonContent(apiResponse(op.response)), description: op.summary } };
  }
}

/** 契约操作 → `createRoute()` 配置 */
export function toRoute<
  Op extends AnyOperation,
  const M extends readonly MiddlewareHandler[],
  const Extra extends ExtraResponses = Record<never, never>,
>(op: Op, options: RouteOptions<M, Extra>): RouteOf<Op, M, Extra> {
  const config: RouteConfig = {
    method: op.method,
    path: op.path,
    tags: [...op.tags],
    summary: op.summary,
    ...(op.description ? { description: op.description } : {}),
    ...(op.deprecated ? { deprecated: true } : {}),
    security: SECURITY_REQUIREMENTS[op.security],
    middleware: [...options.middleware],
    ...(options.hide ? { hide: true } : {}),
    request: buildRequest(op),
    responses: { ...buildSuccess(op), ...commonErrorResponses, ...(options.responses ?? {}) },
  };
  // 运行时对象按契约逐字段构造；精确类型由 RouteOf 静态推导（createRoute 的泛型约束无法在
  // 未实例化的条件类型上求值，此处是全仓唯一一处需要显式断言的地方）
  return createRoute(config as never) as unknown as RouteOf<Op, M, Extra>;
}

export type ContractRouteDefinition<
  Op extends AnyOperation,
  M extends readonly MiddlewareHandler[],
  Extra extends ExtraResponses,
> = RouteOptions<M, Extra> & {
  /** `c.req.valid('param' | 'query' | 'json')` 与 `c.json(okBody(...), 200)` 均按契约类型检查 */
  readonly handler: NoInfer<HandlerFor<RouteOf<Op, M, Extra>>>;
  readonly hook?: NoInfer<HookFor<RouteOf<Op, M, Extra>>>;
};

/**
 * 由契约定义一条路由：等价于 `defineOpenAPIRoute({ route: toRoute(op, options), handler })`，
 * 产物直接交给 `router.openapiRoutes([...] as const)`。
 */
export function defineContractRoute<
  Op extends AnyOperation,
  const M extends readonly MiddlewareHandler[],
  const Extra extends ExtraResponses = Record<never, never>,
>(op: Op, def: ContractRouteDefinition<Op, M, Extra>): Registered<RouteOf<Op, M, Extra>> {
  const { middleware, responses, hide, handler, hook } = def;
  const route = toRoute(op, { middleware, responses, hide });
  // 同 toRoute：泛型 Op 下 RouteOf 无法静态满足 RouteConfig 约束，具体实例的类型由返回类型给出
  return defineOpenAPIRoute({ route: route as RouteConfig, handler: handler as never, hook: hook as never }) as unknown as Registered<RouteOf<Op, M, Extra>>;
}
