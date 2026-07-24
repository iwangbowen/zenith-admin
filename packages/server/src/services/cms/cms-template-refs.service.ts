/**
 * CMS 模板引用校验与主题健康检查。
 *
 * 模板配置（栏目 listTemplate/detailTemplate、站点 settings.defaultTemplates、
 * 栏目 settings.templates、内容 detailTemplate）存的是主题模板名字符串，与代码中
 * 主题注册表（cms/themes/registry）之间没有引用完整性约束：
 * - 写入侧：assertXxx 系列在保存时校验模板名存在，杜绝新增失效引用；
 * - 存量侧：getSiteTemplateHealth 扫描全站引用，暴露主题变更后的静默回退。
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { cmsChannels, cmsContents } from '../../db/schema';
import type { CmsChannelRow } from '../../db/schema';
import { isTemplateRegistered, isThemeRegistered, listThemeTemplates, getThemeSettingsSchema } from '../../cms/themes/registry';
import type { CmsSiteTemplateDefaults, CmsTemplateHealth, CmsInvalidTemplateRef } from '@zenith/shared';
import { resolveAvailableCmsTemplateNames } from './cms-template-resolution.service';
import { resolveEffectiveCmsSiteRow } from './cms-site-inheritance.service';

type TemplateKind = 'list' | 'detail';

/** 站点主题查询（本文件不依赖 cms-sites.service，避免服务间循环导入） */
async function getSiteTheme(siteId: number): Promise<string> {
  return (await resolveEffectiveCmsSiteRow(siteId)).theme;
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
function assertTemplateNameInSet(
  names: Set<string>,
  themeCode: string,
  name: string | null | undefined,
  location: string,
): void {
  if (!name || names.has(name)) return;
  const options = [...names];
  const available = options.length > 0 ? `可用：${options.join('、')}，或留空跟随默认` : '该主题无扩展模板，请留空跟随默认';
  throw new HTTPException(400, { message: `${location}「${name}」在主题「${themeCode}」中不存在（${available}）` });
}

async function availableTemplateSets(themeCode: string, siteId?: number, executor?: DbExecutor) {
  if (!siteId) {
    const builtin = isThemeRegistered(themeCode) ? listThemeTemplates(themeCode) : { list: [], detail: [] };
    return {
      themeAvailable: isThemeRegistered(themeCode),
      list: new Set(builtin.list.map((item) => item.name)),
      detail: new Set(builtin.detail.map((item) => item.name)),
    };
  }
  return resolveAvailableCmsTemplateNames(siteId, themeCode, { executor });
}

function assertTemplateDefaultsMap(
  themeCode: string,
  value: unknown,
  locationPrefix: string,
  sets: { list: Set<string>; detail: Set<string> },
): void {
  if (!value || typeof value !== 'object') return;
  for (const [device, raw] of Object.entries(value as Record<string, unknown>)) {
    const cfg = parseTemplateDefaults(raw);
    assertTemplateNameInSet(sets.list, themeCode, cfg.list, `${locationPrefix}[${device}]列表模板`);
    assertTemplateNameInSet(sets.detail, themeCode, cfg.detail, `${locationPrefix}[${device}]详情模板`);
    for (const [modelCode, name] of Object.entries(cfg.detailByModel ?? {})) {
      assertTemplateNameInSet(sets.detail, themeCode, name, `${locationPrefix}[${device}]${modelCode} 详情模板`);
    }
  }
}

/** 站点保存校验：settings.defaultTemplates 中的模板名须存在于目标主题 */
export async function assertSiteTemplateSettings(
  themeCode: string,
  settings: Record<string, unknown> | null | undefined,
  siteId?: number,
  executor?: DbExecutor,
): Promise<void> {
  assertTemplateDefaultsMap(
    themeCode,
    settings?.defaultTemplates,
    '站点默认模板',
    await availableTemplateSets(themeCode, siteId, executor),
  );
}

/** 站点保存校验：settings.themeConfig 中 select 类型参数的值须在主题声明的选项内 */
export function assertSiteThemeConfig(themeCode: string, settings: Record<string, unknown> | null | undefined): void {
  if (!isThemeRegistered(themeCode)) return;
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
  const sets = await availableTemplateSets(theme, siteId);
  assertTemplateNameInSet(sets.list, theme, data.listTemplate, '列表模板');
  assertTemplateNameInSet(sets.detail, theme, data.detailTemplate, '详情模板');
  assertTemplateDefaultsMap(theme, data.settings?.templates, '栏目通道模板', sets);
}

/** 内容保存校验：detailTemplate 须存在于站点主题 */
export async function assertContentTemplateBySite(siteId: number, detailTemplate: string | null | undefined): Promise<void> {
  if (!detailTemplate) return;
  const theme = await getSiteTheme(siteId);
  const sets = await availableTemplateSets(theme, siteId);
  assertTemplateNameInSet(sets.detail, theme, detailTemplate, '详情模板');
}

/** 生命周期停用前扫描某个活动模板 code 的显式引用；返回可行动的位置摘要。 */
export async function findCmsTemplateReferences(
  siteId: number,
  kind: TemplateKind,
  templateCode: string,
): Promise<string[]> {
  const [site, channels, contentCount] = await Promise.all([
    resolveEffectiveCmsSiteRow(siteId).catch(() => null),
    db.select().from(cmsChannels).where(eq(cmsChannels.siteId, siteId)),
    kind === 'detail'
      ? db.$count(cmsContents, and(
          eq(cmsContents.siteId, siteId),
          eq(cmsContents.detailTemplate, templateCode),
        ))
      : Promise.resolve(0),
  ]);
  if (!site) return [];
  const refs: string[] = [];
  const collectMap = (value: unknown, prefix: string) => {
    if (!value || typeof value !== 'object') return;
    for (const [device, raw] of Object.entries(value as Record<string, unknown>)) {
      const cfg = parseTemplateDefaults(raw);
      if (kind === 'list' && cfg.list === templateCode) refs.push(`${prefix}[${device}]列表`);
      if (kind === 'detail' && cfg.detail === templateCode) refs.push(`${prefix}[${device}]详情`);
      if (kind === 'detail') {
        for (const [model, name] of Object.entries(cfg.detailByModel ?? {})) {
          if (name === templateCode) refs.push(`${prefix}[${device}]${model}详情`);
        }
      }
    }
  };
  collectMap((site.settings as Record<string, unknown> | null)?.defaultTemplates, '站点');
  for (const channel of channels) {
    if (kind === 'list' && channel.listTemplate === templateCode) refs.push(`栏目 #${channel.id} 列表`);
    if (kind === 'detail' && channel.detailTemplate === templateCode) refs.push(`栏目 #${channel.id} 详情`);
    collectMap((channel.settings as Record<string, unknown> | null)?.templates, `栏目 #${channel.id}`);
  }
  if (contentCount > 0) refs.push(`${contentCount} 条内容详情`);
  return refs;
}

// ─── 存量扫描（主题健康检查）───────────────────────────────────────────────────
function scanChannelRefs(
  channel: CmsChannelRow,
  available: { list: Set<string>; detail: Set<string> },
  out: CmsInvalidTemplateRef[],
): void {
  const base = { source: 'channel' as const, channelId: channel.id, channelName: channel.name };
  if (channel.listTemplate && !available.list.has(channel.listTemplate)) out.push({ ...base, kind: 'list', template: channel.listTemplate, location: '列表模板' });
  if (channel.detailTemplate && !available.detail.has(channel.detailTemplate)) out.push({ ...base, kind: 'detail', template: channel.detailTemplate, location: '详情模板' });
  const templates = (channel.settings as Record<string, unknown> | null)?.templates;
  if (!templates || typeof templates !== 'object') return;
  for (const [device, raw] of Object.entries(templates as Record<string, unknown>)) {
    const cfg = parseTemplateDefaults(raw);
    if (cfg.list && !available.list.has(cfg.list)) out.push({ ...base, kind: 'list', template: cfg.list, location: `通道模板[${device}]列表` });
    if (cfg.detail && !available.detail.has(cfg.detail)) out.push({ ...base, kind: 'detail', template: cfg.detail, location: `通道模板[${device}]详情` });
    for (const [modelCode, name] of Object.entries(cfg.detailByModel ?? {})) {
      if (name && !available.detail.has(name)) out.push({ ...base, kind: 'detail', template: name, location: `通道模板[${device}]${modelCode} 详情` });
    }
  }
}

/**
 * 站点模板健康检查：扫描站点/栏目/内容三级的模板引用，返回在目标主题下失效的清单。
 * themeOverride 用于「切换主题前预检」：按目标主题而非当前主题判定。
 * 站点数据权限（assertSiteAccess）由路由层负责。
 */
export async function getSiteTemplateHealth(
  siteId: number,
  themeOverride?: string,
  override?: { list: string[]; detail: string[]; themeAvailable?: boolean },
): Promise<CmsTemplateHealth> {
  const site = await resolveEffectiveCmsSiteRow(siteId);
  const theme = themeOverride?.trim() || site.theme;
  const invalidRefs: CmsInvalidTemplateRef[] = [];
  const available = override
    ? { themeAvailable: override.themeAvailable ?? true, list: new Set(override.list), detail: new Set(override.detail) }
    : await availableTemplateSets(theme, siteId);

  // 站点级：settings.defaultTemplates
  const defaults = (site.settings as Record<string, unknown> | null)?.defaultTemplates;
  if (defaults && typeof defaults === 'object') {
    for (const [device, raw] of Object.entries(defaults as Record<string, unknown>)) {
      const cfg = parseTemplateDefaults(raw);
      if (cfg.list && !available.list.has(cfg.list)) invalidRefs.push({ source: 'site', kind: 'list', template: cfg.list, location: `站点默认模板[${device}]列表` });
      if (cfg.detail && !available.detail.has(cfg.detail)) invalidRefs.push({ source: 'site', kind: 'detail', template: cfg.detail, location: `站点默认模板[${device}]详情` });
      for (const [modelCode, name] of Object.entries(cfg.detailByModel ?? {})) {
        if (name && !available.detail.has(name)) invalidRefs.push({ source: 'site', kind: 'detail', template: name, location: `站点默认模板[${device}]${modelCode} 详情` });
      }
    }
  }

  // 栏目级 + 内容级（内容按模板名聚合计数，避免大站点逐条返回）
  const [channels, contentRefs] = await Promise.all([
    db.select().from(cmsChannels).where(eq(cmsChannels.siteId, siteId)),
    db.select({ template: cmsContents.detailTemplate, count: sql<number>`count(*)::int` })
      .from(cmsContents)
      .where(and(eq(cmsContents.siteId, siteId), isNotNull(cmsContents.detailTemplate)))
      .groupBy(cmsContents.detailTemplate),
  ]);
  for (const channel of channels) scanChannelRefs(channel, available, invalidRefs);
  for (const row of contentRefs) {
    if (!row.template || available.detail.has(row.template)) continue;
    invalidRefs.push({ source: 'content', kind: 'detail', template: row.template, location: '内容详情模板', count: row.count });
  }

  return {
    theme,
    themeRegistered: override?.themeAvailable ?? available.themeAvailable,
    invalidRefs,
  };
}
