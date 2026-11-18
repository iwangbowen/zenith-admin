import { describe, expect, it } from 'vitest';
import { canViewApprovalStatistics } from './statistics';

describe('mobile workflow statistics capability', () => {
  it('requires workflow monitoring or the wildcard permission', () => {
    expect(canViewApprovalStatistics(['*'])).toBe(true);
    expect(canViewApprovalStatistics(['workflow:instance:monitor'])).toBe(true);
    for (const permissions of [undefined, [], ['workflow:instance:list'], ['workflow:task:handle'], ['system:user:list']]) {
      expect(canViewApprovalStatistics(permissions)).toBe(false);
    }
  });
});
