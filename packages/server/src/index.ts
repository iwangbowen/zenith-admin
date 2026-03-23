import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { config } from './config';
import authRoutes from './routes/auth';
import usersRoutes from './routes/users';
import menusRoutes from './routes/menus';
import rolesRoutes from './routes/roles';
import dictsRoutes from './routes/dicts';
import fileStorageConfigsRoutes from './routes/file-storage-configs';
import filesRoutes from './routes/files';
import monitorRoutes from './routes/monitor';

const app = new Hono();

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));

app.route('/api/auth', authRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/menus', menusRoutes);
app.route('/api/roles', rolesRoutes);
app.route('/api/dicts', dictsRoutes);
app.route('/api/file-storage-configs', fileStorageConfigsRoutes);
app.route('/api/files', filesRoutes);
app.route('/api/monitor', monitorRoutes);

app.get('/api/health', (c) => c.json({ code: 0, message: 'ok', data: { timestamp: Date.now() } }));

// 全局未捕获异常处理—统一返回标准错误格式
app.onError((err, c) => {
  console.error('[Unhandled Error]', err);
  return c.json({ code: 500, message: '服务器内部错误', data: null }, 500);
});

console.log(`Server starting on port ${config.port}...`);
serve({ fetch: app.fetch, port: config.port });
console.log(`Server running at http://localhost:${config.port}`);
