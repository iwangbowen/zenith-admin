import type { GlobalSearchResult } from '@zenith/shared/platform';

export function result(input: GlobalSearchResult): GlobalSearchResult {
  return {
    ...input,
    route: safeRoute(input.route),
    title: input.title.slice(0, 160),
    subtitle: input.subtitle?.slice(0, 240),
    description: input.description?.slice(0, 500),
    highlights: input.highlights.slice(0, 3).map((item) => ({ ...item, text: item.text.slice(0, 240) })),
  };

}

const INTERNAL_ROUTE_PREFIXES = ['/system/', '/member/', '/payment/', '/workflow/', '/drive/', '/iot/', '/alerts/'] as const;

/** 适配器只能返回后台内部路由，禁止把外部 URL 或协议注入搜索结果。 */
export function safeRoute(route: string): string {
  if (!route.startsWith('/') || route.startsWith('//') || !INTERNAL_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix))) {
    throw new Error(`invalid global search route: ${route}`);
  }
  return route;
}

export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
