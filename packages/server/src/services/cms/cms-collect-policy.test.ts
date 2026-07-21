import { describe, expect, it, vi } from 'vitest';
import { requireCmsCollectPublishPermission } from './cms-collect-policy';

describe('CMS collection auto-publish policy', () => {
  it('denies autoPublish when collector lacks cms:content:publish', async () => {
    const check = vi.fn().mockResolvedValue(false);
    await expect(requireCmsCollectPublishPermission(true, check)).rejects.toMatchObject({ status: 403 });
    expect(check).toHaveBeenCalledOnce();
  });

  it('allows draft collection without publish permission', async () => {
    const check = vi.fn().mockResolvedValue(false);
    await expect(requireCmsCollectPublishPermission(false, check)).resolves.toBeUndefined();
    expect(check).not.toHaveBeenCalled();
  });
});
