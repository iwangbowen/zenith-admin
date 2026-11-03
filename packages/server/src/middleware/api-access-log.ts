import { createMiddleware } from 'hono/factory';
import { captureApiAccessRequest, buildApiAccessLogEntry, enqueueApiAccessLog, shouldCaptureApiAccessPath } from '../lib/api-access-log';

/** Response-ready request facts; streaming response bodies are never read or cloned. */
export const apiAccessLogMiddleware = createMiddleware(async (c, next) => {
  if (!shouldCaptureApiAccessPath(c.req.path)) { await next(); return; }
  const startedAt = Date.now();
  const startedTick = performance.now();
  await next();
  // Hono's error handler completes inside next(): c.res has final 4xx/5xx/404 here.
  try {
    const snapshot = await captureApiAccessRequest(c);
    enqueueApiAccessLog(buildApiAccessLogEntry(c, snapshot, startedAt, startedTick));
  } catch { /* Access-log collection must never alter the response. */ }
});
