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
import { isDirectCmsHref, isValidCmsAssetUrl } from '@zenith/shared/cms';
import type { CmsSiteTemplateDefaults, CmsTemplateHealth, CmsInvalidTemplateRef } from '@zenith/shared/cms';
import { resolveEffectiveCmsSiteRow } from './cms-site-inheritance.service';
import { assertCmsSiteComposition } from './cms-site-composition.service';

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

/** 校验一组模板默认值配置（站点 settings.defaultTemplates / 栏目 settings.templates 共用结构） */
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

async function availableTemplateSets(themeCode: string, _siteId?: number, _executor?: DbExecutor) {
  const builtin = isThemeRegistered(themeCode) ? listThemeTemplates(themeCode) : { list: [], detail: [] };
  return {
    themeAvailable: isThemeRegistered(themeCode),
    list: new Set(builtin.list.map((item) => item.name)),
    detail: new Set(builtin.detail.map((item) => item.name)),
  };
}

function assertTemplateDefaultsMap(
  themeCode: string,
  value: unknown,
  locationPrefix: string,
  sets: { list: Set<string>; detail: Set<string> },
): void {
  if (!value || typeof value !== 'object') return;
  const cfg = parseTemplateDefaults(value);
  assertTemplateNameInSet(sets.list, themeCode, cfg.list, `${locationPrefix}列表模板`);
  assertTemplateNameInSet(sets.detail, themeCode, cfg.detail, `${locationPrefix}详情模板`);
  for (const [modelCode, name] of Object.entries(cfg.detailByModel ?? {})) {
    assertTemplateNameInSet(sets.detail, themeCode, name, `${locationPrefix}${modelCode} 详情模板`);
  }
}

/** 站点保存校验：settings.defaultTemplates 中的模板名须存在于目标主题 */
export async function assertSiteTemplateSettings(
  themeCode: string,
  settings: Record<string, unknown> | null | undefined,
  siteId?: number,
  executor?: DbExecutor,
): Promise<void> {
  await assertCmsSiteComposition(themeCode, settings, siteId, executor);
  assertTemplateDefaultsMap(
    themeCode,
    settings?.defaultTemplates,
    '站点默认',
    await availableTemplateSets(themeCode, siteId, executor),
  );
}

/**
 * 剔除「本次请求未改动、且在当前主题下已失效」的默认模板引用。
 *
 * 主题升级移除模板变体后，站点 settings.defaultTemplates 里的历史引用会变成死配置。
 * 由于站点保存按**合并后的完整 settings** 做校验，这类存量脏数据会连带卡住该站点
 * 所有与模板无关的 settings 写入（如内容策略开关）。这里在校验前把它们摘掉实现自愈；
 * 本次新提交/改动的失效模板名不在剔除范围内，仍由 assertSiteTemplateSettings 抛 400，
 * 保留对拼写错误的即时反馈。
 */
export function pruneStaleTemplateDefaults(
  themeCode: string,
  settings: Record<string, unknown>,
  previousSettings: Record<string, unknown> | null | undefined,
): { settings: Record<string, unknown>; removed: string[] } {
  const raw = settings.defaultTemplates;
  if (!raw || typeof raw !== 'object' || !isThemeRegistered(themeCode)) return { settings, removed: [] };

  const sets = {
    list: new Set(listThemeTemplates(themeCode).list.map((t) => t.name)),
    detail: new Set(listThemeTemplates(themeCode).detail.map((t) => t.name)),
  };
  const previous = (previousSettings?.defaultTemplates ?? {}) as Record<string, unknown>;
  const removed: string[] = [];

  const cfg = parseTemplateDefaults(raw);
  const prev = parseTemplateDefaults(previous);
  /** 仅当该项在本次请求中未发生变化时才允许静默摘除 */
  const stale = (kind: TemplateKind, name: string | null, prevName: string | null) =>
    !!name && !sets[kind].has(name) && name === prevName;

  const next: CmsSiteTemplateDefaults = {};
  if (stale('list', cfg.list ?? null, prev.list ?? null)) {
    removed.push(`列表模板「${cfg.list}」`);
  } else if (cfg.list) {
    next.list = cfg.list;
  }
  if (stale('detail', cfg.detail ?? null, prev.detail ?? null)) {
    removed.push(`详情模板「${cfg.detail}」`);
  } else if (cfg.detail) {
    next.detail = cfg.detail;
  }

  const byModel: Record<string, string> = {};
  for (const [modelCode, name] of Object.entries(cfg.detailByModel ?? {})) {
    if (!name) continue; // 空值 = 跟随默认，不必落库
    if (stale('detail', name, (prev.detailByModel ?? {})[modelCode] ?? null)) {
      removed.push(`${modelCode} 详情模板「${name}」`);
    } else {
      byModel[modelCode] = name;
    }
  }
  if (Object.keys(byModel).length > 0) next.detailByModel = byModel;

  if (removed.length === 0) return { settings, removed: [] };
  return { settings: { ...settings, defaultTemplates: next }, removed };
}

