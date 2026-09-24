import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';

const mocked = vi.hoisted(() => ({ version: vi.fn(), rows: [] as { id: number }[] }));
vi.mock('./cms-design-versions.service', () => ({ ensureCmsAssetVersion: mocked.version }));
vi.mock('./cms-resource-refs.service', () => ({ CMS_RESOURCE_OWNER_FIELDS: { content: ['coverImage', 'body', 'mediaData', 'extend', 'attachments'] } }));
import { refreshCmsContentResourcePins } from './cms-content-resource-selection';

const select = vi.fn(() => ({ from: () => ({ where: async () => mocked.rows }) }));
const tx = { select } as unknown as DbTransaction;
beforeEach(() => { vi.clearAllMocks(); mocked.rows = [{ id: 2 }]; mocked.version.mockResolvedValue({ id: 22 }); });

describe('explicit CMS asset revision refresh', () => {
  it('preserves pins and avoids querying latest versions for an ordinary autosave', async () => {
    const pins = { 1: 11, 2: 12 };
    expect(await refreshCmsContentResourcePins(tx, 3, pins, { mediaData: { mediaUrl: 'cms-res://2' } })).toBe(pins);
    expect(mocked.version).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
  it('pins only the explicitly reselected resource, leaving other frozen media intact', async () => {
    const pins = { 1: 11, 2: 12 };
    expect(await refreshCmsContentResourcePins(tx, 3, pins, { coverImage: 'cms-res://1', mediaData: { mediaUrl: 'cms-res://2' } }, [2])).toEqual({ 1: 11, 2: 22 });
    expect(pins).toEqual({ 1: 11, 2: 12 });
    expect(mocked.version).toHaveBeenCalledWith(tx, 2, 3);
  });
  it('rejects refresh without a matching saved reference or outside the site', async () => {
    await expect(refreshCmsContentResourcePins(tx, 3, {}, { assetVersions: { 2: 12 }, title: 'cms-res://2' }, [2])).rejects.toThrow('本次保存字段');
    mocked.rows = [];
    await expect(refreshCmsContentResourcePins(tx, 3, {}, { coverImage: 'cms-res://2' }, [2])).rejects.toThrow('不属于本站');
    expect(mocked.version).not.toHaveBeenCalled();
  });
});
