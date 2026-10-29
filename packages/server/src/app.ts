/**
 * 生产应用装配入口。
 *
 * `createAppWithDomains()` 承载公共中间件、OpenAPI、错误处理与路由挂载；
 * 生产环境始终装配全部路由域。领域契约测试通过 `app-core.ts` 传入子集，
 * 避免为了验证单个领域而执行完整路由图。
 */
import { ROUTE_DOMAINS } from './routes';
import { createAppWithDomains } from './app-core';
import { productionOpenApiDocCache } from './lib/openapi-doc-cache';

export function createApp() {
  return createAppWithDomains(ROUTE_DOMAINS, productionOpenApiDocCache);
}
