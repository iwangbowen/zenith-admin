import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const current = {
    id: 1,
    name: '本地磁盘',
    provider: 'local',
    status: 'enabled',
    isDefault: false,
    basePath: 'uploads',
    objectAcl: 'default',
    accessStrategy: 'proxy',
    bucketAcl: null,
    blockPublicAccess: null,
    policyPublic: null,
    publicStatus: null,
    accountBlockPublicAccess: null,
    bucketAccessCheckedAt: null,
    bucketAccessError: null,
    uploadMode: 'server-proxy',
    presignedExpirySeconds: 1800,
    publicBaseUrl: null,
    localRootPath: 'storage/local',
    ossRegion: null,
    ossEndpoint: null,
    ossBucket: null,
    ossAccessKeyId: null,
    ossAccessKeySecret: null,
    s3Region: null,
    s3Endpoint: null,
    s3Bucket: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3AccountId: null,
    s3ForcePathStyle: null,
    cosRegion: null,
    cosBucket: null,
    cosSecretId: null,
    cosSecretKey: null,
    obsEndpoint: null,
    obsBucket: null,
    obsAccessKeyId: null,
    obsSecretAccessKey: null,
    kodoAccessKey: null,
    kodoSecretKey: null,
    kodoBucket: null,
    kodoRegion: null,
    kodoEndpoint: null,
    bosEndpoint: null,
    bosBucket: null,
    bosAccessKeyId: null,
    bosSecretAccessKey: null,
    azureAccountName: null,
    azureAccountKey: null,
    azureContainerName: null,
    azureEndpoint: null,
    azureTenantId: null,
    azureClientId: null,
    azureClientSecret: null,
    azureSubscriptionId: null,
    azureResourceGroup: null,
    azureCloud: 'public',
    sftpHost: null,
    sftpPort: null,
    sftpUsername: null,
    sftpPassword: null,
    sftpPrivateKey: null,
    sftpRootPath: null,
    sftpBaseUrl: null,
    remark: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2026-11-20T00:00:00.000Z'),
    updatedAt: new Date('2026-11-20T00:00:00.000Z'),
  };
  return { current };
});

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  $count: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../db', () => ({ db: dbMock }));
vi.mock('../../lib/list-query', () => ({ listRows: vi.fn() }));
vi.mock('../../lib/db-assert', () => ({ requireRow: vi.fn((row: unknown) => row) }));
vi.mock('../../lib/default-flag', () => ({ clearDefaultFlag: vi.fn(async () => undefined) }));
vi.mock('../../lib/file-storage', () => ({
  getBucketAccessInfo: vi.fn(),
  setBucketAccessInfo: vi.fn(),
  uploadObjectByConfig: vi.fn(),
  deleteObjectByConfig: vi.fn(),
}));

const { updateFileStorageConfig } = await import('./file-storage-configs.service');

function selectChain(rows: unknown[]) {
  return {
    from: () => ({ where: () => ({ limit: async () => rows }) }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.select.mockReturnValue(selectChain([state.current]));
  const returning = vi.fn(async () => [{ ...state.current, isDefault: true }]);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  dbMock.transaction.mockImplementation(async (callback: (tx: { update: typeof update }) => unknown) => callback({ update }));
});

describe('updateFileStorageConfig', () => {
  it('sets a local config as default even though unused provider fields are null in the row', async () => {
    await expect(updateFileStorageConfig(1, { isDefault: true })).resolves.toMatchObject({
      id: 1,
      provider: 'local',
      isDefault: true,
    });
  });
});
