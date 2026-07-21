import { describe, expect, it, vi } from 'vitest';
import {
  CMS_IMPORTED_CONTENT_LIFECYCLE,
  requireCmsScheduledAtMutationPermission,
} from './cms-publish-permission';

describe('CMS scheduled publication permission policy', () => {
  it('rejects setting a schedule without publish permission', async () => {
    const check = vi.fn().mockResolvedValue(false);
    await expect(requireCmsScheduledAtMutationPermission({
      current: null,
      requested: new Date('2026-08-01T10:00:00Z'),
    }, check)).rejects.toMatchObject({ status: 403 });
    expect(check).toHaveBeenCalledOnce();
  });

  it('rejects modifying or clearing an existing schedule without publish permission', async () => {
    const check = vi.fn().mockResolvedValue(false);
    const current = new Date('2026-08-01T10:00:00Z');
    await expect(requireCmsScheduledAtMutationPermission({
      current,
      requested: new Date('2026-08-02T10:00:00Z'),
    }, check)).rejects.toMatchObject({ status: 403 });
    await expect(requireCmsScheduledAtMutationPermission({
      current,
      requested: null,
    }, check)).rejects.toMatchObject({ status: 403 });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('allows ordinary draft create/update when the schedule stays empty', async () => {
    const check = vi.fn().mockResolvedValue(false);
    await expect(requireCmsScheduledAtMutationPermission({
      current: null,
      requested: null,
    }, check)).resolves.toBeUndefined();
    await expect(requireCmsScheduledAtMutationPermission({
      current: null,
      requested: undefined,
    }, check)).resolves.toBeUndefined();
    expect(check).not.toHaveBeenCalled();
  });

  it('downgrades every imported content lifecycle to an unscheduled draft', () => {
    expect(CMS_IMPORTED_CONTENT_LIFECYCLE).toEqual({
      status: 'draft',
      publishedAt: null,
      scheduledAt: null,
      archivedAt: null,
    });
  });
});
