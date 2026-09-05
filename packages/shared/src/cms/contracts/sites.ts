import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  CMS_SITE_INHERITABLE_FIELDS,
  CMS_STATIC_MODES,
  CMS_TEMPLATE_RESOLUTION_SOURCES,
  CMS_THEME_SETTING_FIELD_TYPES,
} from '../constants';
import {
  cmsSiteImportPackageSchema,
  createCmsSiteSchema,
  moveCmsSiteSchema,
  saveCmsOpenAppGrantSchema,
  setCmsAuthorizedUsersSchema,
  updateCmsSiteInheritanceSchema,
  updateCmsSiteSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsStaticModeSchema = z.enum(CMS_STATIC_MODES);

/** 站点逐项继承开关 */
export const cmsSiteInheritanceFlagsSchema = z.object({
  seoTitle: z.boolean(),
  seoKeywords: z.boolean(),
  seoDescription: z.boolean(),
  staticMode: z.boolean(),
  reviewMode: z.boolean(),
  webhook: z.boolean(),
  cdn: z.boolean(),
  theme: z.boolean(),
  themeConfig: z.boolean(),
  templates: z.boolean(),
}).meta({ id: 'CmsSiteInheritanceFlags' });

export type CmsSiteInheritanceFlags = z.infer<typeof cmsSiteInheritanceFlagsSchema>;

/** 站点节点字段（不含子树）；站点树在此基础上递归挂 children */
export const cmsSiteFieldsSchema = z.object({
  id: z.int(),
  parentId: z.int().nullable(),
  parentName: z.string().nullable().optional(),
  depth: z.int().positive().optional(),
  hasChildren: z.boolean().optional(),
  name: z.string().meta({ example: '官方网站' }),
  code: z.string().meta({ example: 'main' }),
  domain: z.string().nullable(),
  aliasDomains: z.array(z.string()),
  isDefault: z.boolean(),
  title: z.string().nullable(),
  keywords: z.string().nullable(),
  description: z.string().nullable(),
  logo: z.string().nullable(),
  favicon: z.string().nullable(),
  icp: z.string().nullable(),
  copyright: z.string().nullable(),
  theme: z.string(),
  effectiveTheme: z.string().optional(),
  themeRevision: z.int(),
  templateRefsRevision: z.int(),
  publicRevision: z.int(),
  staticMode: cmsStaticModeSchema,
  effectiveStaticMode: cmsStaticModeSchema.optional(),
  robots: z.string().nullable(),
  modelId: z.int().nullable().meta({ description: '站点级扩展模型' }),
  modelName: z.string().nullable().optional(),
  extend: z.record(z.string(), z.unknown()).meta({ description: '站点扩展模型字段值（key = 字段标识）' }),
  settings: z.record(z.string(), z.unknown()).meta({ description: '站点配置（secret 类键始终掩码）' }),
  status: entityStatusSchema,
  sort: z.int(),
  remark: z.string().nullable(),
  inheritance: cmsSiteInheritanceFlagsSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** 递归类型需要显式命名，声明文件才能保留 children 的元素类型 */
export interface CmsSite extends z.infer<typeof cmsSiteFieldsSchema> {
  children?: CmsSite[];
}

export const cmsSiteSchema: z.ZodType<CmsSite> = cmsSiteFieldsSchema
  .extend({
    get children() {
      return z.array(cmsSiteSchema).optional();
    },
  })
  .meta({ id: 'CmsSite' });

/** 站点级默认模板配置（存于 settings.defaultTemplates） */
export const cmsSiteTemplateDefaultsSchema = z.object({
  list: z.string().nullish().meta({ description: '栏目列表页默认模板（空 = 主题默认）' }),
  detail: z.string().nullish().meta({ description: '内容详情页默认模板（空 = 主题默认）' }),
  detailByModel: z.record(z.string(), z.string().nullable()).optional().meta({ description: '按内容模型细分的详情模板（key = 模型 code，优先于 detail）' }),
}).meta({ id: 'CmsSiteTemplateDefaults' });

export type CmsSiteTemplateDefaults = z.infer<typeof cmsSiteTemplateDefaultsSchema>;

export const cmsSiteInheritanceSourceSchema = z.object({
  kind: z.enum(['own', 'inherited']),
  siteId: z.int().nullable().meta({ description: '无权查看来源站点时不返回其 id / name' }),
  siteName: z.string().nullable(),
}).meta({ id: 'CmsSiteInheritanceSource' });

export type CmsSiteInheritanceSource = z.infer<typeof cmsSiteInheritanceSourceSchema>;

export const cmsSiteEffectiveConfigSchema = z.object({
  siteId: z.int(),
  chain: z.array(z.object({
    id: z.int(),
    name: z.string(),
    code: z.string(),
    depth: z.int().positive(),
  })),
  inheritance: cmsSiteInheritanceFlagsSchema,
  resolved: z.object({
    title: z.string().nullable(),
    keywords: z.string().nullable(),
    description: z.string().nullable(),
    staticMode: cmsStaticModeSchema,
    auditMode: z.enum(['simple', 'workflow']),
    auditWorkflowDefinitionId: z.int().nullable(),
    webhookUrl: z.string().nullable(),
    webhookSecret: z.string().nullable().meta({ description: '仅为掩码或 null，绝不包含明文' }),
    cdnPurgeUrl: z.string().nullable(),
    cdnPurgeToken: z.string().nullable().meta({ description: '仅为掩码或 null，绝不包含明文' }),
    theme: z.string(),
    themeSourceSiteId: z.int().nullable(),
    themeConfig: z.record(z.string(), z.unknown()),
    defaultTemplates: cmsSiteTemplateDefaultsSchema,
  }),
  sources: z.record(z.enum(CMS_SITE_INHERITABLE_FIELDS), cmsSiteInheritanceSourceSchema),
}).meta({ id: 'CmsSiteEffectiveConfig' });

export type CmsSiteEffectiveConfig = z.infer<typeof cmsSiteEffectiveConfigSchema>;

export const cmsSiteChainNodeSchema = z.object({
  id: z.int(),
  parentId: z.int().nullable(),
  name: z.string(),
  code: z.string(),
  depth: z.int().positive(),
  status: entityStatusSchema,
}).meta({ id: 'CmsSiteChainNode' });

export type CmsSiteChainNode = z.infer<typeof cmsSiteChainNodeSchema>;

export const cmsSiteMoveResultSchema = z.object({
  site: cmsSiteSchema,
  affectedSiteIds: z.array(z.int()),
  maxDepth: z.int(),
}).meta({ id: 'CmsSiteMoveResult' });

export type CmsSiteMoveResult = z.infer<typeof cmsSiteMoveResultSchema>;

export const cmsSiteInheritanceUpdateResultSchema = z.object({
  inheritance: cmsSiteInheritanceFlagsSchema,
  effectiveConfig: cmsSiteEffectiveConfigSchema,
  affectedSiteIds: z.array(z.int()),
}).meta({ id: 'CmsSiteInheritanceUpdateResult' });

export type CmsSiteInheritanceUpdateResult = z.infer<typeof cmsSiteInheritanceUpdateResultSchema>;

export const cmsThemeSchema = z.object({
  code: z.string().meta({ example: 'default' }),
  label: z.string().meta({ example: '默认主题' }),
}).meta({ id: 'CmsTheme' });

export type CmsTheme = z.infer<typeof cmsThemeSchema>;

/** 主题可选模板项（后台模板下拉） */
export const cmsThemeTemplateOptionSchema = z.object({
  name: z.string().meta({ example: 'list-card' }),
  label: z.string().meta({ example: '卡片网格（产品/案例）' }),
  source: z.enum(CMS_TEMPLATE_RESOLUTION_SOURCES).optional(),
  sourceSiteId: z.int().nullable().optional(),
}).meta({ id: 'CmsThemeTemplateOption' });

export type CmsThemeTemplateOption = z.infer<typeof cmsThemeTemplateOptionSchema>;

/** 主题可选模板清单（不含主题默认模板本身，前端下拉自行加「跟随默认」项） */
export const cmsThemeTemplateManifestSchema = z.object({
  list: z.array(cmsThemeTemplateOptionSchema),
  detail: z.array(cmsThemeTemplateOptionSchema),
}).meta({ id: 'CmsThemeTemplates' });

export type CmsThemeTemplateManifest = z.infer<typeof cmsThemeTemplateManifestSchema>;

/** 主题参数字段声明（内置主题 settingsSchema，值存 settings.themeConfig[name]） */
export const cmsThemeSettingFieldSchema = z.object({
  name: z.string().meta({ example: 'footerText', description: 'settings.themeConfig 的 key' }),
  label: z.string().meta({ example: '页脚附加文案' }),
  fieldType: z.enum(CMS_THEME_SETTING_FIELD_TYPES),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  placeholder: z.string().optional(),
  description: z.string().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  group: z.string().optional().meta({ description: '分组标题（同组字段渲染在同一区块下）' }),
}).meta({ id: 'CmsThemeSettingField' });

export type CmsThemeSettingField = z.infer<typeof cmsThemeSettingFieldSchema>;

export const cmsInvalidTemplateRefSchema = z.object({
  source: z.enum(['site', 'channel', 'content']).meta({ description: '引用位置层级' }),
  kind: z.enum(['list', 'detail']),
  template: z.string().meta({ example: 'list-card', description: '失效的模板名' }),
  location: z.string().meta({ example: '站点默认模板[pc]列表' }),
  channelId: z.int().optional(),
  channelName: z.string().optional(),
  count: z.int().optional().meta({ description: 'source=content 时聚合的内容条数' }),
}).meta({ id: 'CmsInvalidTemplateRef' });

export type CmsInvalidTemplateRef = z.infer<typeof cmsInvalidTemplateRefSchema>;

/** 站点模板健康检查：配置中引用但目标主题不存在的模板清单 */
export const cmsTemplateHealthSchema = z.object({
  theme: z.string().meta({ example: 'default' }),
  themeRegistered: z.boolean().meta({ description: '主题是否为内置可信主题' }),
  invalidRefs: z.array(cmsInvalidTemplateRefSchema),
}).meta({ id: 'CmsTemplateHealth' });

export type CmsTemplateHealth = z.infer<typeof cmsTemplateHealthSchema>;

/** 站点 / 栏目授权用户名单 */
export const cmsAuthorizedUsersSchema = z.object({
  userIds: z.array(z.int()),
  users: z.array(z.object({ id: z.int(), username: z.string(), nickname: z.string() })),
}).meta({ id: 'CmsAuthorizedUsers' });

export type CmsAuthorizedUsers = z.infer<typeof cmsAuthorizedUsersSchema>;

export const cmsSiteAnalyticsEnableResultSchema = z.object({
  siteKey: z.string(),
  created: z.boolean(),
}).meta({ id: 'CmsSiteAnalyticsEnableResult' });

export type CmsSiteAnalyticsEnableResult = z.infer<typeof cmsSiteAnalyticsEnableResultSchema>;

export const cmsSiteImportResultSchema = z.object({
  siteId: z.int(),
  siteName: z.string(),
  siteCode: z.string(),
  counts: z.object({
    channels: z.int(),
    tags: z.int(),
    contents: z.int(),
    friendLinks: z.int(),
    redirects: z.int(),
    linkWords: z.int(),
    adSlots: z.int(),
    ads: z.int(),
    forms: z.int(),
    interactions: z.int(),
    interactionQuestions: z.int(),
    resourceFolders: z.int(),
    resources: z.int(),
    models: z.int(),
    modelFields: z.int(),
    friendLinkGroups: z.int(),
    widgets: z.int(),
    pages: z.int(),
  }),
  skipped: z.object({ widgetSlots: z.int() }),
  warnings: z.array(z.string()),
}).meta({ id: 'CmsSiteImportResult' });

export type CmsSiteImportResult = z.infer<typeof cmsSiteImportResultSchema>;

/** 开放应用的 CMS 站点授权（Headless 写入的 fail-closed 边界） */
export const cmsOpenAppGrantSchema = z.object({
  id: z.int(),
  clientId: z.string().meta({ description: '开放应用 AppKey' }),
  appName: z.string().nullable(),
  siteId: z.int(),
  siteName: z.string().nullable(),
  channelIds: z.array(z.int()).meta({ description: '允许写入的栏目；空数组 = 该站点全部栏目' }),
  canPublish: z.boolean().meta({ description: '是否允许直接发布（还需 cms:publish scope 与站点开关）' }),
  status: entityStatusSchema,
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsOpenAppGrant' });

export type CmsOpenAppGrant = z.infer<typeof cmsOpenAppGrantSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsSiteListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  status: entityStatusSchema.optional(),
});

export const cmsSiteTreeQuery = z.object({
  keyword: z.string().max(100).optional(),
  status: entityStatusSchema.optional(),
});

export const cmsThemeScopeQuery = z.object({
  siteId: z.coerce.number().int().positive().optional(),
});

export const cmsThemeCodeParam = z.object({
  code: z.string().min(1).meta({ description: '主题编码', example: 'default' }),
});

export const cmsTemplateHealthQuery = z.object({
  theme: z.string().max(50).optional().meta({ description: '预检切换目标主题；缺省为站点当前主题' }),
});

export const cmsOpenGrantIdParam = z.object({
  grantId: z.coerce.number().int().positive().meta({ description: '授权记录 ID', example: 1 }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsSiteContract = defineContract('/api/cms/sites', {
  list: op.get('/', { query: cmsSiteListQuery, response: paginated(cmsSiteSchema), summary: '站点分页列表' }),
  all: op.get('/all', { response: z.array(cmsSiteSchema), summary: '全部启用站点（站点切换器）' }),
  tree: op.get('/tree', { query: cmsSiteTreeQuery, response: z.array(cmsSiteSchema), summary: '受权站点树（普通用户仅返回显式授权站点）' }),
  themes: op.get('/themes', { query: cmsThemeScopeQuery, response: z.array(cmsThemeSchema), summary: '可用主题列表' }),
  themeTemplates: op.get('/themes/{code}/templates', { params: cmsThemeCodeParam, query: cmsThemeScopeQuery, response: cmsThemeTemplateManifestSchema, summary: '主题可选模板清单（站点默认模板/栏目/内容模板下拉）' }),
  themeSettingsSchema: op.get('/themes/{code}/settings-schema', { params: cmsThemeCodeParam, response: z.array(cmsThemeSettingFieldSchema), summary: '主题参数声明（后台主题参数面板动态表单）' }),
  templateHealth: op.get('/{id}/template-health', { params: idParam, query: cmsTemplateHealthQuery, response: cmsTemplateHealthSchema, summary: '站点模板健康检查（扫描站点/栏目/内容的失效模板引用；?theme= 预检切换目标主题）' }),
  inheritanceChain: op.get('/{id}/inheritance-chain', { params: idParam, response: z.array(cmsSiteChainNodeSchema), summary: '查看站点继承链（隐藏无权父级）' }),
  effectiveConfig: op.get('/{id}/effective-config', { params: idParam, response: cmsSiteEffectiveConfigSchema, summary: '有效配置及逐项来源（secret 始终掩码）' }),
  move: op.put('/{id}/parent', { params: idParam, body: moveCmsSiteSchema, response: cmsSiteMoveResultSchema, summary: '安全移动站点子树' }),
  updateInheritance: op.put('/{id}/inheritance', { params: idParam, body: updateCmsSiteInheritanceSchema, response: cmsSiteInheritanceUpdateResultSchema, summary: '逐项覆盖或恢复继承' }),
  detail: op.get('/{id}', { params: idParam, response: cmsSiteSchema, summary: '站点详情' }),
  create: op.post('/', { body: createCmsSiteSchema, response: cmsSiteSchema, summary: '创建站点' }),
  update: op.put('/{id}', { params: idParam, body: updateCmsSiteSchema, response: cmsSiteSchema, summary: '更新站点' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除站点' }),
  users: op.get('/{id}/users', { params: idParam, response: cmsAuthorizedUsersSchema, summary: '站点授权用户' }),
  setUsers: op.put('/{id}/users', { params: idParam, body: setCmsAuthorizedUsersSchema, summary: '设置站点授权用户（绑定后仅授权用户可管理该站点）' }),
  enableAnalytics: op.post('/{id}/enable-analytics', { params: idParam, response: cmsSiteAnalyticsEnableResultSchema, summary: '开通行为统计（自动创建统计站点，前台注入采集脚本）' }),
  import: op.post('/import', { body: cmsSiteImportPackageSchema, response: cmsSiteImportResultSchema, summary: '导入站点（上传导出包 JSON，创建为新站点）' }),
  export: op.get('/{id}/export', { params: idParam, kind: 'file', summary: '导出站点（结构 + 内容整站打包为 JSON 附件，不含运行数据）' }),
  openGrants: op.get('/{id}/open-grants', { params: idParam, response: z.array(cmsOpenAppGrantSchema), summary: '站点的开放应用授权列表' }),
  saveOpenGrant: op.put('/{id}/open-grants', { params: idParam, body: saveCmsOpenAppGrantSchema, response: cmsOpenAppGrantSchema, summary: '授权开放应用写入本站点（未授权一律拒绝）' }),
  removeOpenGrant: op.delete('/open-grants/{grantId}', { params: cmsOpenGrantIdParam, summary: '删除开放应用授权' }),
}, { tags: ['CMS-站点管理'] });
