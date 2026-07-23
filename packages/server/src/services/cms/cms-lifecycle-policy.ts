export function cmsThemeLifecycleEventKey(siteId: number, revision: number): string {
  return `theme:${siteId}:revision:${revision}`;
}

export function cmsTemplateLifecycleEventKey(templateId: number, revision: number, siteId: number): string {
  return `template:${templateId}:revision:${revision}:site:${siteId}`;
}

export function isManualTemplateLifecycleAllowed(source: 'manual' | 'package'): boolean {
  return source === 'manual';
}

export function isCurrentCmsThemeDeployment(input: {
  siteTheme: string;
  requestedThemeCode: string;
  requestedPackageId: number;
  packageCode: string;
  activeDeployment: { themeCode: string; themePackageId: number } | null;
}): boolean {
  return input.siteTheme === input.requestedThemeCode
    && input.packageCode === input.requestedThemeCode
    && input.activeDeployment?.themeCode === input.requestedThemeCode
    && input.activeDeployment.themePackageId === input.requestedPackageId;
}
