import * as z from 'zod';
import { CMS_HOME_IMAGE_RATIOS, CMS_HOME_SECTION_SOURCES, CMS_HOME_SECTION_STYLES, CMS_MODEL_DISPLAY_KINDS, CMS_MODEL_DISPLAY_LABELS } from './constants';

export const cmsHomeSectionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  source: z.enum(CMS_HOME_SECTION_SOURCES),
  channelId: z.int().positive().nullable(),
  title: z.string().trim().max(80),
  count: z.int().min(1).max(24),
  style: z.enum(CMS_HOME_SECTION_STYLES),
  imageRatio: z.enum(CMS_HOME_IMAGE_RATIOS),
  focusX: z.number().min(0).max(100),
  focusY: z.number().min(0).max(100),
}).superRefine((row, ctx) => {
  if (row.source === 'channel' && row.channelId === null) ctx.addIssue({ code: 'custom', path: ['channelId'], message: '请选择栏目' });
  if (row.source !== 'channel' && row.channelId !== null) ctx.addIssue({ code: 'custom', path: ['channelId'], message: '全站来源不能绑定单个栏目' });
});
export type CmsHomeSection = z.infer<typeof cmsHomeSectionSchema>;
export const cmsHomeSectionsSchema = z.array(cmsHomeSectionSchema).max(16).superRefine((rows, ctx) => {
  if (new Set(rows.map((row) => row.id)).size !== rows.length) ctx.addIssue({ code: 'custom', message: '首页区域标识不能重复' });
});

export const cmsModelDisplaySchema = z.object({
  modelId: z.int().positive(),
  kind: z.enum(CMS_MODEL_DISPLAY_KINDS),
  fields: z.record(z.string().min(1).max(60), z.string().min(1).max(60)),
});
export type CmsModelDisplay = z.infer<typeof cmsModelDisplaySchema>;
export const CMS_SITE_COMPOSITION_SETTING_FIELDS = [
  { name: 'homeSections', label: '首页内容编排', fieldType: 'home-sections', group: '首页', description: '按区域选择内容来源、条数和样式；宽屏双列，手机单列。未编排时展示全站最新内容。' },
  { name: 'modelDisplays', label: '模型展示方案', fieldType: 'model-displays', group: '内容详情', description: '将已发布模型字段映射到活动、人物和资料下载信息卡。' },
] as const;
export const cmsModelDisplaysSchema = z.array(cmsModelDisplaySchema).max(50).superRefine((rows, ctx) => {
  if (new Set(rows.map((row) => row.modelId)).size !== rows.length) ctx.addIssue({ code: 'custom', message: '每个模型只能绑定一种展示方案' });
});

export const CMS_MODEL_DISPLAY_ROLES: Record<CmsModelDisplay['kind'], readonly { key: string; label: string; required: boolean; types: readonly string[] }[]> = {
  event: [
    { key: 'startsAt', label: '开始时间', required: true, types: ['date', 'datetime'] },
    { key: 'endsAt', label: '结束时间', required: false, types: ['date', 'datetime'] },
    { key: 'venue', label: '活动地点', required: true, types: ['text', 'textarea'] },
    { key: 'organizer', label: '主办方', required: false, types: ['text', 'textarea'] },
  ],
  person: [
    { key: 'name', label: '姓名', required: true, types: ['text'] },
    { key: 'role', label: '职务或身份', required: true, types: ['text', 'select', 'radio'] },
    { key: 'portrait', label: '肖像', required: false, types: ['image'] },
    { key: 'biography', label: '人物简介', required: false, types: ['text', 'textarea', 'richtext'] },
  ],
  download: [
    { key: 'file', label: '下载文件', required: true, types: ['file'] },
    { key: 'version', label: '资料版本', required: false, types: ['text', 'number'] },
    { key: 'issuedAt', label: '发布日期', required: false, types: ['date', 'datetime'] },
    { key: 'description', label: '资料说明', required: false, types: ['text', 'textarea'] },
  ],
};

/** Theme capabilities are shared with Demo; unknown slots are never accepted by fallback. */
export const CMS_DEFAULT_THEME_WIDGET_SLOTS = [
  { key: 'home.main', label: '首页主区', allowedTypes: ['manual-list'], rendererKeys: ['list-grid', 'list-carousel'] },
  { key: 'home.sidebar', label: '首页侧栏', allowedTypes: ['manual-list'], rendererKeys: ['list-sidebar', 'list-grid'] },
  { key: 'detail.related', label: '详情相关推荐', allowedTypes: ['manual-list'], rendererKeys: ['list-sidebar', 'list-grid'] },
  { key: 'footer', label: '页脚', allowedTypes: ['manual-list'], rendererKeys: ['list-sidebar', 'list-grid'] },
] as const;

export function validateCmsModelDisplay(binding: CmsModelDisplay, model: { id: number; fields: readonly { name: string; fieldType: string }[] } | undefined): string[] {
  if (!model || model.id !== binding.modelId) return ['展示方案绑定的模型不存在或不可用'];
  const roles = CMS_MODEL_DISPLAY_ROLES[binding.kind];
  const issues: string[] = [];
  for (const key of Object.keys(binding.fields)) if (!roles.some((role) => role.key === key)) issues.push(`不支持展示位置 ${key}`);
  for (const role of roles) {
    const name = binding.fields[role.key];
    if (!name) { if (role.required) issues.push(`${CMS_MODEL_DISPLAY_LABELS[binding.kind]}必须映射${role.label}`); continue; }
    const field = model.fields.find((item) => item.name === name);
    if (!field) issues.push(`${role.label}引用的字段 ${name} 不存在`);
    else if (!role.types.includes(field.fieldType)) issues.push(`${role.label}不支持字段 ${name} 的类型 ${field.fieldType}`);
  }
  return issues;
}

export function validateCmsHomeSections(sections: readonly CmsHomeSection[], channels: readonly { id: number; siteId: number; name: string; status: string; type: string }[], siteId: number): string[] {
  return sections.flatMap((section) => {
    if (section.source !== 'channel') return [];
    const channel = channels.find((row) => row.id === section.channelId && row.siteId === siteId);
    return !channel ? ['首页编排引用了不存在或其他站点的栏目'] : channel.status !== 'enabled' || channel.type !== 'list' ? [`栏目「${channel.name}」必须是启用的列表栏目`] : [];
  });
}

export function cmsModelDisplayFor(config: Record<string, unknown>, modelId: number | null | undefined): CmsModelDisplay | undefined {
  const parsed = cmsModelDisplaysSchema.safeParse(config.modelDisplays ?? []);
  return parsed.success ? parsed.data.find((row) => row.modelId === modelId) : undefined;
}
