import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { config } from './config';
import logger from './lib/logger';
import { httpLogger } from './middleware/logger';
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
import { createWsRoute } from './routes/ws';
import { initCronScheduler } from './lib/cron-scheduler';

const app = new Hono();

const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));
app.use('*', httpLogger);

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
app.route('/api/ws', createWsRoute(upgradeWebSocket));

app.get('/api/health', (c) => c.json({ code: 0, message: 'ok', data: { timestamp: Date.now() } }));

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
