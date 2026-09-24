import * as z from 'zod';
import { cmsSlugRegex } from './validation';
import type { CmsHomeSection, CmsModelDisplay } from './site-composition';

export const CMS_SITE_BLUEPRINTS = [
  { code: 'culture-portal', name: '综合资讯与文化门户', description: '资讯、文化、活动、人物、影像与资料，包含三种模型展示和专题页面。' },
  { code: 'organization', name: '机构官网', description: '机构介绍、新闻、团队、服务、活动与联系入口。' },
  { code: 'resource-center', name: '资料中心', description: '资料下载、使用指南、更新公告、培训活动与问题反馈。' },
] as const;
export const cmsSiteBlueprintInputSchema = z.object({
  blueprint: z.enum(['culture-portal', 'organization', 'resource-center']),
  name: z.string().trim().min(1).max(100), code: z.string().trim().min(1).max(44).regex(cmsSlugRegex),
});
export type CmsSiteBlueprintInput = z.infer<typeof cmsSiteBlueprintInputSchema>;

/** Configuration only: business content is authored and reviewed in the new site. */
export function buildCmsSiteBlueprint(input: CmsSiteBlueprintInput) {
  const definitions = {
    'culture-portal': [['资讯', 'news', null], ['文化', 'culture', null], ['活动', 'events', 1], ['人物', 'people', 2], ['影像', 'gallery', null], ['视听', 'media', null], ['资料', 'downloads', 3]],
    organization: [['机构动态', 'news', null], ['服务指南', 'services', null], ['团队人物', 'people', 2], ['公开活动', 'events', 1], ['资料下载', 'downloads', 3]],
    'resource-center': [['资料下载', 'downloads', 3], ['使用指南', 'guides', null], ['更新公告', 'updates', null], ['培训活动', 'events', 1]],
  } as const;
  const channels = definitions[input.blueprint].map(([name, code, modelId], index) => ({ id: index + 1, name, code, slug: code, path: code, modelId, parentId: 0, type: 'list', pageSize: 12, sort: index, status: 'enabled', visible: true }));
  const models = [{ id: 1, code: 'event', name: '活动', ownerSiteId: 1 }, { id: 2, code: 'person', name: '人物', ownerSiteId: 1 }, { id: 3, code: 'download', name: '资料', ownerSiteId: 1 }];
  const field = (modelId: number, name: string, label: string, fieldType: string, required = false) => ({ modelId, name, label, fieldType, required, showInDetail: true, optionSource: 'manual', options: [] });
  const modelFields = [field(1, 'starts_at', '开始时间', 'datetime', true), field(1, 'ends_at', '结束时间', 'datetime'), field(1, 'venue', '活动地点', 'text', true), field(1, 'organizer', '主办方', 'text'),
    field(2, 'name', '姓名', 'text', true), field(2, 'role', '身份', 'text', true), field(2, 'portrait', '肖像', 'image'), field(2, 'biography', '人物简介', 'textarea'),
    field(3, 'file', '下载文件', 'file', true), field(3, 'version', '资料版本', 'text'), field(3, 'issued_at', '发布日期', 'date'), field(3, 'description', '资料说明', 'textarea')];
  const homeSections: CmsHomeSection[] = channels.slice(0, 6).map((channel, index) => ({ id: `section-${channel.code}`, source: 'channel', channelId: channel.id, title: channel.name,
    count: index === 0 ? 6 : 4, style: index === 0 ? 'feature-list' : 'cards', imageRatio: 'wide', focusX: 50, focusY: 50 }));
  const modelDisplays: CmsModelDisplay[] = [{ modelId: 1, kind: 'event', fields: { startsAt: 'starts_at', endsAt: 'ends_at', venue: 'venue', organizer: 'organizer' } },
    { modelId: 2, kind: 'person', fields: { name: 'name', role: 'role', portrait: 'portrait', biography: 'biography' } }, { modelId: 3, kind: 'download', fields: { file: 'file', version: 'version', issuedAt: 'issued_at', description: 'description' } }];
  const widgets = [{ id: 1, name: '常用栏目', code: 'quick-links', defaultRendererKey: 'list-sidebar', draftData: { items: channels.slice(0, 5).map((channel) => ({ id: `channel-${channel.id}`, sourceType: 'channel', sourceId: channel.id, title: channel.name })) } }];
  return { version: 2, site: { id: 1, name: input.name, code: input.code, title: input.name, theme: 'default', staticMode: 'hybrid', settings: { themeConfig: { homeSections, modelDisplays, footerText: input.name } } },
    models, modelFields, channels: [...channels, { id: 90, name: '联系我们', code: 'contact', slug: 'contact', path: 'contact', type: 'page', parentId: 0, modelId: null, sort: 90, status: 'enabled', visible: true, settings: { formCode: 'contact' } }],
    pages: [{ name: '关于我们', slug: 'about', path: 'about/', isHome: false, status: 'enabled', blocks: [{ id: 'about-hero', type: 'hero', props: { title: input.name, subtitle: '认识我们，了解最新资讯与服务' } }] },
      { name: '主题聚合', slug: 'topics', path: 'topics/', isHome: false, status: 'enabled', blocks: [{ id: 'topics-title', type: 'hero', props: { title: '专题精选', subtitle: '围绕一个主题，连接资讯、活动与资料' } }, { id: 'topics-list', type: 'content-list', props: { channelId: channels[0].id, count: 12 } }] }],
    widgets, widgetSlots: [{ field: 'home.sidebar', widgetId: 1, rendererKey: 'list-sidebar' }, { field: 'footer', widgetId: 1, rendererKey: 'list-sidebar' }],
    forms: [{ name: '联系与反馈', code: 'contact', status: 'enabled', successMessage: '感谢来信，我们会认真阅读并及时处理。', fields: [{ name: 'name', label: '称呼', fieldType: 'text', required: true }, { name: 'message', label: '留言内容', fieldType: 'textarea', required: true }] }],
    resourceFolders: [{ id: 1, name: '图片', parentId: null }, { id: 2, name: '音视频', parentId: null }, { id: 3, name: '资料', parentId: null }],
  };
}

export function remapCmsSiteComposition(settings: Record<string, unknown>, channels: ReadonlyMap<number, number>, models: ReadonlyMap<number, number>) {
  const output = structuredClone(settings);
  const config = output.themeConfig as Record<string, unknown> | undefined;
  if (!config) return output;
  const mapped = (map: ReadonlyMap<number, number>, id: number, label: string) => { const next = map.get(id); if (!next) throw new Error(`${label}没有随配置包提供`); return next; };
  if (Array.isArray(config.homeSections)) config.homeSections = config.homeSections.map((row: CmsHomeSection) => ({ ...row, channelId: row.channelId == null ? null : mapped(channels, row.channelId, '首页栏目') }));
  if (Array.isArray(config.modelDisplays)) config.modelDisplays = config.modelDisplays.map((row: CmsModelDisplay) => ({ ...row, modelId: mapped(models, row.modelId, '展示模型') }));
  return output;
}
