import * as z from 'zod';

/**
 * API 契约 DSL —— 前后端与 Mock 的唯一真相。
 *
 * 一个操作（Operation）同时描述 HTTP 方法、路径、路径参数 / 查询参数 / 请求体 schema
 * 与响应载荷 schema。server 用它生成路由与 OpenAPI，web 用它构造请求与 query hooks，
 * MSW 用它绑定 handler：三端只依赖这里的定义，URL 与形状不再手写。
 *
 * - 路径使用 OpenAPI 风格占位符 `{id}`；`fillPath()` 负责填充，`toColonPath()` 转成 `:id`
 * - `response` 描述的是 `data` 载荷，`{ code, message, data }` 信封由传输层统一处理；
 *   省略时视为 `z.null()`（纯消息响应）
 * - `params` / `query` 必须是 `z.object`（查询串与路径参数按键解析）；`body` 可为任意 schema
 * - 请求侧 schema 可用 `z.coerce` / `.default()`，`InputOf<>` 会据此推导出客户端应传的形状
 */

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** 响应载荷的传输形态；非 `json` 时 `response` 被忽略，客户端走下载 / 流式通道 */
export type ResponseKind = 'json' | 'excel' | 'csv' | 'file' | 'sse';

/**
 * 操作要求的凭证类型，进入 OpenAPI `security`：
 * - `none`：公开接口，无需任何凭证（由 `public: true` 声明）
 * - `bearer`：登录令牌（默认；后台 / 会员 / 审批端均为 Bearer）
 * - `device-signature`：IoT 设备 HMAC 签名头（`X-IoT-Sn` / `X-IoT-Timestamp` / `X-IoT-Sign`）
 * - `open-gateway`：开放平台网关，OAuth2 令牌或 AppKey + HMAC 签名头二选一
 *
 * 凭证的**校验**仍由路由 `middleware` 完成；这里只描述契约，让文档与运行时一致。
 */
export type SecurityScheme = 'none' | 'bearer' | 'device-signature' | 'open-gateway';

/** 路径参数 / 查询参数 schema 的形态约束 */
export type ParamsSchema = z.ZodObject<z.ZodRawShape>;

declare const multipartBrand: unique symbol;

/** 以 `multipart/form-data` 提交的请求体 schema（`multipart()` 的产物）；客户端提交 FormData */
export type MultipartBody<S extends z.ZodType = z.ZodType> = S & { readonly [multipartBrand]: true };

export const MULTIPART_CONTENT_TYPE = 'multipart/form-data';

/**
 * 标记请求体为 multipart：schema 仅用于描述字段（OpenAPI），服务端以 `c.req.parseBody()` 读取，
 * 客户端提交 `FormData`，Mock 收到 `FormData`。文件字段用 `fileField()` 声明。
 */
export function multipart<S extends z.ZodType>(schema: S): MultipartBody<S> {
  return schema.meta({ contentType: MULTIPART_CONTENT_TYPE }) as MultipartBody<S>;
}

export function isMultipart(schema: z.ZodType | undefined): boolean {
  return schema?.meta()?.contentType === MULTIPART_CONTENT_TYPE;
}

/** 上传文件字段（OpenAPI `format: binary`） */
export function fileField(description?: string) {
  return z.unknown().meta({ type: 'string', format: 'binary', ...(description ? { description } : {}) });
}

export interface OperationConfig<
  TParams extends ParamsSchema | undefined,
  TQuery extends ParamsSchema | undefined,
  TBody extends z.ZodType | undefined,
  TResponse extends z.ZodType,
  TKind extends ResponseKind,
  THeaders extends ParamsSchema | undefined = undefined,
> {
  /** 一句话说明，进入 OpenAPI summary */
  readonly summary: string;
  readonly description?: string;
  readonly params?: TParams;
  readonly query?: TQuery;
  readonly body?: TBody;
  /**
   * 业务请求头 schema（键为小写头名，如 `x-idempotency-key`）；进入 OpenAPI header 参数，
   * 服务端 `c.req.valid('header')`，客户端在输入的 `headers` 段提供。认证头不在此声明
   */
  readonly headers?: THeaders;
  /** `data` 载荷 schema；省略 = `z.null()` */
  readonly response?: TResponse;
  /** 公开接口（无需任何凭证）；与 `security` 互斥。默认要求登录令牌 */
  readonly public?: boolean;
  /** 非登录令牌的凭证类型（设备签名 / 开放网关）；省略 = `bearer` */
  readonly security?: Exclude<SecurityScheme, 'none'>;
  /** 默认 `json` */
  readonly kind?: TKind;
  /** 覆盖契约组的 tags */
  readonly tags?: readonly string[];
  readonly deprecated?: boolean;
}

