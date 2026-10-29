import type { RouteDomain } from '../routes/_kit';
import { loadRouteDomain, type ServerDomainName } from '../routes/domain-loaders';
import { collectRouteAccessFacts, type RouteAccessFacts } from './route-facts';
import { listOperations, type AppLike, type OpenAPIDoc, type RouteOperation } from './contract';

export interface DomainContractApp {
  readonly app: AppLike;
  readonly domain: RouteDomain;
  readonly doc: OpenAPIDoc;
  readonly operations: RouteOperation[];
  readonly routes: Array<{ method: string; path: string }>;
  readonly accessFacts: Map<string, RouteAccessFacts>;
}

/**
 * 装配一个领域的契约测试 App。
 *
 * 调用方必须先执行 `mockServerInfra()`，确保 app-core 的动态 import 发生在基础设施替身注册之后。
 */
export async function buildDomainContractApp(name: ServerDomainName): Promise<DomainContractApp> {
  const domain = await loadRouteDomain(name);
  const { createAppWithDomains } = await import('../app-core');
  const { app } = createAppWithDomains([domain]);
  const response = await app.request('/api/openapi.json');
  if (response.status !== 200) {
    throw new Error(`无法取得 ${name} 领域 OpenAPI 文档，状态码 ${response.status}`);
  }
  const doc = (await response.json()) as OpenAPIDoc;
  return {
    app: app as AppLike,
    domain,
    doc,
    operations: listOperations(doc),
    routes: app.routes.map((route) => ({ method: route.method, path: route.path })),
    accessFacts: collectRouteAccessFacts(app.routes),
  };
}
