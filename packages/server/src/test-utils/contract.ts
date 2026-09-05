/**
 * 契约测试基建——把整个 app 装配起来做全量路由校验。
 *
 * 与 `routes/identity/users.test.ts` 那类「单路由 + 定制 DB mock」的测试互补：
 * 那种测试验证业务行为，一个文件只覆盖一个路由；本模块面向 267 个路由文件的
 * **契约面**（认证声明、错误响应、响应包络），一次装配覆盖全部 1800+ 操作。
 *
 * 之所以可行，是因为 app.ts 的 `createApp()` 是纯函数——不 serve()、不注册 worker、
 * 不订阅事件总线。需要拦截的外部依赖有两类：模块加载期就发起连接的 `lib/redis`，
 * 以及请求期被中间件栈同步读取的数据库（`maintenanceMiddleware` 挂在 `/api/*` 上，
 * 每个请求——包括取 OpenAPI 文档本身——都会去查 `system_configs`）。
 *
 * 用法（`vi.doMock` 不会被提升，专用于影响后续的动态 import）：
 *
 * ```ts
 * mockServerInfra();
 * const { app, operations } = await buildContractApp();
 * ```
 */
import { vi } from 'vitest';
import { createRedisStub } from './redis-stub';

/** OpenAPI 中承载操作的 HTTP 方法 */
export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface OpenAPIOperation {
  security?: unknown[];
  requestBody?: { content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
  summary?: string;
  tags?: string[];
}

export interface OpenAPIDoc {
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components?: { schemas?: Record<string, unknown> };
}

/** 枚举出的单个操作 */
export interface RouteOperation {
  /** OpenAPI 原始路径，含 `{id}` 占位符 */
  path: string;
  method: HttpMethod;
  operation: OpenAPIOperation;
  /** 供断言消息使用的稳定标识，形如 `GET /api/users` */
  id: string;
  /**
   * 是否显式声明为公开端点。
   * `security: []` 覆盖 app.ts 注册的全局 `security: [{ BearerAuth: [] }]`。
   */
  isDeclaredPublic: boolean;
}

/**
 * 拦截会在模块加载期产生副作用的基础设施。
 *
 * 必须在 `buildContractApp()` 之前调用。用 `vi.doMock` 而非 `vi.mock`：
 * 后者会被提升到文件顶部，从辅助模块里调用不会生效。
 */
export function mockServerInfra(): void {
  // lib/redis 已由全局 setup（src/test-setup.ts）替换为内存替身；这里再注册一次
  // 是让本模块自洽——契约测试的可运行性不依赖 setupFiles 配置存在与否。
  vi.doMock('../lib/redis', () => ({ default: createRedisStub(), closeRedis: vi.fn() }));

  // db 必须一并拦截：maintenanceMiddleware / ipAccessMiddleware 挂在 '/api/*' 上，每个请求都会
  // 查 maintenance_mode / 冷加载 system_settings。CI 没有 PostgreSQL，查询抛错后被全局
  // onError 兜成 500，连 /api/openapi.json 都取不到——整个套件在装配阶段就失败。
  // 契约测试校验的是路由声明面而非数据行为，因此给一个「查不到任何数据」的替身即可
  // （设置副本冷加载得到空行集 → 解析为 schema 默认文档）。
  vi.doMock('../db', () => ({ db: createDbStub() }));

  // ops 域（docker / ssh / 进程管理）会真的起子进程。契约测试只发无凭证请求，
  // 正常情况下会被 authMiddleware 挡在处理器之前；但一旦真的存在漏挂认证的路由，
  // 处理器就会被执行——这正是要检测的缺陷，同时必须保证它不会在 CI 上起进程。
  vi.doMock('node:child_process', () => ({
    exec: vi.fn(),
    execSync: vi.fn(),
    execFile: vi.fn(),
    spawn: vi.fn(),
    spawnSync: vi.fn(),
    fork: vi.fn(),
    default: {},
  }));
}

/**
 * 一个「查不到任何数据」的 drizzle 替身。
 *
 * drizzle 的查询构造器是链式且 thenable 的（`db.select().from(t).where(w).limit(1)`
 * 可直接 await），链条形态在 300+ 个路由文件里千变万化，逐个列举不现实。
 * 这里用代理让任意属性访问都返回可继续链式调用的构造器，await 时按**链尾方法名**
 * 决定返回值：`findFirst` 语义上是单行，必须给 `undefined`，给 `[]` 会被调用方
 * 当成「查到了」（空数组是真值），进而走进本不该走的分支。
 */
function createDbStub(): Record<string, unknown> {
  const makeBuilder = (lastProp: string): unknown => new Proxy(function noop() {} as object, {
    get(_target, prop: string) {
      if (prop === 'then') {
        const value = lastProp === 'findFirst' ? undefined : [];
        return (resolve: (v: unknown) => unknown) => resolve(value);
      }
      return makeBuilder(prop);
    },
    apply: () => makeBuilder(lastProp),
  });

  const db: Record<string, unknown> = new Proxy({}, {
    get(_target, prop: string) {
      if (prop === 'then') return undefined; // 避免 db 本身被当成 thenable
      // 事务回调必须真的被执行，否则包在事务里的处理器会静默跳过整段逻辑
      if (prop === 'transaction') return async (cb: (tx: unknown) => unknown) => cb(db);
      if (prop === '$count') return async () => 0;
      return makeBuilder(prop);
    },
  });
  return db;
}

/**
 * 一个「怎么调都返回 null」的 Redis 替身——实现细节见 test-utils/redis-stub.ts。
 */

/** 只取契约测试用得到的部分，避免耦合 Hono 的完整泛型签名 */
export interface AppLike {
  request(url: string, init?: RequestInit): Promise<Response>;
}

/** 构造完整 app 并取出其 OpenAPI 文档与运行时路由表 */
export async function buildContractApp(): Promise<{
  app: AppLike;
  doc: OpenAPIDoc;
  operations: RouteOperation[];
  /** Hono 运行时路由表（含重复挂载），供路由表快照使用 */
  routes: Array<{ method: string; path: string }>;
}> {
  const { createApp } = await import('../app');
  const { app } = createApp();
  const res = await app.request('/api/openapi.json');
  if (res.status !== 200) {
    throw new Error(`无法取得 OpenAPI 文档，状态码 ${res.status}`);
  }
  const doc = (await res.json()) as OpenAPIDoc;
  const routes = app.routes.map((r) => ({ method: r.method, path: r.path }));
  return { app: app as AppLike, doc, operations: listOperations(doc), routes };
}

/** 把 OpenAPI 文档摊平成操作列表，按 id 稳定排序 */
export function listOperations(doc: OpenAPIDoc): RouteOperation[] {
  const operations: RouteOperation[] = [];
  for (const [path, pathItem] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!(HTTP_METHODS as readonly string[]).includes(method)) continue;
      operations.push({
        path,
        method: method as HttpMethod,
        operation,
        id: `${method.toUpperCase()} ${path}`,
        isDeclaredPublic: Array.isArray(operation.security) && operation.security.length === 0,
      });
    }
  }
  return operations.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 把 `{id}` 之类的占位符替换成具体值。
 *
 * 用 `1` 而非任意字符串：数值型 path param 统一走 `idParam`（`z.coerce.number()`），
 * 传非数字会额外触发一层参数校验，干扰认证契约的判定。
 */
