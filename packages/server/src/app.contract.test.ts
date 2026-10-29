/**
 * 在装配后的 app 上校验认证、公开接口 security 声明及 commonErrorResponses，
 * 并用路由表快照检测端点增删、路径变更和漏挂载（仅断言总数下限无法覆盖这些变化）。
 * 契约与快照共用一次 app 装配，避免隔离 worker 重复加载完整模块图。
 * 有意的接口变更需更新快照并审查 diff；快照按方法和路径排序去重，不验证挂载顺序，
 * 顺序调整须人工核对 routes/_kit.ts 约束 1。
 * 相关规范见 .agents/skills/zenith/references/constraints.md 的 Route 层。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { listAllOperations } from '@zenith/shared/contracts';
import { LICENSE_FEATURES } from '@zenith/shared/licensing';
import { FULL_REPLACE_OPERATIONS } from './test-utils/contract-exceptions';
import { accessMismatches } from './test-utils/contract-checks';
import {
  mockServerInfra,
  buildContractApp,
  requestWithoutCredentials,
  listDefaultedBodyProperties,
  type AppLike,
  type OpenAPIDoc,
  type RouteOperation,
} from './test-utils/contract';
import type { RouteAccessFacts } from './test-utils/route-facts';

mockServerInfra();

let app: AppLike;
let doc: OpenAPIDoc;
let operations: RouteOperation[];
let routes: Array<{ method: string; path: string }>;
let accessFacts: Map<string, RouteAccessFacts>;
/** 无凭证访问时的实际状态码，按操作 id 索引 */
const unauthenticatedStatus = new Map<string, number>();

beforeAll(async () => {
  const built = await buildContractApp();
  app = built.app;
  doc = built.doc;
  operations = built.operations;
  routes = built.routes;
  accessFacts = built.accessFacts;

  // 全量探测一次，后续断言复用结果——对所有操作的进程内请求成本可观，
  // 拆到各 it 里重复发送会让耗时翻倍。
  for (const op of operations) {
    unauthenticatedStatus.set(op.id, await requestWithoutCredentials(app, op));
  }
  // 超时放宽到 480 秒：耗时几乎全在 buildContractApp() 转译整套 app，
  // 而发布流程的四路并行（lint / test / build / docs）抢的正是同一种转译资源。
  // 独占跑约 60-90 秒，并行下曾贴着 300 秒撞破——属「慢但有效」，不是卡死。
  // 见 .agents/skills/zenith/references/troubleshooting.md → 性能
}, 480_000);

describe('路由表快照', () => {
  /**
   * 锁定全部 method + path，捕获误删、误改路径、以及子路由器忘记挂载。
   * 路由文件没有任何路由级单元测试，这是「接口被静默删掉」的唯一防线。
   */
  it('完整路由表保持不变', () => {
    // routes 含中间件条目（method 为 ALL），只取真正的端点；
    // 排序保证快照稳定——注册顺序不在本快照的锁定范围内。
    const table = [...new Set(
      routes
        .filter((r) => r.method !== 'ALL')
        .map((r) => `${r.method} ${r.path}`),
    )].sort();

    expect(table.length).toBeGreaterThan(1500);
    expect(table).toMatchSnapshot();
  });
});

/** 该操作的成功响应是否为 JSON——文件下载、SSE、渠道回调 ACK 等均不是 */
function producesJson(op: RouteOperation): boolean {
  const ok200 = op.operation.responses?.['200'];
  return Boolean(ok200?.content?.['application/json']);
}

