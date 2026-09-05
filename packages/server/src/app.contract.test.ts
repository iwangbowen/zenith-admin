/**
 * 路由契约测试——覆盖全部路由文件暴露的所有操作，并锁定完整路由表快照。
 *
 * 为什么需要这层测试：
 * service 层已有近 200 个单测，但它们测不到路由声明本身。以下缺陷类型只有在
 * 装配好的 app 上才能发现，且一旦发生后果严重：
 *
 *  1. 敏感路由漏挂 `authMiddleware` —— 未认证即可访问，service 单测完全无感
 *  2. 公开路由漏写 `security: []` —— OpenAPI 文档撒谎，接入方被误导；更糟的是
 *     它污染了「已声明受保护」集合，使真正的漏挂认证淹没在噪声里无法辨识
 *  3. 漏写 `commonErrorResponses` —— 前端拿不到规范的错误契约
 *  4. 接口被静默删掉 / 误改路径 / 子路由器忘记挂载 —— 由路由表快照锁定，
 *     契约断言只有 `operations.length > 1500` 这类下界，删单个路由不会触发
 *
 * 快照与契约放在同一个文件：两者都需要装配整个 app（转译 + 执行 1400+ 模块的
 * 完整模块图，是全套件最贵的一步），拆成两个文件会在隔离 worker 里把这笔成本
 * 原样付两遍（实测每份 50-60s）。
 *
 * 快照变更本身不是错误——新增接口就应该更新快照。它的价值在于**强制这件事被看见**：
 * `npx vitest -u` 之后 diff 会明确显示动了哪些路由。
 *
 * **不锁挂载顺序。** 曾有一份「域装配清单」快照试图锁定它，但清单里只存挂载路径，
 * 而顺序真正有语义的场景恰恰是同一路径被多次挂载（`/api/analytics` ×4、
 * `/api/ai/conversations` ×3）——此时互换两条挂载得到逐字节相同的清单，
 * 它防不住自己声称要防的那件事，却让人以为顺序已被保护。已移除，
 * 顺序改动需人工核对，见 `routes/_kit.ts` 约束 1。
 *
 * 相关约束见 .agents/skills/zenith/references/constraints.md 的 Route 层章节。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  mockServerInfra,
  buildContractApp,
  requestWithoutCredentials,
  listDefaultedBodyProperties,
  type AppLike,
  type OpenAPIDoc,
  type RouteOperation,
} from './test-utils/contract';

mockServerInfra();

let app: AppLike;
let doc: OpenAPIDoc;
let operations: RouteOperation[];
let routes: Array<{ method: string; path: string }>;
/** 无凭证访问时的实际状态码，按操作 id 索引 */
const unauthenticatedStatus = new Map<string, number>();

beforeAll(async () => {
  const built = await buildContractApp();
  app = built.app;
  doc = built.doc;
  operations = built.operations;
  routes = built.routes;

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
  it('OpenAPI 文档暴露了预期规模的操作', () => {
    // 下界防止「路由域整体没挂上」这类静默失败——曾经的 fallback 挂载顺序问题
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
    // 2026-09：企业网盘外链新增 4 个匿名端点（/api/drive/public/shares/*：换会话 / 元信息 / 子目录 / 内容），
    // 均受路径绑定限流 drive_public_share 与 Redis 访问会话（sessionVersion 可整体吊销）约束。
    // CMS 前台 4 个匿名端点（/api/public/cms/*：验证码 / 互动问卷查询与提交 / 广告事件令牌），
    // 均受 Redis IP 限流、站点解析与一次性令牌约束。
    const publicOps = operations.filter((op) => op.isDeclaredPublic);
    expect(publicOps.length).toBeLessThanOrEqual(66);
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
   * constraints.md Route 层：200 响应统一用 `...ok()` / `...okPaginated()` / `...okMsg()`
   * 构造，它们都会把 DTO 包进 `{ code, message, data }` 包络。
   * 这里校验声明层面确实是这个形状，防止有人绕过辅助函数直接写裸 DTO。
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
  const FULL_REPLACE_OPERATIONS = new Map<string, string>([
    ['PUT /api/broadcasts/{id}', '群发活动编辑复用创建 schema，标题 / 内容 / 渠道 / 受众类型必填'],
    ['PUT /api/channels/admin/messages/{id}', '草稿 / 定时消息编辑即整体重写消息内容与投递配置'],
    ['PUT /api/cms/sites/{id}/open-grants', '按 clientId upsert 开放应用授权记录'],
    ['PUT /api/cms/widgets/slots/{slotKey}', '绑定 / 清空主题插槽，siteId 与 widgetId 必填'],
    ['PUT /api/email-config', '单例邮件配置表单整体保存（upsert）'],
    ['PUT /api/marketing/campaigns/{campaignId}/prizes/{prizeId}', '奖品保存与创建共用 schema，名称 / 类型必填'],
    ['PUT /api/notification-policies/overrides', '按 eventKey + channel upsert 渠道覆盖记录'],
    ['PUT /api/system-scheduler/tasks/{name}/config', '任务策略表单整体保存，开关 / 保留策略 / 阈值必填'],
  ]);

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
