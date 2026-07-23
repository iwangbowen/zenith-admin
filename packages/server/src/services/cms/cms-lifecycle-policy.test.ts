import { describe, expect, it } from 'vitest';
import {
  cmsTemplateLifecycleEventKey,
  cmsThemeLifecycleEventKey,
  isCurrentCmsThemeDeployment,
  isManualTemplateLifecycleAllowed,
} from './cms-lifecycle-policy';

describe('CMS lifecycle policy', () => {
  it('creates one idempotency key per revision while preserving every lifecycle transition', () => {
    const keys = [
      cmsThemeLifecycleEventKey(7, 1),
      cmsThemeLifecycleEventKey(7, 2),
      cmsThemeLifecycleEventKey(7, 3),
    ];
    expect(new Set(keys).size).toBe(3);
    expect(cmsThemeLifecycleEventKey(7, 2)).toBe(keys[1]);
    expect(cmsTemplateLifecycleEventKey(9, 2, 7)).toBe('template:9:revision:2:site:7');
  });

  it('allows template lifecycle actions only for manually managed templates', () => {
    expect(isManualTemplateLifecycleAllowed('manual')).toBe(true);
    expect(isManualTemplateLifecycleAllowed('package')).toBe(false);
  });

  it('accepts deactivation only for the exact site, code and package deployment tuple', () => {
    const current = {
      siteTheme: 'docs',
      requestedThemeCode: 'docs',
      requestedPackageId: 12,
      packageCode: 'docs',
      activeDeployment: { themeCode: 'docs', themePackageId: 12 },
    };
    expect(isCurrentCmsThemeDeployment(current)).toBe(true);
    expect(isCurrentCmsThemeDeployment({ ...current, requestedPackageId: 13 })).toBe(false);
    expect(isCurrentCmsThemeDeployment({ ...current, activeDeployment: null })).toBe(false);
    expect(isCurrentCmsThemeDeployment({ ...current, siteTheme: 'default' })).toBe(false);
  });
});
