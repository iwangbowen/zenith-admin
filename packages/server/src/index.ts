import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { config } from './config';
import authRoutes from './routes/auth';
import usersRoutes from './routes/users';

const app = new Hono();

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));

app.route('/api/auth', authRoutes);
app.route('/api/users', usersRoutes);

app.get('/api/health', (c) => c.json({ code: 0, message: 'ok', data: { timestamp: Date.now() } }));

console.log(`Server starting on port ${config.port}...`);
serve({ fetch: app.fetch, port: config.port });
console.log(`Server running at http://localhost:${config.port}`);
