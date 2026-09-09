/**
 * 应用装配——纯函数，无副作用。
 *
 * 与 src/index.ts 的分工：本文件只负责"把 app 组装出来"（中间件栈 → 路由挂载
 * → 文档 → 兜底与错误处理），不启动服务器、不注册后台 worker、不订阅事件总线、
 * 不启动采样器。这样 app 才能在测试中被直接构造（此前 index.ts 顶层就有
 * serve()，导致 250 个路由文件里只有 2 个有测试）。
 *
 * 路由不再逐条罗列，而是由 src/routes/index.ts 的 ROUTE_DOMAINS 按域装配，
 * 详见 src/routes/_kit.ts。路由表由 src/app.contract.test.ts 快照锁定。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { timing } from 'hono/timing';
import { httpInstrumentationMiddleware } from '@hono/otel';
import { prometheus } from '@hono/prometheus';
import { compress } from 'hono/compress';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from 'hono/request-id';
import { bodyLimit } from 'hono/body-limit';
import { timeout } from 'hono/timeout';
import { except } from 'hono/combine';
import { HTTPException } from 'hono/http-exception';
import { contextStorage } from 'hono/context-storage';
import { csrf } from 'hono/csrf';
import { swaggerUI } from '@hono/swagger-ui';
import { Registry } from 'prom-client';
import { pinoHttp, type HttpLogger } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import { config } from './config';
import logger from './lib/logger';
import { htmlSecurityHeadersMiddleware } from './lib/html-security-headers';
import { errBody } from './lib/openapi-schemas';
import { CONTRACT_SECURITY_SCHEMES } from './lib/contract-route';
import { OAuth2Error, oauth2ErrorBody } from './lib/oauth2-error';
import { registerZenithMetrics } from './lib/prometheus-metrics';
import { httpMetricsMiddleware } from './middleware/http-metrics';
import { httpLoggerMiddleware } from './middleware/http-logger';
import { ipAccessMiddleware } from './middleware/ip-access';
import { maintenanceMiddleware } from './middleware/maintenance';
import { authRateLimit, captchaRateLimit, pathBoundRateLimit, sensitiveRateLimit } from './middleware/rate-limit';
import { requestTraceMiddleware } from './middleware/request-trace';
import { authMiddleware } from './middleware/auth';
import { guard } from './middleware/guard';
import { ROUTE_DOMAINS } from './routes';
import { licenseFeatureGate } from './lib/licensing';
import { getCachedOpenApiDoc, setCachedOpenApiDoc } from './lib/openapi-doc-cache';

declare module 'hono' {
  interface ContextVariableMap {
    /** pino-http 注入的请求级子 logger（绑定 reqId）；测试 app.request() 场景下不存在 */
    logger?: Logger;
  }
}