export function fillPathParams(path: string): string {
  return path.replace(/\{[^}]+\}/g, '1');
}

/** 以「无任何凭证」的方式请求一个操作，返回状态码；处理器抛出未捕获异常时返回 -1 */
export async function requestWithoutCredentials(app: AppLike, op: RouteOperation): Promise<number> {
  const hasBody = op.method !== 'get' && op.method !== 'delete';
  try {
    const res = await app.request(fillPathParams(op.path), {
      method: op.method.toUpperCase(),
      headers: { 'Content-Type': 'application/json' },
      ...(hasBody ? { body: '{}' } : {}),
    });
    return res.status;
  } catch {
    return -1;
  }
}

type JsonSchema = {
  $ref?: string;
  allOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  default?: unknown;
};

/** 解析 `#/components/schemas/Name` 引用；非引用原样返回 */
function resolveSchemaRef(doc: OpenAPIDoc, schema: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.replace('#/components/schemas/', '');
  return (doc.components?.schemas?.[name] as JsonSchema | undefined) ?? {};
}

/** 摊平 `$ref` / `allOf` 后的请求体顶层属性表 */
function collectBodyProperties(doc: OpenAPIDoc, schema: JsonSchema): Record<string, JsonSchema> {
  const resolved = resolveSchemaRef(doc, schema);
  const properties: Record<string, JsonSchema> = { ...(resolved.properties ?? {}) };
  for (const part of resolved.allOf ?? []) {
    Object.assign(properties, collectBodyProperties(doc, part));
  }
  return properties;
}

/**
 * 列出某操作 JSON 请求体中声明了 `default` 的顶层属性名。
 *
 * Zod 的 `.default()` 会原样生成到 OpenAPI 的 `default`，因此这是「部分更新 schema 是否会
 * 注入默认值」在契约面的直接观测点。只看顶层属性：嵌套对象作为整体提交，其内部默认值
 * 属于该对象自身的创建语义。
 */
export function listDefaultedBodyProperties(doc: OpenAPIDoc, op: RouteOperation): string[] {
  const schema = op.operation.requestBody?.content?.['application/json']?.schema as JsonSchema | undefined;
  if (!schema) return [];
  return Object.entries(collectBodyProperties(doc, schema))
    .filter(([, property]) => 'default' in resolveSchemaRef(doc, property))
    .map(([name]) => name)
    .sort();
}
