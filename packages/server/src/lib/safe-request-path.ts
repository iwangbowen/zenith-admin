import type { Context } from 'hono';
import { matchedRoutes } from 'hono/route';

/** Safe before authentication or handler execution; never retains raw path credentials. */
export function safeRequestPath(c: Context): string {
  const routes = matchedRoutes(c).filter((route) => route.method !== 'ALL' && !route.path.endsWith('*'));
  return (routes.at(-1)?.path ?? '/api/[unmatched]').replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
}
