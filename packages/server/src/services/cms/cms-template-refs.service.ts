/**
 * CMS 模板引用校验与主题健康检查。
 *
 * 模板配置（栏目 listTemplate/detailTemplate、站点 settings.defaultTemplates、
 * 栏目 settings.templates、内容 detailTemplate）存的是主题模板名字符串，与代码中
 * 主题注册表（cms/themes/registry）之间没有引用完整性约束：
 * - 写入侧：assertXxx 系列在保存时校验模板名存在，杜绝新增失效引用；
 * - 存量侧：getSiteTemplateHealth 扫描全站引用，暴露主题变更后的静默回退。
 */
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsSites, cmsChannels, cmsContents } from '../../db/schema';
import type { CmsChannelRow } from '../../db/schema';
import { isThemeRegistered, isTemplateRegistered, listThemeTemplates, getThemeSettingsSchema } from '../../cms/themes/registry';
import type { CmsSiteTemplateDefaults, CmsTemplateHealth, CmsInvalidTemplateRef } from '@zenith/shared';

type TemplateKind = 'list' | 'detail';

/** 站点主题查询（本文件不依赖 cms-sites.service，避免服务间循环导入） */
async function getSiteTheme(siteId: number): Promise<string> {
  const [row] = await db.select({ theme: cmsSites.theme }).from(cmsSites).where(eq(cmsSites.id, siteId)).limit(1);
  if (!row) throw new HTTPException(404, { message: '站点不存在' });
  return row.theme;
}

/** 校验模板名在主题中存在，不存在抛 400（附可用模板清单） */
export function assertTemplateName(
  themeCode: string,
  kind: TemplateKind,
  name: string | null | undefined,
  location: string,
): void {
  if (!name) return; // 空 = 跟随默认，合法
  if (isTemplateRegistered(themeCode, kind, name)) return;
  const options = listThemeTemplates(themeCode)[kind].map((t) => t.name);
  const available = options.length > 0 ? `可用：${options.join('、')}，或留空跟随默认` : '该主题无扩展模板，请留空跟随默认';
  throw new HTTPException(400, {
    message: `${location}「${name}」在主题「${themeCode}」中不存在（${available}）`,
  });
}

