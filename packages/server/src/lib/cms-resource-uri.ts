/**
 * 素材句柄（`cms-res://{id}`）的纯函数工具集：提取、归一化与解析。
 *
 * 设计背景：素材原先以裸 URL 散落在正文 HTML、JSONB 与标量列中，导致
 *   1. 引用扫描只能对每张表做 `LIKE '%url%'` 全表扫描（O(N×M)）；
 *   2. 子串匹配产生误判（`a.jpg` 命中 `a.jpg.bak`）；
 *   3. URL 是唯一句柄，改名/换存储/换 CDN 即全站死图。
 *
 * 改为句柄后：写入时把已登记的素材 URL 归一为 `cms-res://{id}`，读取/渲染时解析回真实 URL。
 * 句柄稳定不变，因此替换素材、迁移存储都不会产生死链；引用关系也能精确落到反向索引表。
 *
 * 本文件不依赖数据库，便于单测；DB 相关编排见 services/cms/cms-resource-refs.service.ts。
 */
import { CMS_RESOURCE_URI_PREFIX } from '@zenith/shared/cms';

/** 匹配内嵌句柄（正文 HTML / JSON 字符串内均适用） */
const RESOURCE_URI_RE = /cms-res:\/\/(\d+)/g;

/**
 * 候选 URL 词法：绝对 URL 与带扩展名的站内路径。
 * 归一化只对「确实登记在素材库中的 URL」生效，因此这里宁可多召回、由 DB 精确匹配收敛。
 */
const URL_TOKEN_RE = /https?:\/\/[^\s"'<>()\\]+|\/[A-Za-z0-9_\-./%@]+\.[A-Za-z0-9]{1,8}/g;

export function cmsResourceUri(id: number): string {
  return `${CMS_RESOURCE_URI_PREFIX}${id}`;
}

/** 整串恰好是一个句柄时返回素材 id（标量列场景），否则 null */
export function parseCmsResourceUri(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith(CMS_RESOURCE_URI_PREFIX)) return null;
  const rest = value.slice(CMS_RESOURCE_URI_PREFIX.length);
  if (!/^\d+$/.test(rest)) return null;
  const id = Number(rest);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** 深度遍历任意值，收集其中出现的全部素材 id（去重，保持首次出现顺序） */
export function extractCmsResourceIds(value: unknown): number[] {
  const ids = new Set<number>();
  const pinned = (item: unknown): void => {
    if (Array.isArray(item)) { item.forEach(pinned); return; }
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (key === 'assetVersions' && child && typeof child === 'object' && !Array.isArray(child)) {
        for (const id of Object.keys(child)) if (/^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))) ids.add(Number(id));
      } else pinned(child);
    }
  };
  pinned(value);
  walkStrings(value, (text) => {
    for (const match of text.matchAll(RESOURCE_URI_RE)) {
      const id = Number(match[1]);
      if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    }
  });
  return [...ids];
}

/**
 * 字段级引用提取：返回 `{ field, resourceId }` 列表。
 * field 取顶层字段名（如 coverImage / body / extend），与反向索引的唯一键粒度一致。
 */
export function extractCmsResourceRefFields(
  fields: Record<string, unknown>,
): { field: string; resourceId: number }[] {
  const out: { field: string; resourceId: number }[] = [];
  for (const [field, value] of Object.entries(fields)) {
    for (const resourceId of extractCmsResourceIds(value)) out.push({ field, resourceId });
  }
  return out;
}

/** 深度遍历任意值，收集其中出现的全部候选 URL（去重） */
export function extractCandidateUrls(value: unknown): string[] {
  const urls = new Set<string>();
  walkStrings(value, (text) => {
    for (const match of text.matchAll(URL_TOKEN_RE)) urls.add(match[0]);
    // 整串本身就是 URL（标量列如 coverImage）时，词法可能因结尾字符被裁剪，这里补一次全串
    const trimmed = text.trim();
    if (trimmed && trimmed.length <= 500 && !/\s/.test(trimmed)) urls.add(trimmed);
  });
  return [...urls];
}

/**
 * URL → 句柄归一化（深度遍历，返回新值，不修改入参）。
 *
 * 按 URL 长度倒序替换，避免 `/a.jpg` 抢先命中 `/a.jpg.bak` 的前缀；
 * 未登记在素材库中的 URL（外链图、第三方地址）原样保留。
 */
export function canonicalizeCmsResourceUris<T>(value: T, urlToId: ReadonlyMap<string, number>): T {
  if (urlToId.size === 0) return value;
  const ordered = [...urlToId.entries()].sort((a, b) => b[0].length - a[0].length);
  return mapStrings(value, (text) => {
    let out = text;
    for (const [url, id] of ordered) {
      if (!out.includes(url)) continue;
      out = out.split(url).join(cmsResourceUri(id));
    }
    return out;
  });
}

/**
 * 句柄 → URL 解析（深度遍历，返回新值，不修改入参）。
 * resolver 返回 null 表示素材已不存在，替换为空串（等价于旧实现里的死链，但不会把内部句柄泄露到页面）。
 */
export function resolveCmsResourceUris<T>(value: T, resolver: (id: number) => string | null): T {
  return mapStrings(value, (text) => {
    if (!text.includes(CMS_RESOURCE_URI_PREFIX)) return text;
    return text.replace(RESOURCE_URI_RE, (_full, raw: string) => resolver(Number(raw)) ?? '');
  });
}

/**
 * 句柄 → 句柄重映射（站点导入时把来源站素材 id 改写为新站素材 id）。
 * 映射缺失的 id 保持原样，由调用方决定是否清理。
 */
export function remapCmsResourceUris<T>(value: T, idMap: ReadonlyMap<number, number>): T {
  if (idMap.size === 0) return value;
  return mapStrings(value, (text) => {
    if (!text.includes(CMS_RESOURCE_URI_PREFIX)) return text;
    return text.replace(RESOURCE_URI_RE, (full, raw: string) => {
      const next = idMap.get(Number(raw));
      return next == null ? full : cmsResourceUri(next);
    });
  });
}

// ─── 深度遍历工具 ─────────────────────────────────────────────────────────────

function walkStrings(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visit);
    return;
  }
  if (value != null && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) walkStrings(item, visit);
  }
}

/** 深拷贝并按 transform 重写全部字符串叶子；非字符串叶子原样保留 */
function mapStrings<T>(value: T, transform: (text: string) => string): T {
  if (typeof value === 'string') return transform(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, transform)) as unknown as T;
  if (value != null && typeof value === 'object' && (value as object).constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = mapStrings(item, transform);
    }
    return out as unknown as T;
  }
  return value;
}
