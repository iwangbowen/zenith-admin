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
import { closeDb } from './db';
import { closeRedis } from './lib/redis';
import logger from './lib/logger';
import { errBody } from './lib/openapi-schemas';
import { ipAccessMiddleware } from './middleware/ip-access';
import { httpLoggerMiddleware } from './middleware/http-logger';
import { authRateLimit, captchaRateLimit, sensitiveRateLimit, bootstrapRateLimitRules, pathBoundRateLimit } from './middleware/rate-limit';
import rateLimitRoutes from './routes/rate-limit';
import authRoutes from './routes/auth';
import memberAuthRoutes from './routes/member-auth';
import memberSelfRoutes from './routes/member-self';
import membersRoutes from './routes/members';
import memberLevelsRoutes from './routes/member-levels';
import memberPointsRoutes from './routes/member-points';
import memberWalletsRoutes from './routes/member-wallets';
import couponsRoutes from './routes/coupons';
import checkinRulesRoutes from './routes/checkin-rules';
import checkinMilestonesRoutes from './routes/checkin-milestones';
import checkinSettingsRoutes from './routes/checkin-settings';
import memberCheckinsRoutes from './routes/member-checkins';
import memberRechargesRoutes from './routes/member-recharges';
import memberStatsRoutes from './routes/member-stats';
import usersRoutes from './routes/users';
import departmentsRoutes from './routes/departments';
import positionsRoutes from './routes/positions';
import userGroupsRoutes from './routes/user-groups';
import menusRoutes from './routes/menus';
import rolesRoutes from './routes/roles';
import dictsRoutes from './routes/dicts';
import fileStorageConfigsRoutes from './routes/file-storage-configs';
import filesRoutes from './routes/files';
import businessFilesRoutes from './routes/business-files';
import monitorRoutes from './routes/monitor';
import monitorAlertsRoutes from './routes/monitor-alerts';
import sslCertificatesRoutes from './routes/ssl-certificates';
import processesRoutes from './routes/processes';
import loginLogsRoutes from './routes/login-logs';
import operationLogsRoutes from './routes/operation-logs';
import ipAccessLogsRoutes from './routes/ip-access-logs';
import announcementsRoutes from './routes/announcements';
import paymentRoutes from './routes/payment';
import paymentReconRoutes from './routes/payment-recon';
import paymentWebhookRoutes from './routes/payment-webhooks';
import paymentLedgerRoutes from './routes/payment-ledger';
import paymentOpsRoutes from './routes/payment-ops';
import paymentPublicRoutes from './routes/payment-public';
import paymentFeeRoutes from './routes/payment-fee';
import paymentSettlementRoutes from './routes/payment-settlements';
import paymentSharingRoutes from './routes/payment-sharing';
import paymentLinkRoutes from './routes/payment-links';
import paymentLinkPublicRoutes from './routes/payment-link-public';
import paymentRiskRoutes from './routes/payment-risk';
import paymentMethodRoutes from './routes/payment-methods';
import paymentReportRoutes from './routes/payment-reports';
import systemConfigsRoutes from './routes/system-configs';
import sessionsRoutes from './routes/sessions';
import cronJobsRoutes from './routes/cron-jobs';
import regionsRoutes from './routes/regions';
import emailConfigRoutes from './routes/email-config';
import dashboardRoutes from './routes/dashboard';
import tenantsRoutes from './routes/tenants';
import tenantPackagesRoutes from './routes/tenant-packages';
import oauthRoutes from './routes/oauth';
import oauthConfigRoutes from './routes/oauth-config';
import dbBackupsRoutes from './routes/db-backups';
import dbAdminRoutes from './routes/db-admin';
import apiTokensRoutes from './routes/api-tokens';
import cacheRoutes from './routes/cache';
import workflowDefinitionsRoutes from './routes/workflow-definitions';
import workflowCategoriesRoutes from './routes/workflow-categories';
import workflowFormsRoutes from './routes/workflow-forms';
import workflowInstancesRoutes from './routes/workflow-instances';
import bizLeaveRoutes from './routes/biz-leave';
import workflowAutomationsRoutes from './routes/workflow-automations';
import workflowSchedulesRoutes from './routes/workflow-schedules';
import workflowDataSourcesRoutes from './routes/workflow-data-sources';
import workflowSavedViewsRoutes from './routes/workflow-saved-views';
import workflowDelegationsRoutes from './routes/workflow-delegations';
import workflowQuickPhrasesRoutes from './routes/workflow-quick-phrases';
import workflowTemplatesRoutes from './routes/workflow-templates';
import healthRoutes from './routes/health';
import maintenanceRoutes from './routes/maintenance';
import logFilesRoutes from './routes/log-files';
import chatRoutes from './routes/chat';
import chatBotsRoutes from './routes/chat-bots';
import chatPublicRoutes from './routes/chat-public';
import tagsRoutes from './routes/tags';
import dataMaskConfigsRoutes from './routes/data-mask-configs';
import oauth2ClientsRoutes from './routes/oauth2-clients';
import oauth2AuthRoutes from './routes/oauth2-auth';
import emailTemplatesRoutes from './routes/email-templates';
import emailSendLogsRoutes from './routes/email-send-logs';
import smsConfigsRoutes from './routes/sms-configs';
import smsTemplatesRoutes from './routes/sms-templates';
import smsSendLogsRoutes from './routes/sms-send-logs';
import mpAccountsRoutes from './routes/mp-accounts';
import mpTagsRoutes from './routes/mp-tags';
import mpFansRoutes from './routes/mp-fans';
import mpMessagesRoutes from './routes/mp-messages';
import mpCallbackRoutes from './routes/mp-callback';
import inAppTemplatesRoutes from './routes/in-app-templates';
import inAppMessagesRoutes from './routes/in-app-messages';
import aiProvidersRoutes from './routes/ai-providers';
import aiConversationsRoutes from './routes/ai-conversations';
import aiChatRoutes from './routes/ai-chat';
import userAiConfigRoutes from './routes/user-ai-config';
import aiPromptTemplatesRoutes from './routes/ai-prompt-templates';
import aiUsageRoutes from './routes/ai-usage';
import analyticsRoutes from './routes/analytics';
import frontendErrorsRoutes from './routes/frontend-errors';
import { createWsRoute } from './routes/ws';
import { createWsTerminalRoute, createWsTerminalMonitorRoute } from './routes/ws-terminal';
import terminalFilesRoutes from './routes/terminal-files';
import terminalRecordingsRoutes from './routes/terminal-recordings';
import sshProfilesRoutes from './routes/ssh-profiles';
import sshSftpRoutes from './routes/ssh-sftp';
import terminalSessionsRoutes from './routes/terminal-sessions';
import portsRoutes from './routes/ports';
import firewallRoutes from './routes/firewall';
import dockerRoutes from './routes/docker';
import networkDiagRoutes from './routes/network-diag';
import systemdRoutes from './routes/systemd';
import logViewerRoutes from './routes/log-viewer';
import nginxSitesRoutes from './routes/nginx-sites';
import stripAnsi from 'strip-ansi';
import { initCronScheduler, stopAllJobs } from './lib/pg-boss-scheduler';
import { registerWsWorkflowSubscriber } from './lib/workflow-subscribers/ws';
import { registerWebhookWorkflowSubscriber, retryWorkflowEventDeliveries } from './lib/workflow-subscribers/webhook';
import { registerTriggerWorkflowSubscriber } from './lib/workflow-subscribers/trigger';
import { registerExternalApproverSubscriber } from './lib/workflow-subscribers/external-approver';
import { registerNodeListenersSubscriber } from './lib/workflow-subscribers/node-listeners';
import { registerNotificationWorkflowSubscriber } from './lib/workflow-subscribers/notification';
import { registerChatWorkflowSubscriber } from './lib/workflow-subscribers/chat';
import { registerWorkflowAutomationSubscribers } from './services/workflow-automations.service';
import { initPaymentAdapters } from './lib/payment';
import { registerPaymentSubscribers } from './services/payment-subscribers';
import { registerWebhookSubscribers } from './services/payment-webhook.service';
import { registerBizLeaveSubscribers } from './services/biz-leave-subscribers';
import { registerLedgerSubscribers } from './services/payment-ledger.service';
import { registerFeeSubscribers } from './services/payment-fee.service';
import workflowEventSubscriptionsRoutes from './routes/workflow-event-subscriptions';
import workflowTriggerExecutionsRoutes from './routes/workflow-trigger-executions';
import workflowExternalCallbackRoutes from './routes/workflow-external-callback';
import workflowTriggerCallbackRoutes from './routes/workflow-trigger-callback';
import { initTelemetry } from './lib/telemetry';
import { metricsSampler } from './lib/metrics-sampler';
import { httpMetricsMiddleware } from './middleware/http-metrics';
import { maintenanceMiddleware } from './middleware/maintenance';

