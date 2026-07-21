import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('CMS admin/member route authentication boundary', () => {
  it('keeps member CMS routes on memberAuthMiddleware only', async () => {
    const source = await readFile(new URL('../../routes/member/member-cms.ts', import.meta.url), 'utf8');
    expect(source).toContain('memberAuthMiddleware');
    expect(source).not.toMatch(/\bauthMiddleware\b/);
  });

  it('keeps admin CMS content routes on authMiddleware and guards', async () => {
    const source = await readFile(new URL('../../routes/cms/contents.ts', import.meta.url), 'utf8');
    expect(source).toContain('authMiddleware');
    expect(source).toContain("cms:content:publish");
    expect(source).not.toContain('memberAuthMiddleware');
  });
});
