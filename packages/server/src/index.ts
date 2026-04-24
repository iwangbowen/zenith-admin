import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
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
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { swaggerUI } from '@hono/swagger-ui';
import { config } from './config';
import logger from './lib/logger';
import { errBody } from './lib/openapi-schemas';
import { AppError } from './lib/errors';
import { ipAccessMiddleware } from './middleware/ip-access';
import { authRateLimit, captchaRateLimit, sensitiveRateLimit } from './middleware/rate-limit';
import authRoutes from './routes/auth';
import usersRoutes from './routes/users';
import departmentsRoutes from './routes/departments';
import positionsRoutes from './routes/positions';
import menusRoutes from './routes/menus';
import rolesRoutes from './routes/roles';
import dictsRoutes from './routes/dicts';
import fileStorageConfigsRoutes from './routes/file-storage-configs';
import filesRoutes from './routes/files';
import monitorRoutes from './routes/monitor';
import loginLogsRoutes from './routes/login-logs';
import operationLogsRoutes from './routes/operation-logs';
import noticesRoutes from './routes/notices';
import systemConfigsRoutes from './routes/system-configs';
import sessionsRoutes from './routes/sessions';
import cronJobsRoutes from './routes/cron-jobs';
import regionsRoutes from './routes/regions';
import emailConfigRoutes from './routes/email-config';
import dashboardRoutes from './routes/dashboard';
import tenantsRoutes from './routes/tenants';
import oauthRoutes from './routes/oauth';
import oauthConfigRoutes from './routes/oauth-config';
import dbBackupsRoutes from './routes/db-backups';
import apiTokensRoutes from './routes/api-tokens';
import cacheRoutes from './routes/cache';
import messageTemplatesRoutes from './routes/message-templates';
import workflowDefinitionsRoutes from './routes/workflow-definitions';
import workflowInstancesRoutes from './routes/workflow-instances';
import healthRoutes from './routes/health';
import logFilesRoutes from './routes/log-files';
import { createWsRoute } from './routes/ws';
import { initCronScheduler } from './lib/cron-scheduler';
import { initTelemetry } from './lib/telemetry';

await initTelemetry();

const app = new OpenAPIHono();
const { printMetrics, registerMetrics } = prometheus({ collectDefaultMetrics: true });

const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

app.use('*', registerMetrics);
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
app.use('*', secureHeaders({
  crossOriginResourcePolicy: 'cross-origin', // API 允许跨域访问
  crossOriginOpenerPolicy: false,             // 纯 API 服务，不适用
  xFrameOptions: false,                       // API 无 UI，不需要
}));
app.use('*', compress());
app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));
// CSRF 防护：校验 Origin 头，防止跨站请求伪造
// ALLOWED_ORIGINS 为空时（开发模式）不限制；非浏览器请求（无 Origin）直接放行
app.use(
  '*',
  csrf({
    origin: (origin) => {
      if (!origin) return true; // 服务端 / CLI（curl、Postman）直接放行
      if (config.allowedOrigins.length === 0) return true; // 开发模式，不限制
      return config.allowedOrigins.includes(origin);
    },
  }),
);
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (str: string) => str.replaceAll(ANSI_RE, '');
app.use('*', honoLogger((msg) => logger.info(stripAnsi(msg))));
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
  // 天生长耗时的路径前缀：WebSocket、文件上传/下载、数据库备份
  const TIMEOUT_EXCLUDE_PREFIXES = ['/api/ws', '/api/files', '/api/db-backups', '/api/log-files'];

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

app.route('/api/auth', authRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/departments', departmentsRoutes);
app.route('/api/positions', positionsRoutes);
app.route('/api/menus', menusRoutes);
app.route('/api/roles', rolesRoutes);
app.route('/api/dicts', dictsRoutes);
app.route('/api/file-storage-configs', fileStorageConfigsRoutes);
app.route('/api/files', filesRoutes);
app.route('/api/monitor', monitorRoutes);
app.route('/api/login-logs', loginLogsRoutes);
app.route('/api/operation-logs', operationLogsRoutes);
app.route('/api/notices', noticesRoutes);
app.route('/api/system-configs', systemConfigsRoutes);
app.route('/api/sessions', sessionsRoutes);
app.route('/api/cron-jobs', cronJobsRoutes);
app.route('/api/regions', regionsRoutes);
app.route('/api/email-config', emailConfigRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/tenants', tenantsRoutes);
app.route('/api/auth/oauth', oauthRoutes);
app.route('/api/oauth-config', oauthConfigRoutes);
app.route('/api/db-backups', dbBackupsRoutes);
app.route('/api/api-tokens', apiTokensRoutes);
app.route('/api/cache', cacheRoutes);
app.route('/api/message-templates', messageTemplatesRoutes);
app.route('/api/workflows/definitions', workflowDefinitionsRoutes);
app.route('/api/workflows', workflowInstancesRoutes);
app.route('/api/ws', createWsRoute(upgradeWebSocket));
app.route('/api/health', healthRoutes);
app.route('/api/log-files', logFilesRoutes);
app.get('/metrics', printMetrics);

// API 文档（无需认证）
app.openAPIRegistry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: '登录后获取的 accessToken，格式：`Bearer <token>`',
});
app.doc31('/api/openapi.json', (c) => ({
  openapi: '3.1.0',
  info: {
    title: 'Zenith Admin API',
    version: '0.1.1',
    description:
      'Zenith Admin 后台管理系统 REST API 文档。\n\n' +
      '认证方式：Bearer Token（在 Authorize 中填入登录返回的 `accessToken`）。\n\n' +
      '所有接口的成功响应格式为 `{ code: 0, message: "success", data: T }`，' +
      '失败时 `code` 为非零值。',
  },
  servers: [{ url: new URL(c.req.url).origin, description: '当前服务器' }],
  // 全局默认安全方案，公开接口通过 security: [] 单独覆盖
  security: [{ BearerAuth: [] }],
}));
app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));

// 全局未捕获异常处理—统一返回标准错误格式
app.onError((err, c) => {
  if (err instanceof AppError) {
    const status = err.statusCode as 400 | 401 | 403 | 404 | 409 | 413 | 422 | 423 | 429 | 500;
    return c.json(errBody(err.message, status), status);
  }
  if (err instanceof HTTPException) {
    return c.json({ code: err.status, message: err.message, data: null }, err.status);
  }
  logger.error('[Unhandled Error]', err);
  return c.json(errBody('服务器内部错误', 500), 500);
});

logger.info(`Server starting on port ${config.port}...`);
const server = serve({ fetch: app.fetch, port: config.port });
injectWebSocket(server);
logger.info(`Server running at http://localhost:${config.port}`);

// Initialize cron scheduler after server is up
try {
  await initCronScheduler();
} catch (err) {
  logger.error('Failed to initialize cron scheduler', err);
}