describe('路由装配', () => {
  it('每个登记的授权功能都有实际 API 门控，新增功能不能只补矩阵', async () => {
    const { ROUTE_DOMAINS } = await import('./routes');
    const features = new Set(ROUTE_DOMAINS.flatMap((domain) =>
      domain.mounts().flatMap(([, , options]) => options?.feature ? [options.feature] : []),
    ));
    expect(LICENSE_FEATURES.filter((feature) => !features.has(feature)), '以下功能只有授权登记、没有 API 门控').toEqual([]);
  });

  it('OpenAPI 文档暴露了预期规模的操作', () => {
    // 下界防止「路由域整体没挂上」这类静默失败（如 fallback 挂载顺序问题）
    // 就属于这一类：CMS SSR 挂在 '/' 会吞掉一切未匹配路径。
    expect(operations.length).toBeGreaterThan(1500);
  });

  it('不存在重复注册的 method + path', () => {
    const seen = new Set<string>();
    const duplicated: string[] = [];
    for (const op of operations) {
      if (seen.has(op.id)) duplicated.push(op.id);
      seen.add(op.id);
    }
    expect(duplicated).toEqual([]);
  });

  it('未匹配的路径返回标准 404 包络', async () => {
    const res = await app.request('/api/__definitely_not_a_route__');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 404 });
  });

  it.each([
    '/api/wiki/docs/2147483647',
    '/api/wiki/tags/2147483647',
    '/api/wiki/comments/2147483647',
  ])('无 Origin 的 Bearer DELETE 进入真实认证门禁：%s', async (path) => {
    const res = await app.request(path, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer csrf-regression-invalid-token' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 401, message: '登录已过期' });
  });

  it('CSRF 拒绝经全局错误处理返回明确文案', async () => {
    const res = await app.request('/api/wiki/docs/2147483647', { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 403, message: '请求来源校验失败', data: null });
  });

  /**
   * 路径遮蔽：契约里的操作不能被**另一个**路由抢先匹配。
   *
   * Hono 按注册顺序匹配：`GET /{id}` 先注册时，`GET /calendar` 会落进 `{id}` 的
   * `z.coerce.number()` 校验，返回「参数「id」类型不正确，期望 number」。路由表快照
   * （只存 method + path 且已排序）与「未认证一律 401」（ID 路径同样要认证）都看不出问题。
   *
   * 因此这里按注册顺序模拟一次匹配：找到与方法 + 路径模式都相符的**第一个**已注册路由，
   * 它必须就是契约自己声明的那条路径。静态路径被参数路径抢先就命中不了自己，直接标红。
   * 修法优先用 `orderRoutes()` 排序（见 `routes/_crud.ts`），而不是调换注册顺序依赖人工记忆。
   */
  it('契约里的操作不会被同方法下先注册的参数路径遮蔽', () => {
    const escapeSegment = (segment: string) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = (path: string) => new RegExp(`^${path.split('/').map((segment) => (segment.startsWith(':') ? '[^/]+' : escapeSegment(segment))).join('/')}$`);
    // 只有「同方法 + 同段数」才可能互相匹配：按这两个维度分桶，避免 2500×2500 全量比对
    const buckets = new Map<string, { path: string; re: RegExp }[]>();
    for (const route of routes) {
      if (route.method === 'ALL') continue;
      const key = `${route.method} ${route.path.split('/').length}`;
      buckets.set(key, [...(buckets.get(key) ?? []), { path: route.path, re: pattern(route.path) }]);
    }
    const toHonoPath = (fullPath: string) => fullPath.replace(/\{([^}]+)\}/g, ':$1');

    const shadowed: string[] = [];
    for (const { op } of listAllOperations()) {
      const method = op.method.toUpperCase();
      const path = toHonoPath(op.fullPath);
      const winner = (buckets.get(`${method} ${path.split('/').length}`) ?? []).find((candidate) => candidate.re.test(path));
      if (winner && winner.path !== path) shadowed.push(`${method} ${path} → 先被 ${winner.path} 匹配`);
    }

    expect(shadowed).toEqual([]);
  });
});

