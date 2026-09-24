import { describe, expect, it } from 'vitest';
import { canTransitionCmsFeedback, createCmsEditorialTaskSchema, updateCmsFeedbackSchema } from './operations-validation';

describe('CMS reader feedback contracts', () => {
  it('requires evidence identity to match the editorial source', () => {
    expect(createCmsEditorialTaskSchema.safeParse({ siteId: 1, title: '任务', source: 'search' }).success).toBe(false);
    expect(createCmsEditorialTaskSchema.safeParse({ siteId: 1, title: '任务', source: 'submission', sourceKeyword: '价格表', feedbackId: 2 }).success).toBe(false);
    expect(createCmsEditorialTaskSchema.safeParse({ siteId: 1, title: '任务', source: 'manual', feedbackId: 2 }).success).toBe(false);
    expect(createCmsEditorialTaskSchema.safeParse({ siteId: 1, title: '任务', source: 'search', sourceKeyword: '价格表' }).success).toBe(true);
  });
  it('requires a meaningful change and a positive compare-and-swap version', () => {
    expect(updateCmsFeedbackSchema.safeParse({ expectedVersion: 1, note: '  ' }).success).toBe(false);
    expect(updateCmsFeedbackSchema.safeParse({ expectedVersion: 0, note: '受理' }).success).toBe(false);
    expect(updateCmsFeedbackSchema.safeParse({ expectedVersion: 2, ownerId: null }).success).toBe(true);
  });
  it('requires processing before resolution and explicit reopening after closure', () => {
    expect(canTransitionCmsFeedback('new', 'resolved')).toBe(false);
    expect(canTransitionCmsFeedback('new', 'processing')).toBe(true);
    expect(canTransitionCmsFeedback('processing', 'resolved')).toBe(true);
    expect(canTransitionCmsFeedback('closed', 'resolved')).toBe(false);
    expect(canTransitionCmsFeedback('closed', 'processing')).toBe(true);
  });
});
