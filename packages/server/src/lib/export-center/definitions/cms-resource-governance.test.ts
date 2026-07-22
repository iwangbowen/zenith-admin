import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/context', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../lib/context')>(),
  currentUser: vi.fn(() => ({ userId: 42, username: 'editor', roles: [], tenantId: null })),
  hasPermission: vi.fn(async () => false),
}));

import { hasPermission } from '../../../lib/context';
import { resolveAsyncTaskAccessScope } from '../../../services/tasks/async-tasks.service';

describe('CMS governance export task access', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes ordinary users to their own task rows', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    await expect(resolveAsyncTaskAccessScope()).resolves.toEqual({ userId: 42, global: false });
    const source = await readFile(new URL('./cms-resource-governance.ts', import.meta.url), 'utf8');
    expect(source).toContain('eq(asyncTasks.createdBy, access.userId)');
    expect(source).toContain('else await assertSiteAccess(siteId)');
  });

  it('allows global export only with system:async-task:list', async () => {
    vi.mocked(hasPermission).mockResolvedValue(true);
    await expect(resolveAsyncTaskAccessScope()).resolves.toEqual({ userId: 42, global: true });
    expect(hasPermission).toHaveBeenCalledWith('system:async-task:list');
    const source = await readFile(new URL('./cms-resource-governance.ts', import.meta.url), 'utf8');
    expect(source).toContain('if (access.global) await ensureCmsSiteExists(siteId)');
  });
});