/** 从 settings 的 unknown 值中提取 CmsSiteTemplateDefaults 形状（宽容解析，非法结构跳过） */
function parseTemplateDefaults(value: unknown): CmsSiteTemplateDefaults {
  if (!value || typeof value !== 'object') return {};
  const cfg = value as Record<string, unknown>;
  return {
    list: typeof cfg.list === 'string' ? cfg.list : null,
    detail: typeof cfg.detail === 'string' ? cfg.detail : null,
    detailByModel: (cfg.detailByModel && typeof cfg.detailByModel === 'object')
      ? Object.fromEntries(Object.entries(cfg.detailByModel as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
      : {},
  };
}

/** 校验一组「通道 → 模板默认值」配置（站点 settings.defaultTemplates / 栏目 settings.templates 共用结构） */
function assertTemplateDefaultsMap(themeCode: string, value: unknown, locationPrefix: string): void {
  if (!value || typeof value !== 'object') return;
  for (const [device, raw] of Object.entries(value as Record<string, unknown>)) {
    const cfg = parseTemplateDefaults(raw);
    assertTemplateName(themeCode, 'list', cfg.list, `${locationPrefix}[${device}]列表模板`);
    assertTemplateName(themeCode, 'detail', cfg.detail, `${locationPrefix}[${device}]详情模板`);
    for (const [modelCode, name] of Object.entries(cfg.detailByModel ?? {})) {
      assertTemplateName(themeCode, 'detail', name, `${locationPrefix}[${device}]${modelCode} 详情模板`);
    }
  }
}

/** 站点保存校验：settings.defaultTemplates 中的模板名须存在于目标主题 */
export function assertSiteTemplateSettings(themeCode: string, settings: Record<string, unknown> | null | undefined): void {
  assertTemplateDefaultsMap(themeCode, settings?.defaultTemplates, '站点默认模板');
}

/** 站点保存校验：settings.themeConfig 中 select 类型参数的值须在主题声明的选项内 */
export function assertSiteThemeConfig(themeCode: string, settings: Record<string, unknown> | null | undefined): void {
  const raw = settings?.themeConfig;
  if (!raw || typeof raw !== 'object') return;
  const config = raw as Record<string, unknown>;
  for (const field of getThemeSettingsSchema(themeCode)) {
    if (field.fieldType !== 'select') continue;
    const value = config[field.name];
    if (value === undefined || value === null || value === '') continue;
    if (!(field.options ?? []).some((o) => o.value === value)) {
      const options = (field.options ?? []).map((o) => o.value).join('、');
      throw new HTTPException(400, { message: `主题参数「${field.label}」的值无效（可选：${options}）` });
    }
  }
}

/** 栏目保存校验：listTemplate / detailTemplate / settings.templates 中的模板名须存在于站点主题 */
export async function assertChannelTemplatesBySite(
  siteId: number,
  data: { listTemplate?: string | null; detailTemplate?: string | null; settings?: Record<string, unknown> },
): Promise<void> {
  const hasSettingsTemplates = data.settings?.templates && typeof data.settings.templates === 'object'
    && Object.keys(data.settings.templates as Record<string, unknown>).length > 0;
  if (!data.listTemplate && !data.detailTemplate && !hasSettingsTemplates) return;
  const theme = await getSiteTheme(siteId);
  assertTemplateName(theme, 'list', data.listTemplate, '列表模板');
  assertTemplateName(theme, 'detail', data.detailTemplate, '详情模板');
  assertTemplateDefaultsMap(theme, data.settings?.templates, '栏目通道模板');
}

/** 内容保存校验：detailTemplate 须存在于站点主题 */
export async function assertContentTemplateBySite(siteId: number, detailTemplate: string | null | undefined): Promise<void> {
  if (!detailTemplate) return;
  const theme = await getSiteTheme(siteId);
  assertTemplateName(theme, 'detail', detailTemplate, '详情模板');
}

// ─── 存量扫描（主题健康检查）───────────────────────────────────────────────────
function checkRef(
  themeCode: string,
  kind: TemplateKind,
  name: string | null | undefined,
  ref: Omit<CmsInvalidTemplateRef, 'kind' | 'template'>,
  out: CmsInvalidTemplateRef[],
): void {
  if (!name) return;
  if (isTemplateRegistered(themeCode, kind, name)) return;
  out.push({ ...ref, kind, template: name });
}

function scanChannelRefs(themeCode: string, channel: CmsChannelRow, out: CmsInvalidTemplateRef[]): void {
  const base = { source: 'channel' as const, channelId: channel.id, channelName: channel.name };
  checkRef(themeCode, 'list', channel.listTemplate, { ...base, location: '列表模板' }, out);
  checkRef(themeCode, 'detail', channel.detailTemplate, { ...base, location: '详情模板' }, out);
  const templates = (channel.settings as Record<string, unknown> | null)?.templates;
  if (!templates || typeof templates !== 'object') return;
  for (const [device, raw] of Object.entries(templates as Record<string, unknown>)) {
    const cfg = parseTemplateDefaults(raw);
    checkRef(themeCode, 'list', cfg.list, { ...base, location: `通道模板[${device}]列表` }, out);
    checkRef(themeCode, 'detail', cfg.detail, { ...base, location: `通道模板[${device}]详情` }, out);
    for (const [modelCode, name] of Object.entries(cfg.detailByModel ?? {})) {
      checkRef(themeCode, 'detail', name, { ...base, location: `通道模板[${device}]${modelCode} 详情` }, out);
    }
  }
}

/**
 * 站点模板健康检查：扫描站点/栏目/内容三级的模板引用，返回在目标主题下失效的清单。
 * themeOverride 用于「切换主题前预检」：按目标主题而非当前主题判定。
 * 站点数据权限（assertSiteAccess）由路由层负责。
 */
export async function getSiteTemplateHealth(siteId: number, themeOverride?: string): Promise<CmsTemplateHealth> {
  const [site] = await db.select().from(cmsSites).where(eq(cmsSites.id, siteId)).limit(1);
  if (!site) throw new HTTPException(404, { message: '站点不存在' });
  const theme = themeOverride?.trim() || site.theme;
  const invalidRefs: CmsInvalidTemplateRef[] = [];

  // 站点级：settings.defaultTemplates
  const defaults = (site.settings as Record<string, unknown> | null)?.defaultTemplates;
  if (defaults && typeof defaults === 'object') {
    for (const [device, raw] of Object.entries(defaults as Record<string, unknown>)) {
      const cfg = parseTemplateDefaults(raw);
      checkRef(theme, 'list', cfg.list, { source: 'site', location: `站点默认模板[${device}]列表` }, invalidRefs);
      checkRef(theme, 'detail', cfg.detail, { source: 'site', location: `站点默认模板[${device}]详情` }, invalidRefs);
      for (const [modelCode, name] of Object.entries(cfg.detailByModel ?? {})) {
        checkRef(theme, 'detail', name, { source: 'site', location: `站点默认模板[${device}]${modelCode} 详情` }, invalidRefs);
      }
    }
  }

  // 栏目级 + 内容级（内容按模板名聚合计数，避免大站点逐条返回）
  const [channels, contentRefs] = await Promise.all([
    db.select().from(cmsChannels).where(eq(cmsChannels.siteId, siteId)),
    db.select({ template: cmsContents.detailTemplate, count: sql<number>`count(*)::int` })
      .from(cmsContents)
      .where(and(eq(cmsContents.siteId, siteId), isNotNull(cmsContents.detailTemplate), isNull(cmsContents.deletedAt)))
      .groupBy(cmsContents.detailTemplate),
  ]);
  for (const channel of channels) scanChannelRefs(theme, channel, invalidRefs);
  for (const row of contentRefs) {
    if (!row.template || isTemplateRegistered(theme, 'detail', row.template)) continue;
    invalidRefs.push({ source: 'content', kind: 'detail', template: row.template, location: '内容详情模板', count: row.count });
  }

  return { theme, themeRegistered: isThemeRegistered(theme), invalidRefs };
}
