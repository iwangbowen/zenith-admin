import { describe, expect, it } from 'vitest';
import { isPageReadPermission, permissionFeatureKeys } from './permission-features';

describe('permission feature registry', () => {
  it('maps operation permissions through their bound pages', () => {
    expect(permissionFeatureKeys('system:process:view')).toEqual(new Set(['ops']));
    expect(permissionFeatureKeys('cms:site:list')).toEqual(new Set(['cms']));
  });

  it('treats page-less API permissions as core capabilities', () => {
    expect(permissionFeatureKeys('system:login-risk:list')).toEqual(new Set([null]));
  });

  it('classifies only generated page permissions as page reads', () => {
    expect(isPageReadPermission('system:user:list')).toBe(true);
    expect(isPageReadPermission('system:user:create')).toBe(false);
  });
});
