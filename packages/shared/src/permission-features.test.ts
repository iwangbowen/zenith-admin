import { describe, expect, it } from 'vitest';
import { isPageReadPermission, permissionFeatureKeys, permissionPageBindings } from './permission-features';

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

  it('keeps every page binding for shared permissions', () => {
    const bindings = permissionPageBindings('cms:site:list');
    expect(bindings.length).toBeGreaterThan(1);
    expect(bindings.map((binding) => binding.title)).toEqual(expect.arrayContaining(['站点管理', '访问统计', '数据看板', '内容工作台']));
  });
});
