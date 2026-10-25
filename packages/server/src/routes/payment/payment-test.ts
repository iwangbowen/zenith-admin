import { Hono } from 'hono';

/**
 * 本地沙箱 Webhook 接收器。
 *
 * 仅由 payment route domain 在 NODE_ENV=development 时挂载，供本地 E2E
 * 订阅验证投递链路；生产环境不会暴露该端点。
 */
const router = new Hono();

router.post('/', (c) => c.json({ ok: true }, 200));

export default router;
