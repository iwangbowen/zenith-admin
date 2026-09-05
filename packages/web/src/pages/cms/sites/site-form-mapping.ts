/**
 * 站点编辑表单 ⇄ settings JSONB 的映射纯函数（从 SitesPage 抽出）。
 *
 * 这是站点模块最易静默出错的区域：40+ 表单字段中有一半持久化在 settings JSONB，
 * 键名手写、无 schema 约束，任何键名笔误都会悄悄丢配置。抽成纯函数后由
 * site-form-mapping.test.ts 的往返测试锁定行为。
 */
import { CMS_SITE_OPS_DEFAULTS } from '@zenith/shared/cms';
import type { CmsSite, CmsSiteTemplateDefaults, CreateCmsSiteInput } from '@zenith/shared/cms';
import { cmsCredentialWriteValue } from '../cms-site-credentials';

export interface TemplateDefaultsState {
  list: string | null;
  detail: string | null;
  detailByModel: Record<string, string | null>;
}

export const EMPTY_TEMPLATE_DEFAULTS: TemplateDefaultsState = { list: null, detail: null, detailByModel: {} };

export function templateDefaultsFromSettings(settings: Record<string, unknown> | null | undefined): TemplateDefaultsState {
  const cfg = (settings?.defaultTemplates ?? {}) as CmsSiteTemplateDefaults;
  return {
    list: cfg.list ?? null,
    detail: cfg.detail ?? null,
    detailByModel: { ...(cfg.detailByModel ?? {}) },
  };
}

/** 序列化为 settings.defaultTemplates（去掉空值，保持 JSONB 干净） */
export function templateDefaultsToSettings(state: TemplateDefaultsState): CmsSiteTemplateDefaults {
  const detailByModel = Object.fromEntries(Object.entries(state.detailByModel).filter(([, v]) => v));
  return {
    ...(state.list ? { list: state.list } : {}),
    ...(state.detail ? { detail: state.detail } : {}),
    ...(Object.keys(detailByModel).length > 0 ? { detailByModel } : {}),
  };
}