export function createApp() {
  const app = new OpenAPIHono();
  const promRegistry = new Registry();
  const { printMetrics, registerMetrics } = prometheus({ collectDefaultMetrics: true, registry: promRegistry });
  // 业务/系统指标（CPU/内存/HTTP/WS/DB/Redis 等）注册到同一 Registry，由 GET /metrics 统一输出
  registerZenithMetrics(promRegistry);

  app.use('*', registerMetrics);
  // 监控页指标采集（自带的轻量收集器，独立于 Prometheus）
  app.use('*', httpMetricsMiddleware);
  if (config.otel.enabled) {
    app.use(
      '*',
      httpInstrumentationMiddleware({
        serviceName: config.otel.serviceName,
        serviceVersion: config.otel.serviceVersion,
        captureRequestHeaders: ['x-request-id', 'user-agent'],
        captureResponseHeaders: ['x-request-id'],
      }),
    );
  }
  app.use('*', requestId());
  // AsyncLocalStorage 上下文（允许 currentUser()/getCtx() 在辅助函数中零参取值）
  app.use('*', contextStorage());
  // 链路关联 traceId：贯穿请求触发的工作流作业/事件 fan-out（跨异步/跨实例）
  app.use('*', requestTraceMiddleware);
  app.use('*', secureHeaders({
    crossOriginResourcePolicy: 'cross-origin', // API 允许跨域访问
    crossOriginOpenerPolicy: false,             // 纯 API 服务，不适用
    // CMS 前台 SSR、短链 / 退订 / 表单提示页等 HTML 由本进程直出：默认禁止跨站嵌入（点击劫持）
    xFrameOptions: 'SAMEORIGIN',
  }));
  // 流式/二进制路由排除压缩：SSE 实时推送 + 文件下载不能被缓冲压缩
  const COMPRESS_EXCLUDE_PREFIXES = ['/api/ws', '/api/files', '/api/db-backups', '/api/db-admin', '/api/log-files', '/api/log-viewer', '/api/monitor/stream', '/api/ai/conversations', '/api/ai/arena', '/api/ai/generations', '/api/public/app-releases'];
  app.use('*', except(
    (c) => COMPRESS_EXCLUDE_PREFIXES.some((p) => c.req.path.startsWith(p)),
    compress(),
  ));
  // 直出 HTML 的 CSP（按响应内联脚本哈希放行）与帧保护，见 lib/html-security-headers.ts。
  // 必须注册在 compress 之后（链路上位于其内侧），这样读到的是压缩前的正文，输出再交给 compress 压缩。
  app.use('*', htmlSecurityHeadersMiddleware);
  // allowMethods 使用 hono 官方默认值（含 PATCH/QUERY），避免显式列表遗漏导致跨域预检失败；
  // allowHeaders 留空 = 反射预检请求头（hono 默认），兼容携带自定义头的客户端。
  // Mastra Studio 的请求带 credentials:'include'，通配符 '*' 对凭据模式无效
  // → /api/mastra 单独反射请求 Origin 并允许凭据（该域鉴权走 Bearer + 权限,不依赖 Cookie）
  app.use('/api/mastra/*', cors({ origin: (origin) => origin, credentials: true, exposeHeaders: ['X-Request-Id'] }));
  app.use('*', except(
    (c) => c.req.path.startsWith('/api/mastra'),
    cors({ origin: config.corsOrigin, exposeHeaders: ['X-Request-Id'] }),
  ));
  // CSRF 防护：校验 Origin 头，防止跨站请求伪造
  // ALLOWED_ORIGINS 为空时（开发模式）不限制
  //
  // 注意：hono 的 csrf() 只对「表单类 Content-Type 且非 GET/HEAD」生效，且在缺失 Origin 时
  // 直接判定为不安全请求——自定义 origin 回调不会被调用。因此机器对机器端点（OAuth2 令牌端点、
  // 开放 API 网关、SAML ACS 回调）必须显式排除，否则 curl / SDK / 第三方服务端调用一律 403。
  // 这些端点本身不依赖 Cookie 会话（用 client_secret / HMAC 签名 / Bearer 鉴权），不存在 CSRF 风险面。
  const CSRF_EXCLUDE_PREFIXES = [
    '/api/auth/enterprise/saml/acs',
    '/api/oauth2/token',
    '/api/oauth2/authorize',
    '/api/open/',
  ];
  app.use(
    '*',
    except(
      (c) => CSRF_EXCLUDE_PREFIXES.some((p) => c.req.path === p || c.req.path.startsWith(p)),
      csrf({
        origin: (origin) => {
          if (!origin) return true;
          if (config.allowedOrigins.length === 0) return true; // 开发模式，不限制
          return config.allowedOrigins.includes(origin);
        },
      }),
    ),
  );
  // ─── 访问日志（pino-http，官方 Hono 集成方式）────────────────────────────────
  // 桥接到 @hono/node-server 暴露的裸 req/res；测试中 app.request() 无 Node socket，
  // c.env.incoming 不存在时跳过（访问日志本就属于服务器运行时）。
  // 基础设施路径不记访问日志；5xx 记 error（计入 logErrorPerMin），其余 info。
  const ACCESS_LOG_IGNORE_PREFIXES = ['/api/health', '/api/metrics', '/api/ws'];
  const accessLog: HttpLogger = pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => ACCESS_LOG_IGNORE_PREFIXES.some((p) => (req.url ?? '').startsWith(p)),
    },
    customLogLevel: (_req, res) => (res.statusCode >= 500 ? 'error' : 'info'),
    customSuccessMessage: (req, res, responseTime) =>
      `${req.method} ${req.url} ${res.statusCode} ${responseTime}ms`,
    customErrorMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
    // 精简序列化：访问行只留 reqId（quietReqLogger 绑定）+ 方法/路径/状态码/耗时，
    // 不倾倒 req/res 对象与 headers（敏感且冗长）
    serializers: {
      req: () => undefined,
      res: () => undefined,
    },
    quietReqLogger: true,
  });
  app.use('*', async (c, next) => {
    const env = c.env as { incoming?: IncomingMessage & { id?: string }; outgoing?: ServerResponse } | undefined;
    if (env?.incoming && env.outgoing) {
      env.incoming.id = c.get('requestId'); // 复用 hono requestId 作为访问日志关联 ID
      accessLog(env.incoming, env.outgoing);
      c.set('logger', env.incoming.log);    // 请求级子 logger，handler 内 c.get('logger') 可用
    }
    await next();
  });
  // HTTP 流量详细日志（对标 Logbook），默认关闭，通过 HTTP_LOG_INCOMING_ENABLED=true 启用
  app.use('*', httpLoggerMiddleware);
  if (config.serverTimingEnabled) {
    app.use('*', timing());
  }

  // ─── 请求体大小限制（全局）───────────────────────────────────────────────────
  // config.requestBodyLimit === 0 时不挂载，使用运行时默认
  if (config.requestBodyLimit > 0) {
    app.use(
      '*',
      bodyLimit({
        maxSize: config.requestBodyLimit,
        onError: (c) => c.json(errBody('请求体超出大小限制', 413), 413),
      }),
    );
  }

  // ─── 请求超时（仅对 /api/* 生效，排除长耗时路由）───────────────────────────
  // config.requestTimeoutMs === 0 时不挂载
  if (config.requestTimeoutMs > 0) {
    const timeoutMs = config.requestTimeoutMs;
    // 天生长耗时的路径前缀：WebSocket、文件上传/下载、数据库备份、客户端制品分发
    const TIMEOUT_EXCLUDE_PREFIXES = ['/api/ws', '/api/files', '/api/db-backups', '/api/db-admin', '/api/log-files', '/api/log-viewer', '/api/monitor/stream', '/api/ai/conversations', '/api/ai/arena', '/api/ai/generations', '/api/public/app-releases', '/api/app-releases'];

    const timeoutMiddleware = timeout(
      timeoutMs,
      () =>
        new HTTPException(408, {
          message: `请求处理超时（${timeoutMs}ms）`,
        }),
    );

    // 使用 hono/combine except() 排除无法设超时的长耗时路由
    app.use(
      '/api/*',
      except(
        (c) => {
          const path = c.req.path;
          return TIMEOUT_EXCLUDE_PREFIXES.some((p) => path.startsWith(p)) || path.endsWith('/export');
        },
        timeoutMiddleware,
      ),
    );
  }

  app.use('/api/*', ipAccessMiddleware);

  // ─── 接口级限流（防暴力破解 / 滥用）────────────────────────────────────────
  app.use('/api/auth/login', authRateLimit);
  app.use('/api/auth/captcha', captchaRateLimit);
  app.use('/api/auth/register', sensitiveRateLimit);
  app.use('/api/auth/forgot-password', sensitiveRateLimit);
  app.use('/api/auth/reset-password', sensitiveRateLimit);

  // 路径绑定限流：匹配自定义规则的 pathPatterns
  app.use('/api/*', pathBoundRateLimit);

  // ─── 维护模式拦截（认证路由、公开维护接口之后注册）────────────────────────
  app.use('/api/*', maintenanceMiddleware);

  // ─── 路由装配（按域，顺序见 src/routes/index.ts）─────────────────────────
  for (const domain of ROUTE_DOMAINS) {
    for (const [path, router, options] of domain.mounts()) {
      // 声明了 feature 的挂载整体套 License 门控（off 模式零开销直通）
      if (options?.feature) app.use(`${path}/*`, licenseFeatureGate(options.feature));
      app.route(path, router);
    }
  }

  // ─── Mastra 标准 API(Studio 后端):系统鉴权 + 权限门控后转发到懒加载子 app ──
  // 开发可经 MASTRA_STUDIO_ALLOW_ANONYMOUS=true 免鉴权(Studio 无需贴 token);生产强制鉴权
  if (config.ai.mastraStudioAllowAnonymous) {
    logger.warn('[mastra] /api/mastra 鉴权已放开(MASTRA_STUDIO_ALLOW_ANONYMOUS=true,仅开发环境生效)');
  } else {
    app.use('/api/mastra/*', authMiddleware, guard({ permission: 'ai:studio:access' }));
  }
  app.all('/api/mastra/*', async (c) => {
    const { mastraApiProxy } = await import('./lib/mastra/server');
    return mastraApiProxy(c.req.raw);
  });

  app.get('/metrics', printMetrics);

  // API 文档（无需认证）
  app.openAPIRegistry.registerComponent('securitySchemes', 'BearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: '登录后获取的 accessToken，格式：`Bearer <token>`',
  });
  for (const [name, scheme] of Object.entries(CONTRACT_SECURITY_SCHEMES)) {
    app.openAPIRegistry.registerComponent('securitySchemes', name, scheme);
  }
  const openApiDocConfig = {
    openapi: '3.1.0',
    info: {
      title: 'Zenith Admin API',
      version: process.env.npm_package_version || '0.7.0',
      description:
        'Zenith Admin 后台管理系统 REST API 文档。\n\n' +
        '认证方式：Bearer Token（在 Authorize 中填入登录返回的 `accessToken`）。\n\n' +
        '所有接口的成功响应格式为 `{ code: 0, message: "success", data: T }`，' +
        '失败时 `code` 为非零值。',
    },
    servers: [{ url: '/', description: '当前服务器' }],
    // 全局默认安全方案，公开接口通过 security: [] 单独覆盖
    security: [{ BearerAuth: [] }],
  };
  // 文档生成是 ~10s 的同步 CPU 工作（产物 ~4.5MB），禁止每请求重建（会卡死事件循环）。
  // 生成一次后进程内缓存（含 gzip 预压缩字节）；预热由 bootstrap/openapi-warmup.ts
  // 在 worker 线程完成，预热完成前的首个请求走懒生成兜底。
  const buildOpenApiDocJson = () => JSON.stringify(app.getOpenAPI31Document(openApiDocConfig));
  app.get('/api/openapi.json', (c) => {
    let doc = getCachedOpenApiDoc();
    if (!doc) {
      setCachedOpenApiDoc(buildOpenApiDocJson());
      doc = getCachedOpenApiDoc() as NonNullable<typeof doc>;
    }
    // 直接吐预压缩字节，跳过压缩中间件对 4.5MB 的每请求 gzip
    if (c.req.header('accept-encoding')?.includes('gzip')) {
      return c.body(doc.gzip.slice().buffer as ArrayBuffer, 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
      });
    }
    return c.body(doc.json, 200, { 'Content-Type': 'application/json; charset=utf-8' });
  });
  app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));

  // ─── 兜底挂载：必须晚于全部 API 路由与文档路由 ───────────────────────────
  // （CMS 前台 SSR 挂在 '/'，按 Host 匹配站点，会吞掉未匹配的一切路径）
  for (const domain of ROUTE_DOMAINS) {
    for (const [path, router] of domain.fallback?.() ?? []) app.route(path, router);
  }

  app.notFound((c) => c.json(errBody('接口不存在', 404), 404));

  // 全局未捕获异常处理—统一返回标准错误格式
  app.onError((err, c) => {
    // OAuth2 协议端点必须返回 RFC 6749 格式，标准客户端库才能正确解析错误语义
    if (err instanceof OAuth2Error) {
      return c.json(oauth2ErrorBody(err), err.status);
    }
    if (err instanceof HTTPException) {
      return c.json(errBody(err.message, err.status), err.status);
    }
    logger.error('[Unhandled Error]', err);
    return c.json(errBody('服务器内部错误', 500), 500);
  });

  return { app, buildOpenApiDocJson };
}
