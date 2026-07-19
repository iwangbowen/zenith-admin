import type { ComponentType } from 'react';
import type { CmsTheme, CmsListContext, CmsDetailContext } from './types';
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

export function getTheme(code: string): CmsTheme {
  return themes.get(code) ?? defaultTheme;
}

export function listThemes(): { code: string; label: string }[] {
  return [...themes.values()].map((t) => ({ code: t.code, label: t.label }));
}

export function resolveListTemplate(theme: CmsTheme, name: string | null | undefined): ComponentType<CmsListContext> {
  if (name && theme.extraListTemplates?.[name]) return theme.extraListTemplates[name];
  return theme.templates.list;
}

export function resolveDetailTemplate(theme: CmsTheme, name: string | null | undefined): ComponentType<CmsDetailContext> {
  if (name && theme.extraDetailTemplates?.[name]) return theme.extraDetailTemplates[name];
  return theme.templates.detail;
}

export function resolveCustomPageTemplate(theme: CmsTheme) {
  return theme.customPage ?? defaultTheme.customPage!;
}
