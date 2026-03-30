import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { swaggerUI } from '@hono/swagger-ui';
import { config } from './config';
import { openapiSpec } from './openapi';
import logger from './lib/logger';
import { db } from './db/index';
import redis from './lib/redis';
import { sql } from 'drizzle-orm';
import { httpLogger } from './middleware/logger';
import { ipAccessMiddleware } from './middleware/ip-access';
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
import { createWsRoute } from './routes/ws';
import { initCronScheduler } from './lib/cron-scheduler';

const app = new Hono();
const startTime = Date.now();

const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));
app.use('*', httpLogger);
app.use('/api/*', ipAccessMiddleware);

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
app.route('/api/ws', createWsRoute(upgradeWebSocket));

app.get('/api/health', async (c) => {
  const checks: Record<string, 'ok' | 'error'> = {};

  // Check database
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  // Check Redis
  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }

  const allOk = Object.values(checks).every((v) => v === 'ok');
  return c.json({
    status: allOk ? 'ok' : 'degraded',
    version: '0.1.1',
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  });
});

// API 文档（无需认证）
app.get('/api/openapi.json', (c) => c.json(openapiSpec));
app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));

// 全局未捕获异常处理—统一返回标准错误格式
app.onError((err, c) => {
  logger.error('[Unhandled Error]', err);
  return c.json({ code: 500, message: '服务器内部错误', data: null }, 500);
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