/** settings.langLinks → 每行 `语言代码=站点标识` 文本（表单编辑态） */
export function langLinksToText(v: unknown): string {
  if (!Array.isArray(v)) return '';
  return v
    .map((l) => {
      const o = l as { language?: unknown; siteCode?: unknown };
      return typeof o.language === 'string' && typeof o.siteCode === 'string' ? `${o.language}=${o.siteCode}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

/** 每行 `语言代码=站点标识` 文本 → settings.langLinks */
export function parseLangLinks(text: string): { language: string; siteCode: string }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf('=');
      if (i <= 0) return null;
      const language = line.slice(0, i).trim();
      const siteCode = line.slice(i + 1).trim();
      return language && siteCode ? { language, siteCode } : null;
    })
    .filter((x): x is { language: string; siteCode: string } => !!x);
}

/** settings 中的内容策略 → 表单初值（缺项回落 CMS_SITE_OPS_DEFAULTS，与服务端解析规则一致） */
export function resolveSiteOpsFormValues(settings: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const s = settings ?? {};
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const int = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    publishedContentEditable: bool(s.publishedContentEditable, CMS_SITE_OPS_DEFAULTS.publishedContentEditable),
    recycleKeepDays: int(s.recycleKeepDays, CMS_SITE_OPS_DEFAULTS.recycleKeepDays),
    maxPageOnContentPublish: int(s.maxPageOnContentPublish, CMS_SITE_OPS_DEFAULTS.maxPageOnContentPublish),
    autoReplaceSensitiveWords: bool(s.autoReplaceSensitiveWords, CMS_SITE_OPS_DEFAULTS.autoReplaceSensitiveWords),
    autoReplaceErrorProneWords: bool(s.autoReplaceErrorProneWords, CMS_SITE_OPS_DEFAULTS.autoReplaceErrorProneWords),
    autoCoverFromBody: bool(s.autoCoverFromBody, CMS_SITE_OPS_DEFAULTS.autoCoverFromBody),
    openApiPublishEnabled: bool(s.openApiPublishEnabled, CMS_SITE_OPS_DEFAULTS.openApiPublishEnabled),
  };
}

/** 主题参数编辑态 → settings.themeConfig（剔除空值，保持 JSONB 干净） */
export function cleanThemeConfig(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

/** 新建站点时的表单默认值 */
export const SITE_FORM_CREATE_DEFAULTS: Record<string, unknown> = {
  parentId: null, theme: 'default', staticMode: 'hybrid', status: 'enabled', isDefault: false, aliasDomains: [],
  themeDark: 'light', imageMaxWidth: 1600, watermarkEnabled: false, watermarkPosition: 'southeast',
  watermarkOpacity: 45, thumbEnabled: false, thumbWidth: 400, auditMode: 'simple',
  ...CMS_SITE_OPS_DEFAULTS,
};

/** 编辑站点时的表单初值（settings JSONB → 平铺表单字段） */
export function buildSiteFormInitValues(record: CmsSite): Record<string, unknown> {
  const s = (record.settings ?? {}) as Record<string, unknown>;
  return {
    name: record.name,
    code: record.code,
    theme: record.theme,
    domain: record.domain ?? '',
    aliasDomains: record.aliasDomains,
    isDefault: record.isDefault,
    staticMode: record.staticMode,
    status: record.status,
    title: record.title ?? '',
    keywords: record.keywords ?? '',
    description: record.description ?? '',
    icp: record.icp ?? '',
    copyright: record.copyright ?? '',
    robots: record.robots ?? '',
    remark: record.remark ?? '',
    baiduPushToken: String(s.baiduPushToken ?? ''),
    indexNowKey: String(s.indexNowKey ?? ''),
    clearIndexNowKey: false,
    twitterSite: String(s.twitterSite ?? ''),
    twitterCard: String(s.twitterCard ?? 'summary_large_image'),
    socialImageAlt: String(s.socialImageAlt ?? ''),
    themePrimary: String(s.themePrimary ?? ''),
    themeDark: String(s.themeDark ?? 'light'),
    auditMode: String(s.auditMode ?? 'simple'),
    auditWorkflowDefinitionId: s.auditWorkflowDefinitionId as number | undefined,
    imageMaxWidth: Number(s.imageMaxWidth ?? 1600),
    watermarkEnabled: s.watermarkEnabled === true,
    watermarkText: String(s.watermarkText ?? ''),
    watermarkPosition: String(s.watermarkPosition ?? 'southeast'),
    watermarkOpacity: Number(s.watermarkOpacity ?? 45),
    thumbEnabled: s.thumbEnabled === true,
    thumbWidth: Number(s.thumbWidth ?? 400),
    webhookUrl: String(s.webhookUrl ?? ''),
    webhookSecret: String(s.webhookSecret ?? ''),
    clearWebhookSecret: false,
    captchaEnabled: s.captchaEnabled === true,
    cdnPurgeUrl: String(s.cdnPurgeUrl ?? ''),
    cdnPurgeToken: String(s.cdnPurgeToken ?? ''),
    clearCdnPurgeToken: false,
    clearBaiduPushToken: false,
    language: String(s.language ?? ''),
    langLinksText: langLinksToText(s.langLinks),
    ...resolveSiteOpsFormValues(s),
    modelId: record.modelId ?? undefined,
    extend: record.extend ?? {},
  };
}

interface BuildSavePayloadArgs {
  /** formApi.validate() 通过后的表单值 */
  values: Record<string, unknown>;
  /** 编辑中的站点；null = 新建 */
  editingRecord: CmsSite | null;
  /** 默认模板配置编辑态（不走 Form 的受控 state） */
  templateDefaults: TemplateDefaultsState;
  /** 主题参数编辑态（settings.themeConfig） */
  themeConfig: Record<string, unknown>;
}

export interface SiteSavePayloadResult {
  /** 提交给保存接口的 payload（settings 已重组）；表单值经重组后按契约入参形状提交 */
  payload: Partial<CreateCmsSiteInput>;
  /** 主题参数是否变化（编辑态 + 非纯动态站点时提示重新生成静态页） */
  themeConfigChanged: boolean;
  /** 主题本身是否切换（编辑态；与 themeConfigChanged 一起决定静态页重建提示） */
  themeChanged: boolean;
}

/**
 * 表单值 → 保存 payload：settings 相关字段并入 settings JSONB
 * （保留既有 settings 键；剔除已下线的 h5 旧键）。
 *
 * theme 新建/编辑都写入 payload；编辑态切换主题时通过 themeChanged
 * 告知调用方提示重新生成静态页。
 */
export function buildSiteSavePayload({ values, editingRecord, templateDefaults, themeConfig }: BuildSavePayloadArgs): SiteSavePayloadResult {
  const merged = { ...values };
  if (!merged.domain) merged.domain = null;
  const {
    baiduPushToken, indexNowKey, clearIndexNowKey, twitterSite, twitterCard, socialImageAlt, themePrimary, themeDark,
    imageMaxWidth, watermarkEnabled, watermarkText, watermarkPosition, watermarkOpacity, thumbEnabled, thumbWidth,
    auditMode, auditWorkflowDefinitionId,
    webhookUrl, webhookSecret, clearWebhookSecret, captchaEnabled,
    cdnPurgeUrl, cdnPurgeToken, clearCdnPurgeToken, clearBaiduPushToken, language, langLinksText,
    publishedContentEditable, recycleKeepDays, maxPageOnContentPublish,
    autoReplaceSensitiveWords, autoReplaceErrorProneWords, autoCoverFromBody,
    openApiPublishEnabled,
    theme: requestedTheme,
    ...rest
  } = merged;
  rest.theme = requestedTheme ?? editingRecord?.theme ?? 'default';
  // Clearable model Selects emit undefined; make the detach operation explicit
  // so JSON serialization cannot silently preserve the previous binding.
  rest.modelId = values.modelId == null || values.modelId === '' ? null : Number(values.modelId);
  const themeChanged = editingRecord !== null && rest.theme !== editingRecord.theme;
  const { h5Enabled: _legacyH5Enabled, h5Domain: _legacyH5Domain, ...prevSettings } = (editingRecord?.settings ?? {}) as Record<string, unknown>;
  rest.settings = {
    ...prevSettings,
    baiduPushToken: cmsCredentialWriteValue(baiduPushToken, clearBaiduPushToken),
    indexNowKey: cmsCredentialWriteValue(indexNowKey, clearIndexNowKey),
    twitterSite: String(twitterSite ?? '').trim(),
    twitterCard: twitterCard === 'summary' ? 'summary' : 'summary_large_image',
    socialImageAlt: String(socialImageAlt ?? '').trim(),
    themePrimary: String(themePrimary ?? '').trim(),
    themeDark: themeDark ?? 'light',
    imageMaxWidth: Number(imageMaxWidth ?? 1600),
    watermarkEnabled: watermarkEnabled === true,
    watermarkText: String(watermarkText ?? '').trim(),
    watermarkPosition: watermarkPosition ?? 'southeast',
    watermarkOpacity: Number(watermarkOpacity ?? 45),
    thumbEnabled: thumbEnabled === true,
    thumbWidth: Number(thumbWidth ?? 400),
    auditMode: auditMode ?? 'simple',
    auditWorkflowDefinitionId: auditWorkflowDefinitionId ?? null,
    webhookUrl: String(webhookUrl ?? '').trim(),
    webhookSecret: cmsCredentialWriteValue(webhookSecret, clearWebhookSecret),
    captchaEnabled: captchaEnabled === true,
    cdnPurgeUrl: String(cdnPurgeUrl ?? '').trim(),
    cdnPurgeToken: cmsCredentialWriteValue(cdnPurgeToken, clearCdnPurgeToken),
    language: String(language ?? '').trim(),
    langLinks: parseLangLinks(String(langLinksText ?? '')),
    defaultTemplates: templateDefaultsToSettings(templateDefaults),
    themeConfig: cleanThemeConfig(themeConfig),
    // 内容策略
    publishedContentEditable: publishedContentEditable !== false,
    recycleKeepDays: Number(recycleKeepDays ?? CMS_SITE_OPS_DEFAULTS.recycleKeepDays),
    maxPageOnContentPublish: Number(maxPageOnContentPublish ?? CMS_SITE_OPS_DEFAULTS.maxPageOnContentPublish),
    autoReplaceSensitiveWords: autoReplaceSensitiveWords === true,
    autoReplaceErrorProneWords: autoReplaceErrorProneWords === true,
    autoCoverFromBody: autoCoverFromBody === true,
    openApiPublishEnabled: openApiPublishEnabled === true,
  };
  // 主题参数变更 + 非纯动态站点 → 保存后提示重新生成静态页
  const prevThemeConfig = JSON.stringify(cleanThemeConfig((prevSettings.themeConfig as Record<string, unknown>) ?? {}));
  const themeConfigChanged = editingRecord !== null && prevThemeConfig !== JSON.stringify(cleanThemeConfig(themeConfig));
  return { payload: rest as Partial<CreateCmsSiteInput>, themeConfigChanged, themeChanged };
}