describe('认证契约：声明与运行时行为必须一致', () => {
  /**
   * 这是本套件最重要的断言。
   *
   * app.ts 注册了全局 `security: [{ BearerAuth: [] }]`，因此**未显式声明
   * `security: []` 的操作即宣称自己需要 Bearer 令牌**。宣称受保护就必须真的受保护：
   * 无凭证访问只能得到 401。
   *
   * 若此处失败，只有两种可能，都必须修：
   *  - 该操作本就是公开端点 → 给它补上 `security: []`，让文档说实话
   *  - 该操作应当受保护 → 它漏挂了 `authMiddleware`，是一个未授权访问漏洞
   */
  it('声明需要 BearerAuth 的操作，无凭证访问一律返回 401', () => {
    const violations = operations
      .filter((op) => !op.isDeclaredPublic)
      .map((op) => ({ id: op.id, status: unauthenticatedStatus.get(op.id) ?? 0 }))
      .filter((r) => r.status !== 401)
      .map((r) => `${r.id} → ${r.status}`);

    expect(violations).toEqual([]);
  });

  /**
   * 反向校验：声明为公开的操作不应该返回 401。
   *
   * 出现 401 说明该操作实际挂了认证中间件，`security: []` 是错误声明——
   * 接入方会以为不需要令牌，调用后收到 401 且无从查证。
   */
  it('声明为公开（security: []）的操作，无凭证访问不应返回 401', () => {
    const violations = operations
      .filter((op) => op.isDeclaredPublic)
      .filter((op) => unauthenticatedStatus.get(op.id) === 401)
      .map((op) => op.id);

    expect(violations).toEqual([]);
  });

  it('公开端点数量维持在小范围内', () => {
    // 公开端点是攻击面。数量本身不是错误，但增长必须是显式、有意识的决定，
    // 因此在这里设一道阈值：新增公开端点会让这条断言失败，迫使评审。
    // 企业网盘外链 4 个匿名端点（/api/drive/public/shares/*：换会话 / 元信息 / 子目录 / 内容），
    // 均受路径绑定限流 drive_public_share 与 Redis 访问会话（sessionVersion 可整体吊销）约束。
    // CMS 前台 4 个匿名端点（/api/public/cms/*：验证码 / 互动问卷查询与提交 / 广告事件令牌），
    // 均受 Redis IP 限流、站点解析与一次性令牌约束。
    // 审批单验真页 1 个匿名端点（GET /api/workflows/print-verify/{token}）：HMAC 签名令牌、只输出单据身份与终态、
    // 无表单内容与参与人、无脚本、noindex；全局路径限流可按 /api/workflows/print-verify/* 配置。
    // 会话并发拒绝模式 1 个匿名端点（POST /api/auth/session-conflict/resolve）：与 MFA 验证同构——凭据已通过后签发的
    // 5 分钟一次性票据（GETDEL），受 authRateLimit 约束，不接受任何身份声明。
    const publicOps = operations.filter((op) => op.isDeclaredPublic);
    // CMS telemetry validates a signed published-page context and stable event IDs before anonymous ingest.
    expect(publicOps.length).toBeLessThanOrEqual(69);
  });
});

describe('权限契约：契约 access 与运行时门禁必须一致', () => {
  /**
   * 后台登录令牌（bearer）操作的门禁由 `defineContractRoute` 按契约 `access` / `audit` / `feature` 装配，
   * 路由文件不手写 `authMiddleware` / `guard()` / `platformAdminOnly()`。这里沿 `app.routes` 读回
   * 中间件的自描述标记（`lib/route-facts.ts`），逐端点对照契约：
   *  - 权限码集合、平台超管限定、审计声明、功能门控与契约完全一致
   *  - 门禁链上认证 / 平台 / 权限守卫各至多一条——多出来的就是路由里手写的门禁
   * 权限矩阵、Demo Mock 与前端按钮都从契约读取访问要求，这条断言保证它们读到的与线上生效的是同一份。
   */
  it('每个后台登录令牌操作生效的门禁等于契约声明', () => {
    const result = accessMismatches(listAllOperations().map(({ op }) => op), accessFacts);
    expect(result.checked).toBeGreaterThan(2000);
    expect(result.violations).toEqual([]);
  });
});

