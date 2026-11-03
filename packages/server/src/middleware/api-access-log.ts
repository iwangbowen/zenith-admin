import { createMiddleware } from 'hono/factory';
import { captureApiAccessRequest, buildApiAccessLogEntry, enqueueApiAccessLog } from '../lib/api-access-log';

/** 全站 API 请求访问事实采集；数据库写入走有界异步队列，不阻塞业务响应。 */
export const apiAccessLogMiddleware = createMiddleware(async (c, next) => {
  const startedAt = Date.now();
  let snapshot: Awaited<ReturnType<typeof captureApiAccessRequest>>;
  try {
    snapshot = await captureApiAccessRequest(c);
  } catch {
    snapshot = { method: c.req.method, url: c.req.url, route: c.req.routePath, status: null, ip: null, headers: {}, query: null, params: null };
  }
  try {
    await next();
  } catch (error) {
    c.set('apiAccessError', { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    try {
      enqueueApiAccessLog(buildApiAccessLogEntry(c, snapshot, startedAt));
    } catch {
      // Access logging must never change the request outcome.
    }
  }
});

