import type { ComponentType } from 'react';
import logger from '../../lib/logger';
import type { CmsTheme, CmsListContext, CmsDetailContext, CmsTemplateVariant } from './types';
import { defaultTheme } from './default';
import { docsTheme } from './docs';

/**
 * 主题注册表：新增主题时在 themes/{code}/ 下实现 CmsTheme 接口并在此登记。
 * 站点通过 cms_sites.theme 选择主题；栏目可用 listTemplate/detailTemplate 引用主题扩展模板。
 */
const themes = new Map<string, CmsTheme>([
  [defaultTheme.code, defaultTheme],
  [docsTheme.code, docsTheme],
]);

// 回退告警去重（同一失效引用只记一次，避免高频渲染刷日志）
const warnedFallbacks = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedFallbacks.has(key)) return;
  warnedFallbacks.add(key);
  logger.warn(message);
}

export function getTheme(code: string): CmsTheme {
  const theme = themes.get(code);
  if (!theme) {
    warnOnce(`theme:${code}`, `[CMS] 主题 "${code}" 未在注册表登记，已回退 "${defaultTheme.code}" 主题`);
    return defaultTheme;
  }
  return theme;
}

export function listThemes(): { code: string; label: string }[] {
  return [...themes.values()].map((t) => ({ code: t.code, label: t.label }));
}

/** 主题是否已注册（未注册的主题 code 渲染时回退 default） */
export function isThemeRegistered(code: string): boolean {
  return themes.has(code);
}

/**
 * 模板名是否在主题中存在（写入校验/健康检查共用）。
 * 与运行时行为一致：未注册主题按 getTheme 的回退结果（default 主题）判定。
 */
export function isTemplateRegistered(themeCode: string, kind: 'list' | 'detail', name: string): boolean {
  const theme = getTheme(themeCode);
  const variants = kind === 'list' ? theme.extraListTemplates : theme.extraDetailTemplates;
  return Boolean(variants?.[name]);
}

export function resolveListTemplate(theme: CmsTheme, name: string | null | undefined): ComponentType<CmsListContext> {
  if (name) {
    const variant = theme.extraListTemplates?.[name];
    if (variant) return variant.component;
    warnOnce(`${theme.code}:list:${name}`, `[CMS] 列表模板 "${name}" 在主题 "${theme.code}" 中不存在，已回退主题默认模板`);
  }
  return theme.templates.list;
}

export function resolveDetailTemplate(theme: CmsTheme, name: string | null | undefined): ComponentType<CmsDetailContext> {
  if (name) {
    const variant = theme.extraDetailTemplates?.[name];
    if (variant) return variant.component;
    warnOnce(`${theme.code}:detail:${name}`, `[CMS] 详情模板 "${name}" 在主题 "${theme.code}" 中不存在，已回退主题默认模板`);
  }
  return theme.templates.detail;
}

export function resolveCustomPageTemplate(theme: CmsTheme) {
  return theme.customPage ?? defaultTheme.customPage!;
}

export function resolveSurveyTemplate(theme: CmsTheme) {
  return theme.survey ?? defaultTheme.survey!;
}

/** 主题可选模板清单（后台站点/栏目/内容模板下拉用）；default 项代表主题默认模板 */
export function listThemeTemplates(code: string): {
  list: { name: string; label: string }[];
  detail: { name: string; label: string }[];
} {
  const theme = getTheme(code);
  const toOptions = (variants?: Record<string, CmsTemplateVariant<never>>) =>
    Object.entries(variants ?? {}).map(([name, v]) => ({ name, label: v.label }));
  return {
    list: toOptions(theme.extraListTemplates as Record<string, CmsTemplateVariant<never>> | undefined),
    detail: toOptions(theme.extraDetailTemplates as Record<string, CmsTemplateVariant<never>> | undefined),
  };
}
