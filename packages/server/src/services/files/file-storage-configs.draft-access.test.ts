import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  info: {
    bucketAcl: 'public-read',
    blockPublicAccess: false,
    policyPublic: false,
    publicStatus: null,
    effectivePublic: true,
    checkedAt: new Date('2026-11-20T00:00:00.000Z'),
  },
}));

vi.mock('../../db', () => ({ db: {} }));
vi.mock('../../lib/list-query', () => ({ listRows: vi.fn() }));
vi.mock('../../lib/db-assert', () => ({ requireRow: vi.fn() }));
vi.mock('../../lib/default-flag', () => ({ clearDefaultFlag: vi.fn() }));
vi.mock('../../lib/file-storage', () => ({
  getBucketAccessInfo: vi.fn(async () => state.info),
  setBucketAccessInfo: vi.fn(async (_config: unknown, _input: unknown) => state.info),
  uploadObjectByConfig: vi.fn(),
  deleteObjectByConfig: vi.fn(),
}));

import { FILE_BUCKET_ACCESS_SUPPORT } from '@zenith/shared/platform';
import { getBucketAccessInfo, setBucketAccessInfo } from '../../lib/file-storage';
import {
  probeDraftFileStorageConfigBucketAccess,
  updateDraftFileStorageConfigBucketAccess,
} from './file-storage-configs.service';

const ossDraft = {
  name: 'new OSS',
  provider: 'oss',
  status: 'enabled',
  isDefault: false,
  basePath: 'uploads',
  objectAcl: 'default',
  accessStrategy: 'proxy',
  uploadMode: 'server-proxy',
  presignedExpirySeconds: 1800,
  ossRegion: 'oss-cn-hangzhou',
  ossEndpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
  ossBucket: 'demo-bucket',
  ossAccessKeyId: 'ak',
  ossAccessKeySecret: 'sk',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('draft Bucket access', () => {
  it('probes the provider using unsaved form credentials without persisting a config', async () => {
    const result = await probeDraftFileStorageConfigBucketAccess(ossDraft);

    expect(result).toMatchObject({ bucketAcl: 'public-read', blockPublicAccess: false, effectivePublic: true });
    expect(vi.mocked(getBucketAccessInfo)).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'oss',
      ossBucket: 'demo-bucket',
      ossAccessKeyId: 'ak',
      ossAccessKeySecret: 'sk',
    }));
  });

  it('changes Bucket ACL/PAB using draft credentials without persisting a config', async () => {
    await updateDraftFileStorageConfigBucketAccess(ossDraft, { blockPublicAccess: false });

    expect(vi.mocked(setBucketAccessInfo)).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'oss',
      ossBucket: 'demo-bucket',
      ossAccessKeySecret: 'sk',
    }), { blockPublicAccess: false });
  });

  it('rejects providers without live Bucket access controls', async () => {
    await expect(probeDraftFileStorageConfigBucketAccess({
      ...ossDraft,
      provider: 'local',
      localRootPath: 'storage/local',
    })).rejects.toThrow('不支持 Bucket 权限探测');
    expect(FILE_BUCKET_ACCESS_SUPPORT.local).toBeUndefined();
  });
});
