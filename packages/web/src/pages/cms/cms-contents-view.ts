/** 内容管理深链：view JSON 同时承载站点、Tab 与筛选（内容页 ?view= 解析） */
export function cmsContentsViewUrl(siteId: number, extra: Record<string, unknown>): string {
  return `/cms/contents?view=${encodeURIComponent(JSON.stringify({ siteId, ...extra }))}`;
}