await initTelemetry();

const app = new OpenAPIHono();
const { printMetrics, registerMetrics } = prometheus({ collectDefaultMetrics: true });

const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

app.use('*', registerMetrics);
// 监控页指标采集（自带的轻量收集器，独立于 Prometheus）
app.use('*', httpMetricsMiddleware);
metricsSampler.start();
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
// 流式/二进制路由排除压缩：SSE 实时推送 + 文件下载不能被缓冲压缩
const COMPRESS_EXCLUDE_PREFIXES = ['/api/ws', '/api/files', '/api/db-backups', '/api/db-admin', '/api/log-files', '/api/monitor/stream', '/api/ai/conversations'];
app.use('*', except(
  (c) => COMPRESS_EXCLUDE_PREFIXES.some((p) => c.req.path.startsWith(p)),
  compress(),
));
app.use('*', cors({ origin: config.corsOrigin, allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));
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
app.use('*', honoLogger((msg) => logger.info(stripAnsi(msg))));
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
  // 天生长耗时的路径前缀：WebSocket、文件上传/下载、数据库备份
  const TIMEOUT_EXCLUDE_PREFIXES = ['/api/ws', '/api/files', '/api/db-backups', '/api/db-admin', '/api/log-files', '/api/monitor/stream', '/api/ai/conversations'];

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

app.route('/api/maintenance', maintenanceRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/member/auth', memberAuthRoutes);
app.route('/api/member', memberSelfRoutes);
app.route('/api/members', membersRoutes);
app.route('/api/member-levels', memberLevelsRoutes);
app.route('/api/member-points', memberPointsRoutes);
app.route('/api/member-wallets', memberWalletsRoutes);
app.route('/api/coupons', couponsRoutes);
app.route('/api/checkin-rules', checkinRulesRoutes);
app.route('/api/checkin-milestones', checkinMilestonesRoutes);
app.route('/api/checkin-settings', checkinSettingsRoutes);
app.route('/api/member-checkins', memberCheckinsRoutes);
app.route('/api/member-recharges', memberRechargesRoutes);
app.route('/api/member-stats', memberStatsRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/departments', departmentsRoutes);
app.route('/api/positions', positionsRoutes);
app.route('/api/user-groups', userGroupsRoutes);
app.route('/api/menus', menusRoutes);
app.route('/api/roles', rolesRoutes);
app.route('/api/dicts', dictsRoutes);
app.route('/api/file-storage-configs', fileStorageConfigsRoutes);
app.route('/api/files', filesRoutes);
app.route('/api/business-files', businessFilesRoutes);
app.route('/api/monitor', monitorRoutes);
app.route('/api/monitor-alerts', monitorAlertsRoutes);
app.route('/api/ssl-certificates', sslCertificatesRoutes);
app.route('/api/login-logs', loginLogsRoutes);
app.route('/api/operation-logs', operationLogsRoutes);
app.route('/api/ip-access-logs', ipAccessLogsRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/frontend-errors', frontendErrorsRoutes);
app.route('/api/announcements', announcementsRoutes);
app.route('/api/payment', paymentRoutes);
app.route('/api/payment/recon', paymentReconRoutes);
app.route('/api/payment/webhooks', paymentWebhookRoutes);
app.route('/api/payment/ledger', paymentLedgerRoutes);
app.route('/api/payment/ops', paymentOpsRoutes);
app.route('/api/payment/fee-rules', paymentFeeRoutes);
app.route('/api/payment/settlements', paymentSettlementRoutes);
app.route('/api/payment/sharing', paymentSharingRoutes);
app.route('/api/payment/links', paymentLinkRoutes);
app.route('/api/payment/risk-rules', paymentRiskRoutes);
app.route('/api/payment/methods', paymentMethodRoutes);
app.route('/api/payment/reports', paymentReportRoutes);
app.route('/api/system-configs', systemConfigsRoutes);
app.route('/api/data-mask-configs', dataMaskConfigsRoutes);
app.route('/api/sessions', sessionsRoutes);
app.route('/api/cron-jobs', cronJobsRoutes);
app.route('/api/regions', regionsRoutes);
app.route('/api/email-config', emailConfigRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/tenants', tenantsRoutes);
app.route('/api/tenant-packages', tenantPackagesRoutes);
app.route('/api/auth/oauth', oauthRoutes);
app.route('/api/oauth-config', oauthConfigRoutes);
app.route('/api/db-backups', dbBackupsRoutes);
app.route('/api/db-admin', dbAdminRoutes);
app.route('/api/api-tokens', apiTokensRoutes);
app.route('/api/cache', cacheRoutes);
app.route('/api/workflows/definitions', workflowDefinitionsRoutes);
app.route('/api/workflows/categories', workflowCategoriesRoutes);
app.route('/api/workflows/forms', workflowFormsRoutes);
app.route('/api/workflows/event-subscriptions', workflowEventSubscriptionsRoutes);
app.route('/api/workflows/trigger-executions', workflowTriggerExecutionsRoutes);
app.route('/api/workflows/automations', workflowAutomationsRoutes);
app.route('/api/workflows/schedules', workflowSchedulesRoutes);
app.route('/api/workflows/data-sources', workflowDataSourcesRoutes);
app.route('/api/workflows/saved-views', workflowSavedViewsRoutes);
app.route('/api/workflows/delegations', workflowDelegationsRoutes);
app.route('/api/workflows/quick-phrases', workflowQuickPhrasesRoutes);
app.route('/api/workflows/templates', workflowTemplatesRoutes);
app.route('/api/public/workflow/external-callback', workflowExternalCallbackRoutes);
app.route('/api/public/workflow/trigger-callback', workflowTriggerCallbackRoutes);
app.route('/api/public/payment/notify', paymentPublicRoutes);
app.route('/api/public/payment/link', paymentLinkPublicRoutes);
app.route('/api/public/chat/webhook', chatPublicRoutes);
app.route('/api/public/mp/callback', mpCallbackRoutes);
app.route('/api/workflows', workflowInstancesRoutes);
app.route('/api/biz/leaves', bizLeaveRoutes);
app.route('/api/chat', chatRoutes);
app.route('/api/chat-bots', chatBotsRoutes);
app.route('/api/tags', tagsRoutes);
app.route('/api/email-templates', emailTemplatesRoutes);
app.route('/api/email-send-logs', emailSendLogsRoutes);
app.route('/api/sms-configs', smsConfigsRoutes);
app.route('/api/sms-templates', smsTemplatesRoutes);
app.route('/api/sms-send-logs', smsSendLogsRoutes);
app.route('/api/mp/accounts', mpAccountsRoutes);
app.route('/api/mp/tags', mpTagsRoutes);
app.route('/api/mp/fans', mpFansRoutes);
app.route('/api/mp/messages', mpMessagesRoutes);
app.route('/api/in-app-templates', inAppTemplatesRoutes);
app.route('/api/in-app-messages', inAppMessagesRoutes);
app.route('/api/ai/providers', aiProvidersRoutes);
app.route('/api/ai/conversations', aiConversationsRoutes);
app.route('/api/ai/conversations', aiChatRoutes);
app.route('/api/ai/user-configs', userAiConfigRoutes);
app.route('/api/ai/prompt-templates', aiPromptTemplatesRoutes);
app.route('/api/ai/usage', aiUsageRoutes);
app.route('/api/oauth2/clients', oauth2ClientsRoutes);
app.route('/api/oauth2', oauth2AuthRoutes);
app.route('/api/rate-limit', rateLimitRoutes);
app.route('/api/ws', createWsRoute(upgradeWebSocket));
app.route('/api/ws/terminal', createWsTerminalRoute(upgradeWebSocket));
app.route('/api/ws/terminal-monitor', createWsTerminalMonitorRoute(upgradeWebSocket));
app.route('/api/processes', processesRoutes);
app.route('/api/terminal-files', terminalFilesRoutes);
app.route('/api/terminal-recordings', terminalRecordingsRoutes);
app.route('/api/ssh-profiles', sshProfilesRoutes);
app.route('/api/ssh-sftp', sshSftpRoutes);
app.route('/api/terminal-sessions', terminalSessionsRoutes);
app.route('/api/ports', portsRoutes);
app.route('/api/firewall', firewallRoutes);
app.route('/api/docker', dockerRoutes);
app.route('/api/network-diag', networkDiagRoutes);
app.route('/api/systemd', systemdRoutes);
app.route('/api/log-viewer', logViewerRoutes);
app.route('/api/nginx-sites', nginxSitesRoutes);
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
    version: process.env.npm_package_version || '0.7.0',
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

app.notFound((c) => c.json(errBody('接口不存在', 404), 404));

// 全局未捕获异常处理—统一返回标准错误格式
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json(errBody(err.message, err.status), err.status);
  }
  logger.error('[Unhandled Error]', err);
  return c.json(errBody('服务器内部错误', 500), 500);
});

logger.info(`Server starting on port ${config.port}...`);
const server = serve({ fetch: app.fetch, port: config.port });
injectWebSocket(server);
logger.info(`Server running at http://localhost:${config.port}`);

// 启动后异步加载限流规则到内存（失败时使用代码内默认规则）
void bootstrapRateLimitRules();

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);
  // 30s 超时保护：防止 keep-alive 连接导致 server.close() 永久阻塞
  const closeServer = new Promise<void>((resolve) => server.close(() => resolve()));
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 30_000));
  await Promise.race([closeServer, timeout]);
  try {
    metricsSampler.stop();
    stopAllJobs();
    await closeDb();
    await closeRedis();
    logger.info('Server shutdown complete');
  } catch (err) {
    logger.error('Error during shutdown', err);
  } finally {
    process.exit(0);
  }
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

