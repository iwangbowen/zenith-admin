import { describe, expect, it } from 'vitest';
import { cmsStaticTargetKey, isCmsStaticTargetCompleted } from './cms-static-build-plan';

describe('CMS static build stable checkpoint keys', () => {
  it('orders phases and ids deterministically and resumes even when the exact previous target was deleted', () => {
    const channel1 = cmsStaticTargetKey('pc', 1, 1);
    const channel9 = cmsStaticTargetKey('pc', 1, 9);
    const content1 = cmsStaticTargetKey('pc', 2, 1);
    expect(channel1 < channel9).toBe(true);
    expect(channel9 < content1).toBe(true);
    expect(isCmsStaticTargetCompleted(channel1, cmsStaticTargetKey('pc', 1, 5))).toBe(true);
    expect(isCmsStaticTargetCompleted(channel9, cmsStaticTargetKey('pc', 1, 5))).toBe(false);
  });
});
