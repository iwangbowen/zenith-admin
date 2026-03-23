import type { MiddlewareHandler } from 'hono';
import logger from '../lib/logger';

export const httpLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  logger.info(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
};
