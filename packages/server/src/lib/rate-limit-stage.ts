import type { Context } from 'hono';
type IdentityLimiter = (c: Context, next: () => Promise<void>) => Promise<Response | void>;
let limiter: IdentityLimiter = (_c, next) => next();
export function installIdentityRateLimiter(value: IdentityLimiter): void { limiter = value; }
export function runIdentityRateLimits(c: Context, next: () => Promise<void>): Promise<Response | void> { return limiter(c, next); }
