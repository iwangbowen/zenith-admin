/**
 * HTTP 指标中间件：在 metricsSampler 中累计请求时延、状态码、QPS。
 *
 * 排除路径：
 * - /metrics（Prometheus 抓取自身）
 * - /api/openapi.json、/api/docs（文档）
 * - /api/ws（WebSocket）
 * - /api/log-files（SSE/长流）
 */
import type { MiddlewareHandler } from 'hono';
import { metricsSampler } from '../lib/metrics-sampler';

const EXCLUDE_PREFIXES = ['/metrics', '/api/openapi.json', '/api/docs', '/api/ws', '/api/log-files'];

export const httpMetricsMiddleware: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;
  if (EXCLUDE_PREFIXES.some((p) => path.startsWith(p))) {
    await next();
    return;
  }
  const start = performance.now();
  let status = 0;
  try {
    await next();
    status = c.res.status;
  } catch (err) {
    status = 500;
    throw err;
  } finally {
    const duration = performance.now() - start;
    metricsSampler.http.record(duration, status || c.res.status || 200);
  }
};
