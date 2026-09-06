import { describe, expect, it } from 'vitest';
import { DATA_SCOPE_PRIORITY, mostPermissiveDataScope } from './data-scope';

describe('mostPermissiveDataScope', () => {
  it('按 all > dept > dept_only > custom > self 取最宽松者', () => {
    expect(mostPermissiveDataScope(['self', 'dept_only', 'custom'])).toBe('dept_only');
    expect(mostPermissiveDataScope(['dept', 'all', 'self'])).toBe('all');
    expect(mostPermissiveDataScope(['custom', 'self'])).toBe('custom');
  });

  it('忽略 null / undefined；全部为空返回 null', () => {
    expect(mostPermissiveDataScope([null, 'self', undefined])).toBe('self');
    expect(mostPermissiveDataScope([null, undefined])).toBeNull();
    expect(mostPermissiveDataScope([])).toBeNull();
  });

  it('相同优先级保留先出现者；未知取值按 0 处理', () => {
    expect(mostPermissiveDataScope(['dept', 'dept'])).toBe('dept');
    expect(mostPermissiveDataScope(['unknown', 'self'])).toBe('self');
    expect(mostPermissiveDataScope(['unknown'])).toBe('unknown');
  });

  it('优先级表覆盖全部范围值', () => {
    expect(Object.keys(DATA_SCOPE_PRIORITY).sort()).toEqual(['all', 'custom', 'dept', 'dept_only', 'self']);
  });
});