/** `op.xxx()` 的产物：尚未绑定资源根路径 */
export interface UnboundOperation<
  TMethod extends HttpMethod = HttpMethod,
  TPath extends string = string,
  TParams extends ParamsSchema | undefined = ParamsSchema | undefined,
  TQuery extends ParamsSchema | undefined = ParamsSchema | undefined,
  TBody extends z.ZodType | undefined = z.ZodType | undefined,
  TResponse extends z.ZodType = z.ZodType,
  TKind extends ResponseKind = ResponseKind,
  THeaders extends ParamsSchema | undefined = ParamsSchema | undefined,
> {
  readonly method: TMethod;
  /** 相对资源根的路径，`/` 表示根；OpenAPI 风格 `{id}` 占位 */
  readonly path: TPath;
  readonly summary: string;
  readonly description?: string;
  readonly params: TParams;
  readonly query: TQuery;
  readonly body: TBody;
  readonly headers: THeaders;
  readonly response: TResponse;
  /** `security === 'none'` 的便捷读法 */
  readonly public: boolean;
  readonly security: SecurityScheme;
  readonly kind: TKind;
  readonly tags?: readonly string[];
  readonly deprecated: boolean;
}

/** 已绑定到契约组的操作 */
export interface Operation<
  TMethod extends HttpMethod = HttpMethod,
  TPath extends string = string,
  TParams extends ParamsSchema | undefined = ParamsSchema | undefined,
  TQuery extends ParamsSchema | undefined = ParamsSchema | undefined,
  TBody extends z.ZodType | undefined = z.ZodType | undefined,
  TResponse extends z.ZodType = z.ZodType,
  TKind extends ResponseKind = ResponseKind,
  THeaders extends ParamsSchema | undefined = ParamsSchema | undefined,