/** 站点保存校验：settings.themeConfig 中 select 类型参数的值须在主题声明的选项内 */
export function assertSiteThemeConfig(themeCode: string, settings: Record<string, unknown> | null | undefined): void {
  if (!isThemeRegistered(themeCode)) return;
  const raw = settings?.themeConfig;
  if (!raw || typeof raw !== 'object') return;
  const config = raw as Record<string, unknown>;
  for (const field of getThemeSettingsSchema(themeCode)) {
    const rawValue = config[field.name];
    const isLinkField = field.fieldType === 'image' || field.name === 'serviceLinks' || /(?:url|link|logo|favicon|poster|image)$/i.test(field.name);
    if (rawValue !== undefined && rawValue !== null && rawValue !== '' && isLinkField) {
      if (typeof rawValue !== 'string') throw new HTTPException(400, { message: `主题参数「${field.label}」必须是文本` });
      if (field.fieldType === 'image' && !isValidCmsAssetUrl(rawValue)) {
        throw new HTTPException(400, { message: `主题参数「${field.label}」图片地址格式无效` });
      }
      if (field.name === 'serviceLinks') {
        for (const line of rawValue.split(/\r?\n/).filter(Boolean)) {
          const [, url] = line.split('|', 2);
          if (!url || !isDirectCmsHref(url.trim())) throw new HTTPException(400, { message: `主题参数「${field.label}」包含无效链接` });
        }
      } else if (field.fieldType !== 'image' && !isDirectCmsHref(rawValue)) {
        throw new HTTPException(400, { message: `主题参数「${field.label}」链接格式无效` });
      }
    }
    if (field.fieldType !== 'select') continue;
    const value = rawValue;
    if (value === undefined || value === null || value === '') continue;
    if (!(field.options ?? []).some((o) => o.value === value)) {
      const options = (field.options ?? []).map((o) => o.value).join('、');
      throw new HTTPException(400, { message: `主题参数「${field.label}」的值无效（可选：${options}）` });
    }
  }
}

/** 栏目保存校验：listTemplate / detailTemplate 中的模板名须存在于站点主题 */
export async function assertChannelTemplatesBySite(
  siteId: number,
  data: { listTemplate?: string | null; detailTemplate?: string | null },
): Promise<void> {
  if (!data.listTemplate && !data.detailTemplate) return;
  const theme = await getSiteTheme(siteId);
  const sets = await availableTemplateSets(theme, siteId);
  assertTemplateNameInSet(sets.list, theme, data.listTemplate, '列表模板');
  assertTemplateNameInSet(sets.detail, theme, data.detailTemplate, '详情模板');
}

/** 内容保存校验：detailTemplate 须存在于站点主题 */
export async function assertContentTemplateBySite(siteId: number, detailTemplate: string | null | undefined): Promise<void> {
  if (!detailTemplate) return;
  const theme = await getSiteTheme(siteId);
  const sets = await availableTemplateSets(theme, siteId);
  assertTemplateNameInSet(sets.detail, theme, detailTemplate, '详情模板');
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
    const cfg = parseTemplateDefaults(defaults);
    if (cfg.list && !available.list.has(cfg.list)) invalidRefs.push({ source: 'site', kind: 'list', template: cfg.list, location: '站点默认列表模板' });
    if (cfg.detail && !available.detail.has(cfg.detail)) invalidRefs.push({ source: 'site', kind: 'detail', template: cfg.detail, location: '站点默认详情模板' });
    for (const [modelCode, name] of Object.entries(cfg.detailByModel ?? {})) {
      if (name && !available.detail.has(name)) invalidRefs.push({ source: 'site', kind: 'detail', template: name, location: `站点默认 ${modelCode} 详情模板` });
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
