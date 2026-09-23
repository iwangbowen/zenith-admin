import { describe, expect, it } from 'vitest';
import { cmsEditorialStatusAfterPublication } from './content-revision';

describe('editorial consistency after publication', () => {
  it('marks a retained newer working copy as draft when delivery rolls back', () => {
    expect(cmsEditorialStatusAfterPublication('clean', false)).toBe('draft');
  });
  it('keeps active review and decision states when another revision is delivered', () => {
    for (const state of ['draft', 'pending', 'rejected', 'approved'] as const) expect(cmsEditorialStatusAfterPublication(state, false)).toBe(state);
  });
  it('recognizes the exact matching publication', () => {
    expect(cmsEditorialStatusAfterPublication('approved', true)).toBe('clean');
  });
});
