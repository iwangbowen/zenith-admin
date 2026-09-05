/**
 * HTTP 指标中间件：在 metricsSampler 中累计请求时延、状态码、QPS。
 */
import type { MiddlewareHandler } from 'hono';
import { metricsSampler } from '../lib/metrics-sampler';

/** 不计入请求指标的前缀：Prometheus 自身抓取、文档、WebSocket 与 SSE 长流 */
const EXCLUDE_PREFIXES = ['/metrics', '/api/openapi.json', '/api/docs', '/api/ws', '/api/log-files'];

export const httpMetricsMiddleware: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;
  if (EXCLUDE_PREFIXES.some((p) => path.startsWith(p))) {
    await next();
    return;
  }
  const start = performance.now();
  try {
    await next();
    metricsSampler.http.record(performance.now() - start, c.res.status || 200);
  } catch (err) {
    metricsSampler.http.record(performance.now() - start, 500);
    throw err;
  }
};
