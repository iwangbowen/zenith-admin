import { describe, expect, it } from 'vitest';
import { reportCommentListQuerySchema, reportVersionDiffQuerySchema } from './validation';

describe('report query contracts', () => {
  it('coerces URL pagination values for comments', () => {
    expect(reportCommentListQuerySchema.parse({ page: '2', pageSize: '20' })).toMatchObject({ page: 2, pageSize: 20 });
  });

  it('coerces version diff query values from URL strings', () => {
    expect(reportVersionDiffQuerySchema.parse({ left: '0', right: '3' })).toEqual({ left: 0, right: 3 });
  });
});
