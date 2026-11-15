import type { Context } from 'hono';
/** Installed by the API assembly; never decodes or validates credentials itself. */
type IdentityLimiter = (c: Context, next: () => Promise<void>) => Promise<Response | void>;
let limiter: IdentityLimiter = (_c, next) => next();
export function installIdentityRateLimiter(value: IdentityLimiter): void { limiter = value; }
export function runIdentityRateLimits(c: Context, next: () => Promise<void>): Promise<Response | void> {
  if (c.get('rateLimitIdentityApplied')) return next();
  c.set('rateLimitIdentityApplied', true);
  return limiter(c, next);
}
declare module 'hono' { interface ContextVariableMap { rateLimitIdentityApplied?: boolean } }