> extends UnboundOperation<TMethod, TPath, TParams, TQuery, TBody, TResponse, TKind, THeaders> {
  /** 契约组内的键名（如 `list` / `detail`），用于 query key 与日志 */
  readonly name: string;
  /** 资源根路径，如 `/api/tenants` */
  readonly basePath: string;
  /** `basePath + path`，末尾不带 `/` */
  readonly fullPath: string;
  readonly tags: readonly string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyOperation = Operation<HttpMethod, string, any, any, any, any, ResponseKind, any>;

/** 展平交叉类型，悬停提示直接显示最终对象形状 */
type Prettify<T> = T extends infer U ? { [K in keyof U]: U[K] } : never;

/** 无输入段时的空对象 */
export type EmptyInput = Record<never, never>;

/** 字段在客户端是否可省略：optional / default / prefault 或输出类型本身允许 undefined */
type IsOptionalField<S> =
  S extends z.ZodOptional<z.ZodType> ? true
    : S extends z.ZodDefault<z.ZodType> ? true
      : S extends z.ZodPrefault<z.ZodType> ? true
        : S extends z.ZodType ? (undefined extends z.output<S> ? true : false)
          : false;

/**
 * 客户端视角的对象入参：值取 **输出** 类型（`z.coerce.number()` → `number`），
 * 带默认值或可选的字段可省略。用于 params / query。
 */
export type ShapeInput<S extends ParamsSchema> = Prettify<
  { [K in keyof S['shape'] as IsOptionalField<S['shape'][K]> extends true ? K : never]?: z.output<S['shape'][K]> } &
  { [K in keyof S['shape'] as IsOptionalField<S['shape'][K]> extends true ? never : K]: z.output<S['shape'][K]> }
>;

export type ParamsOf<Op extends AnyOperation> = Op['params'] extends ParamsSchema ? ShapeInput<Op['params']> : undefined;
export type QueryOf<Op extends AnyOperation> = Op['query'] extends ParamsSchema ? ShapeInput<Op['query']> : undefined;
export type HeadersOf<Op extends AnyOperation> = Op['headers'] extends ParamsSchema ? ShapeInput<Op['headers']> : undefined;
/** 请求体取 **输入** 类型：带默认值的字段可省略，由服务端补默认；multipart 请求体为 FormData */
export type BodyOf<Op extends AnyOperation> = Op['body'] extends MultipartBody
  ? FormData
  : Op['body'] extends z.ZodType ? z.input<Op['body']> : undefined;
export type OutputOf<Op extends AnyOperation> = z.output<Op['response']>;

/** 一次调用需要提供的全部输入；某段未在契约中声明时该键不存在 */
export type InputOf<Op extends AnyOperation> = Prettify<
  (Op['params'] extends ParamsSchema ? { params: ShapeInput<Op['params']> } : EmptyInput) &
  (Op['query'] extends ParamsSchema ? { query: ShapeInput<Op['query']> } : EmptyInput) &
  (Op['headers'] extends ParamsSchema ? { headers: ShapeInput<Op['headers']> } : EmptyInput) &
  (Op['body'] extends MultipartBody ? { body: FormData } : Op['body'] extends z.ZodType ? { body: z.input<Op['body']> } : EmptyInput)
>;

// ─── 构造 ────────────────────────────────────────────────────────────────────

function createOperation<
  TMethod extends HttpMethod,
  TPath extends string,
  TParams extends ParamsSchema | undefined = undefined,
  TQuery extends ParamsSchema | undefined = undefined,
  TBody extends z.ZodType | undefined = undefined,
  TResponse extends z.ZodType = z.ZodNull,
  TKind extends ResponseKind = 'json',
  THeaders extends ParamsSchema | undefined = undefined,
>(
  method: TMethod,
  path: TPath,
  config: OperationConfig<TParams, TQuery, TBody, TResponse, TKind, THeaders>,
): UnboundOperation<TMethod, TPath, TParams, TQuery, TBody, TResponse, TKind, THeaders> {
  if (!path.startsWith('/')) throw new Error(`契约路径必须以 / 开头：${path}`);
  if (config.public && config.security) throw new Error(`公开操作不能同时声明 security：${path}`);
  const security: SecurityScheme = config.public ? 'none' : (config.security ?? 'bearer');
  return {
    method,
    path,
    summary: config.summary,
    description: config.description,
    params: config.params as TParams,
    query: config.query as TQuery,
    body: config.body as TBody,
    headers: config.headers as THeaders,
    response: (config.response ?? z.null()) as TResponse,
    public: security === 'none',
    security,
    kind: (config.kind ?? 'json') as TKind,
    tags: config.tags,
    deprecated: config.deprecated ?? false,
  };
}

type OpBuilder<TMethod extends HttpMethod> = <
  const TPath extends string,
  TParams extends ParamsSchema | undefined = undefined,
  TQuery extends ParamsSchema | undefined = undefined,
  TBody extends z.ZodType | undefined = undefined,
  TResponse extends z.ZodType = z.ZodNull,
  TKind extends ResponseKind = 'json',
  THeaders extends ParamsSchema | undefined = undefined,
>(
  path: TPath,
  config: OperationConfig<TParams, TQuery, TBody, TResponse, TKind, THeaders>,
) => UnboundOperation<TMethod, TPath, TParams, TQuery, TBody, TResponse, TKind, THeaders>;

const builder = <TMethod extends HttpMethod>(method: TMethod): OpBuilder<TMethod> =>
  (path, config) => createOperation(method, path, config);

/** 操作构造器：`op.get('/{id}', { params: idParam, response: tenantSchema, summary: '租户详情' })` */
export const op = {
  get: builder('get'),
  post: builder('post'),
  put: builder('put'),
  patch: builder('patch'),
  delete: builder('delete'),
} as const;

export interface ContractDefaults {
  /** OpenAPI tags，默认由 basePath 派生 */
  readonly tags?: readonly string[];
}

export type Bind<T> = T extends UnboundOperation<
  infer M extends HttpMethod,
  infer P extends string,
  infer Pa extends ParamsSchema | undefined,
  infer Q extends ParamsSchema | undefined,
  infer B extends z.ZodType | undefined,
  infer R extends z.ZodType,
  infer K extends ResponseKind,
  infer H extends ParamsSchema | undefined
>
  ? Operation<M, P, Pa, Q, B, R, K, H>
  : never;

/**
 * 契约组入参的最小形态。刻意不用 UnboundOperation 做约束：内联的 op.xxx() 调用会被约束
 * 反向提供上下文类型，导致无实参候选的泛型（response / kind）退化为约束而非默认值。
 */
type OperationMarker = { readonly method: HttpMethod; readonly path: string; readonly summary: string };

/** 契约组：各操作 + 资源根路径 */
export type Contract<TOps extends Record<string, OperationMarker>> = {
  readonly [K in keyof TOps]: Bind<TOps[K]>;
} & { readonly basePath: string };

/** 任意契约组（用于泛型约束） */
export type AnyContract = { readonly basePath: string } & Record<string, AnyOperation | string>;

/**
 * 定义契约组：把一组操作绑定到资源根路径。
 *
 * ```ts
 * export const tenantContract = defineContract('/api/tenants', {
 *   list:   op.get('/',        { query: paginationQuery, response: paginated(tenantSchema), summary: '租户列表' }),
 *   detail: op.get('/{id}',    { params: idParam, response: tenantSchema, summary: '租户详情' }),
 *   remove: op.delete('/{id}', { params: idParam, summary: '删除租户' }),
 * });
 * ```
 */
export function defineContract<const TOps extends Record<string, OperationMarker> & { basePath?: never }>(
  basePath: string,
  ops: TOps,
  defaults: ContractDefaults = {},
): Contract<TOps> {
  if (!basePath.startsWith('/') || basePath.endsWith('/')) {
    throw new Error(`契约根路径必须以 / 开头且不以 / 结尾：${basePath}`);
  }
  const defaultTags = defaults.tags ?? [defaultTagOf(basePath)];
  const bound: Record<string, unknown> = { basePath };
  for (const [name, def] of Object.entries(ops as unknown as Record<string, UnboundOperation>)) {
    const fullPath = joinPath(basePath, def.path);
    bound[name] = { ...def, name, basePath, fullPath, tags: def.tags ?? defaultTags } satisfies Operation;
  }
  return bound as Contract<TOps>;
}

/** 契约组内的全部操作（跳过 basePath 等非操作字段） */
export function contractOperations(contract: AnyContract): AnyOperation[] {
  return Object.values(contract).filter((v): v is AnyOperation => typeof v === 'object' && v !== null && 'method' in v);
}

// ─── 路径工具 ────────────────────────────────────────────────────────────────

function joinPath(basePath: string, path: string): string {
  const joined = path === '/' ? basePath : `${basePath}${path}`;
  return joined.length > 1 ? joined.replace(/\/+$/, '') : joined;
}

/** `/api/payment/sharing` → `PaymentSharing`（OpenAPI tag 缺省值） */
function defaultTagOf(basePath: string): string {
  return basePath
    .replace(/^\/api\//, '')
    .split(/[/-]/)
    .filter(Boolean)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');
}

const PLACEHOLDER = /\{([^}]+)\}/g;

/** 路径中的占位符名列表：`/api/a/{id}/b/{code}` → `['id', 'code']` */
export function pathParamNames(path: string): string[] {
  return [...path.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/** 用参数填充占位符；缺参数抛错而不是发出 `/api/a/undefined` */
export function fillPath(path: string, params?: Record<string, unknown>): string {
  return path.replace(PLACEHOLDER, (_m, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`路径参数「${name}」缺失：${path}`);
    }
    return encodeURIComponent(String(value));
  });
}

/** `{id}` → `:id`（Hono / MSW 路径风格） */
export function toColonPath(path: string): string {
  return path.replace(PLACEHOLDER, (_m, name: string) => `:${name}`);
}

/** 由资源根路径派生 query key 前缀：`/api/tenants` → `tenants`，`/api/payment/sharing` → `payment/sharing` */
export function resourceKeyOf(basePath: string): string {
  return basePath.replace(/^\/api\//, '');
}
