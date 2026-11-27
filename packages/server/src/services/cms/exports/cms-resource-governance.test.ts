import { describe, expect, it, vi } from 'vitest';

vi.mock('../cms-sites.service', () => ({
  assertSiteAccess: vi.fn(),
}));

import { assertSiteAccess } from '../cms-sites.service';
import { cmsResourceGovernanceExportDefinition } from './cms-resource-governance';

describe('CMS governance export task access', () => {
  it('rejects an inaccessible site before querying or counting task rows', async () => {
    const user = { userId: 42, username: 'editor', roles: [], tenantId: 7 };
    vi.mocked(assertSiteAccess).mockRejectedValueOnce(new Error('site denied'));
    await expect(cmsResourceGovernanceExportDefinition.countRows({ siteId: 13 }, user)).rejects.toThrow('site denied');
    expect(assertSiteAccess).toHaveBeenCalledWith(13);
  });
});
