import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ select: vi.fn(), access: vi.fn(), exists: vi.fn() }));
vi.mock('../../db', () => ({ db: { select: mocks.select } }));
vi.mock('./cms-sites.service', () => ({ assertSiteAccess: mocks.access, ensureCmsSiteExists: mocks.exists }));
vi.mock('./cms-channels.service', () => ({ assertAllCmsSiteChannelsAccess: vi.fn() }));
vi.mock('./cms-resource-folders.service', () => ({ ensureCmsResourceFolderExists: vi.fn() }));
vi.mock('./cms-resource-refs.service', () => ({ countCmsResourceRefs: vi.fn(), invalidateCmsResourceCache: vi.fn(), listCmsOrphanResourceIds: vi.fn(), listCmsResourceRefDetails: vi.fn() }));
vi.mock('./cms-image.service', () => ({ processCmsImageUpload: vi.fn() }));
vi.mock('./cms-design-versions.service', () => ({ ensureCmsAssetVersion: vi.fn() }));
vi.mock('./cms-asset-rights.service', () => ({ removeUnusedCmsAssetVersions: vi.fn() }));
vi.mock('../files/files.service', () => ({ uploadManagedFile: vi.fn(), deleteManagedFile: vi.fn(), readFileContent: vi.fn() }));
vi.mock('../../lib/sharp-loader', () => ({ sharp: vi.fn() }));

import { getCmsResourceSelection } from './cms-resources.service';

const resource = { id: 41, siteId: 3, folderId: null, type: 'audio', name: '声音.wav', url: '/latest.wav', thumbUrl: null,
  fileId: 'file-latest', size: 1000, width: null, height: null, mimeType: 'audio/wav', remark: null, ownsFile: true,
  createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-24') };
function returnRows(rows: unknown[]) {
  const query = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn().mockResolvedValue(rows) };
  for (const method of ['from', 'innerJoin', 'where', 'orderBy'] as const) query[method].mockReturnValue(query);
  mocks.select.mockReturnValueOnce(query);
}

beforeEach(() => { vi.clearAllMocks(); mocks.select.mockReset(); mocks.access.mockResolvedValue(undefined); mocks.exists.mockResolvedValue({ id: 3 }); });

describe('CMS 精确素材选择回显', () => {
  it('checks site access before exposing a resource name or binary URL', async () => {
    mocks.access.mockRejectedValueOnce(new Error('站点访问被拒绝'));
    await expect(getCmsResourceSelection({ siteId: 3, value: 'cms-res://41' })).rejects.toThrow('站点访问被拒绝');
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it('resolves a selected resource beyond any list page and reports missing identities as null', async () => {
    returnRows([resource]);
    expect(await getCmsResourceSelection({ siteId: 3, value: 'cms-res://41', type: 'audio' })).toMatchObject({ id: 41, name: '声音.wav', url: '/latest.wav' });
    returnRows([]);
    expect(await getCmsResourceSelection({ siteId: 3, value: 'cms-res://999', type: 'audio' })).toBeNull();
  });

  it('keeps the exact retained binary and media type after the resource was replaced', async () => {
    returnRows([]);
    returnRows([{ resource: { ...resource, type: 'video', url: '/latest.mp4', mimeType: 'video/mp4' },
      version: { url: '/retained.wav', thumbUrl: null, fileId: 'file-old', size: 800, width: null, height: null, mimeType: 'audio/wav' } }]);
    expect(await getCmsResourceSelection({ siteId: 3, value: '/retained.wav', type: 'audio' })).toMatchObject({ id: 41, type: 'audio', url: '/retained.wav', fileId: 'file-old', size: 800 });
  });

  it('returns null for an unregistered URL without trying to download it', async () => {
    returnRows([]); returnRows([]);
    expect(await getCmsResourceSelection({ siteId: 3, value: 'https://external.example/audio.mp3' })).toBeNull();
  });
});