describe('错误响应契约', () => {
  /**
   * constraints.md Route 层：所有路由的 responses 块必须包含 `...commonErrorResponses`
   * （涵盖 400/401/403/404/500）。
   *
   * 豁免规则不是白名单，而是一条原则：**不返回 JSON 的端点不适用 JSON 错误契约**。
   * 微信/支付宝回调必须按渠道协议返回纯文本 ACK，给它们声明 `{ code, message }`
   * 错误体只会误导接入方。判据取 200 响应的 content-type，随代码自动演进。
   */
  it('所有返回 JSON 的操作都声明了 commonErrorResponses 的全部状态码', () => {
    const required = ['400', '401', '403', '404', '500'];
    const violations = operations
      .filter(producesJson)
      .map((op) => {
        const responses = op.operation.responses ?? {};
        const missing = required.filter((code) => !(code in responses));
        return missing.length ? `${op.id} 缺少 ${missing.join('/')}` : null;
      })
      .filter((v): v is string => v !== null);

    expect(violations).toEqual([]);
  });

  it('错误响应体使用统一的 code/message 包络', async () => {
    const res = await app.request('/api/users');
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('code');
    expect(body).toHaveProperty('message');
    expect(typeof body.message).toBe('string');
  });
});

describe('成功响应契约', () => {
  /**
   * constraints.md Route 层：200 响应由 `defineContractRoute` 按契约 `response` 统一包进
   * `{ code, message, data }` 包络。这里校验声明层面确实是这个形状，防止协议端点直接写裸实体。
   */
  it('所有 200 响应都是 { code, message, data } 包络', () => {
    const violations: string[] = [];
    for (const op of operations) {
      const schema = op.operation.responses?.['200']?.content?.['application/json']?.schema as
        | { properties?: Record<string, unknown>; $ref?: string; allOf?: unknown[] }
        | undefined;
      // 无 JSON 200 响应（文件下载、SSE、重定向等）不适用
      if (!schema || schema.$ref || schema.allOf) continue;
      const props = schema.properties;
      if (!props) continue;
      if (!('code' in props) || !('message' in props)) {
        violations.push(op.id);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('部分更新契约', () => {
  /**
   * PUT / PATCH 的语义是「未提交的字段保持不变」。请求体属性一旦携带 `default`，
   * Zod 就会在字段省略时填入默认值，服务层 `.set({ ...data })` 随即把从未提交的字段写回库。
   * update schema 必须经 `partialForUpdate()`（@zenith/shared/core）派生，
   * 它会剥离全部 `.default()`；直接调用 `.partial()` 已被 ESLint 封禁。
   *
   * 这里从装配好的 OpenAPI 文档反向校验，覆盖路由内联 schema、DTO 与全部 shared 域，
   * 不依赖 schema 声明在哪个文件。
   */

  /**
   * 整体替换 / upsert 端点的例外：客户端每次提交完整记录，服务端整体写入（可能新建），
   * 此时 `default` 是该记录的创建默认值而非对既有字段的静默改写。
   * 新增例外必须在此登记并写明理由；条目一旦不再命中会被下方断言清理。
   */


  it('PUT / PATCH 请求体的顶层属性不得声明 default', () => {
    const violations = operations
      .filter((op) => (op.method === 'put' || op.method === 'patch') && !FULL_REPLACE_OPERATIONS.has(op.id))
      .map((op) => ({ id: op.id, defaulted: listDefaultedBodyProperties(doc, op) }))
      .filter((r) => r.defaulted.length > 0)
      .map((r) => `${r.id}: ${r.defaulted.join(', ')}`);

    expect(violations).toEqual([]);
  });

  it('整体替换例外清单只保留仍然命中的端点', () => {
    const byId = new Map(operations.map((op) => [op.id, op]));
    const stale = [...FULL_REPLACE_OPERATIONS.keys()].filter((id) => {
      const op = byId.get(id);
      return !op || listDefaultedBodyProperties(doc, op).length === 0;
    });

    expect(stale).toEqual([]);
  });
});