try {
  await initCronScheduler();
  const { registerSystemRecurringJob } = await import('./lib/pg-boss-scheduler');
  const { runDueWorkflowSchedules } = await import('./services/workflow-schedules.service');
  await registerSystemRecurringJob('workflow-schedule-tick', '* * * * *', runDueWorkflowSchedules);
  await registerSystemRecurringJob('workflow-event-delivery-retry', '*/5 * * * *', async () => {
    await retryWorkflowEventDeliveries();
  });
} catch (err) {
  logger.error('Failed to initialize cron scheduler', err);
}

const isMainInstance = process.env.NODE_APP_INSTANCE === undefined || process.env.NODE_APP_INSTANCE === '0';
if (isMainInstance) {
  try {
    const { delayScheduler } = await import('./lib/delay-scheduler');
    await delayScheduler.initialize();
  } catch (err) {
    logger.error('Failed to initialize delay scheduler', err);
  }
} else {
  logger.info(`Skipping delay scheduler on PM2 instance ${process.env.NODE_APP_INSTANCE}`);
}

// 注册工作流事件总线的内置订阅者
registerWsWorkflowSubscriber();
registerWebhookWorkflowSubscriber();
registerTriggerWorkflowSubscriber();
registerExternalApproverSubscriber();
registerNodeListenersSubscriber();
registerNotificationWorkflowSubscriber();
registerChatWorkflowSubscriber();
registerWorkflowAutomationSubscribers();
initPaymentAdapters();
registerPaymentSubscribers();
registerWebhookSubscribers();
registerBizLeaveSubscribers();
registerLedgerSubscribers();
registerFeeSubscribers();
logger.info('Workflow event subscribers registered');
