/**
 * CMS 站内 URL 规则 —— 静态文件名与之一一对应。
 *
 * 单独成文件（而非留在 cms-render.service）是为了让 cms-link.service 复用时
 * 不产生 render ↔ link 的循环依赖。`cms-render.service.ts` 已重新导出这三个函数，
 * 现有 `from './cms-render.service'` 的导入无需改动。
 */
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { CMS_PREVIEW_PREFIX, cmsCustomPagePath, parseCmsLink } from '@zenith/shared/cms';
import type { CmsChannelDetailPathRule, CmsContentStatus } from '@zenith/shared/cms';
import { APP_TIME_ZONE } from '../../lib/datetime';

dayjs.extend(utc);
dayjs.extend(timezone);

/** 搭建页 URL / 静态产物路径：设了 path 用它，否则回落 p/{slug}/ */
export { cmsCustomPagePath as customPagePath } from '@zenith/shared/cms';

/**
 * 搭建页 URL。
 *
 * 刻意接收整个 page 而非裸 slug：自定义路径落地后，URL 生成、静态写文件、sitemap
 * 三处必须算出同一结果，收成对象可让编译器点出所有漏改的调用点。
 */
export function customPageUrl(baseUrl: string, page: { slug: string; path?: string | null }): string {
  return `${baseUrl}/${cmsCustomPagePath(page)}`;
}

export function channelUrl(baseUrl: string, path: string, page: number): string {
  return page <= 1 ? `${baseUrl}/${path}/` : `${baseUrl}/${path}/index_${page}.html`;
}

export function tagUrl(baseUrl: string, slug: string, page: number): string {
  return page <= 1 ? `${baseUrl}/tag/${slug}/` : `${baseUrl}/tag/${slug}/index_${page}.html`;
}

/**
 * 详情页 URL 计算所需的栏目信息。
 *
 * 刻意用对象而非裸 `path` 字符串：归档目录必须在「静态化写文件」与「模板生成链接」
 * 两侧算出完全一致的结果，任何一处漏传规则都会产生指向 404 的链接。收成对象后
 * 由编译器强制所有调用点显式提供规则。
 */
export interface CmsUrlChannel {
  path: string;
  detailPathRule: CmsChannelDetailPathRule;
}

/**
 * 详情页 URL 计算所需的内容信息。
 *
 * `publishedAt` / `createdAt` 刻意设为**必填**（可为 null）：日期类归档规则依赖它们，
 * 若设成可选，查询里漏 select 时会静默算出未归档路径，产出与规范路径不一致的静态产物
 * （表现为整批详情页 404），且编译期无感知。必填可让编译器逐个点出漏传处。
 */
export interface CmsUrlContent {
  id: number;
  slug: string | null;
  staticPath: string | null;
  publishedAt: Date | null;
  createdAt: Date | null;
}

export interface CmsContentUrlContext {
  siteCode?: string | null;
  channelPath?: string | null;
  detailPathRule?: CmsChannelDetailPathRule | null;
}

/**
 * Compute the canonical site URL and the admin preview URL from the same
 * channel/content inputs used by the static renderer.
 *
 * The preview URL is intentionally emitted only for published internal
 * content. Drafts must use the signed preview-link endpoint; exposing a
 * deterministic public-looking draft URL would only lead callers to a 404.
 */
export function buildCmsContentUrls(
  content: Pick<CmsUrlContent, 'id' | 'slug' | 'staticPath' | 'publishedAt' | 'createdAt'>
    & { externalLink: string | null; status: CmsContentStatus },
  context: CmsContentUrlContext,
): { canonicalUrl: string | null; previewUrl: string | null } {
  const external = content.externalLink?.trim();
  if (external) {
    const parsed = parseCmsLink(external);
    const directUrl = parsed?.kind === 'external' ? parsed.url : parsed?.kind === 'internal' ? parsed.path : null;
    const previewUrl = content.status === 'published' && directUrl
      ? (parsed?.kind === 'internal' && context.siteCode
        ? `${CMS_PREVIEW_PREFIX}/${context.siteCode}${parsed.path}`
        : directUrl)
      : null;
    return { canonicalUrl: directUrl, previewUrl };
  }
  if (!context.channelPath || !context.detailPathRule) {
    return { canonicalUrl: null, previewUrl: null };
  }
  const canonicalUrl = contentUrl('', {
    path: context.channelPath,
    detailPathRule: context.detailPathRule,
  }, content);
  const previewUrl = content.status === 'published' && context.siteCode
    ? `${CMS_PREVIEW_PREFIX}/${context.siteCode}${canonicalUrl}`
    : null;
  return { canonicalUrl, previewUrl };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 归档目录片段（含结尾 `/`；不归档返回空串）。
 *
 * 日期取值口径必须与全站展示一致 —— 走 `APP_TIME_ZONE`（与 `formatDateTime()` 同源），
 * 而**不是** OS 本地时区：`APP_TIME_ZONE` 有 `Asia/Shanghai` 兜底，部署机时区不同时
 * 裸 dayjs 会和后台显示的发布时间差一年/一月，产出与运营预期不符的产物路径。
 * 未发布时回退创建时间；两者都缺失则退化为不归档，保证任何数据状态下都能算出稳定路径。
 */
export function contentArchiveDir(rule: CmsChannelDetailPathRule, content: CmsUrlContent): string {
  if (rule === 'none') return '';
  if (rule === 'idHash') return `${Math.abs(content.id) % 10}/`;
  const at = content.publishedAt ?? content.createdAt;
  if (!at) return '';
  const d = dayjs(at).tz(APP_TIME_ZONE);
  if (!d.isValid()) return '';
  const y = d.year();
  const m = d.month() + 1;
  const day = d.date();
  switch (rule) {
    case 'year': return `${y}/`;
    case 'month': return `${y}/${m}/`;
    case 'date': return `${y}/${m}/${day}/`;
    case 'dateStr': return `${y}-${pad2(m)}-${pad2(day)}/`;
    default: return '';
  }
}

export function contentUrl(
  baseUrl: string,
  channel: CmsUrlChannel,
  content: CmsUrlContent,
  bodyPage = 1,
): string {
  // 自定义静态路径优先：整条相对路径由运营指定，正文分页在扩展名前追加 _N
  const custom = content.staticPath?.trim();
  if (custom) {
    if (bodyPage <= 1) return `${baseUrl}/${custom}`;
    const dot = custom.lastIndexOf('.');
    return dot <= 0
      ? `${baseUrl}/${custom}_${bodyPage}`
      : `${baseUrl}/${custom.slice(0, dot)}_${bodyPage}${custom.slice(dot)}`;
  }
  const dir = contentArchiveDir(channel.detailPathRule, content);
  const base = content.slug ?? content.id;
  return bodyPage <= 1
    ? `${baseUrl}/${channel.path}/${dir}${base}.html`
    : `${baseUrl}/${channel.path}/${dir}${base}_${bodyPage}.html`;
}
