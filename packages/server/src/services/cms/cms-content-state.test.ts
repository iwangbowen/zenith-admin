import { describe, expect, it } from 'vitest';
import { canTransitionCmsContentStatus } from './cms-content-state';

describe('CMS content state machine', () => {
  it('allows only declared publish lifecycle transitions', () => {
    expect(canTransitionCmsContentStatus('draft', 'submit')).toBe(true);
    expect(canTransitionCmsContentStatus('pending', 'publish')).toBe(true);
    expect(canTransitionCmsContentStatus('published', 'offline')).toBe(true);
    expect(canTransitionCmsContentStatus('pending', 'reject')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransitionCmsContentStatus('published', 'publish')).toBe(false);
    expect(canTransitionCmsContentStatus('draft', 'offline')).toBe(false);
    expect(canTransitionCmsContentStatus('rejected', 'reject')).toBe(false);
  });
});
