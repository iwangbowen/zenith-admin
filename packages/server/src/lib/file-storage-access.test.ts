import { describe, expect, it } from 'vitest';
import type { FileStorageConfigRow } from '../db/schema';
import { buildPublicFileUrl, resolvePublicAccess } from './file-storage';

function config(overrides: Partial<FileStorageConfigRow>): FileStorageConfigRow {
  return {
    id: 1,
    name: 'test',
    provider: 'oss',
    status: 'enabled',
    isDefault: false,
    basePath: null,
    objectAcl: 'default',
    accessStrategy: 'proxy',
    bucketAcl: null,
    bucketBlockPublicAccess: null,
    bucketAccessCheckedAt: null,
    bucketAccessError: null,
    publicBaseUrl: null,
    presignedExpirySeconds: 1800,
    localRootPath: null,
    ossRegion: 'oss-cn-hangzhou',
    ossEndpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
    ossBucket: 'demo-bucket',
    ossAccessKeyId: 'ak',
    ossAccessKeySecret: 'sk',
    s3Region: null,
    s3Endpoint: null,
    s3Bucket: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
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
    sftpHost: null,
    sftpPort: null,
    sftpUsername: null,
    sftpPassword: null,
    sftpPrivateKey: null,
    sftpRootPath: null,
    sftpBaseUrl: null,
    remark: null,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const file = {
  id: 'f1',
  provider: 'oss' as const,
  objectKey: 'uploads/a.txt',
  bucketName: 'demo-bucket',
  objectAcl: 'default' as const,
  publicAccess: false,
};

describe('buildPublicFileUrl', () => {
  it('uses object ACL for public-object', () => {
    const url = buildPublicFileUrl(
      { ...file, objectAcl: 'public-read' },
      config({ accessStrategy: 'public-object', bucketBlockPublicAccess: false }),
    );
    expect(url).toBe('https://demo-bucket.oss-cn-hangzhou.aliyuncs.com/uploads/a.txt');
  });

  it('rejects inherited object ACL for public-object', () => {
    expect(buildPublicFileUrl(file, config({ accessStrategy: 'public-object', bucketBlockPublicAccess: false }))).toBeNull();
  });

  it('uses the upload snapshot for public-bucket', () => {
    const url = buildPublicFileUrl(
      { ...file, publicAccess: true },
      config({ accessStrategy: 'public-bucket', bucketAcl: 'public-read', bucketBlockPublicAccess: false }),
    );
    expect(url).toBe('https://demo-bucket.oss-cn-hangzhou.aliyuncs.com/uploads/a.txt');
  });

  it('rejects public-bucket without a public snapshot', () => {
    expect(buildPublicFileUrl(file, config({ accessStrategy: 'public-bucket' }))).toBeNull();
  });

  it('uses the custom domain for public-domain', () => {
    const url = buildPublicFileUrl(
      file,
      config({ accessStrategy: 'public-domain', publicBaseUrl: 'https://cdn.example.com' }),
    );
    expect(url).toBe('https://cdn.example.com/uploads/a.txt');
  });

  it('returns null for proxy', () => {
    expect(buildPublicFileUrl({ ...file, objectAcl: 'public-read' }, config({ accessStrategy: 'proxy' }))).toBeNull();
  });
});

describe('resolvePublicAccess', () => {
  it('requires public object ACL for public-object', () => {
    expect(resolvePublicAccess(config({ accessStrategy: 'public-object', bucketBlockPublicAccess: false }), 'public-read')).toBe(true);
    expect(resolvePublicAccess(config({ accessStrategy: 'public-object' }), 'default')).toBe(false);
    expect(resolvePublicAccess(config({ accessStrategy: 'public-object', bucketBlockPublicAccess: null }), 'public-read')).toBe(false);
  });

  it('requires bucket public-read and block public access off for public-bucket', () => {
    const base = config({ accessStrategy: 'public-bucket', bucketAcl: 'public-read' });
    expect(resolvePublicAccess({ ...base, bucketBlockPublicAccess: false }, 'default')).toBe(true);
    expect(resolvePublicAccess({ ...base, bucketBlockPublicAccess: true }, 'default')).toBe(false);
    expect(resolvePublicAccess({ ...base, bucketAcl: 'private', bucketBlockPublicAccess: false }, 'default')).toBe(false);
    expect(resolvePublicAccess({ ...base, bucketBlockPublicAccess: null }, 'default')).toBe(false);
  });

  it('trusts the configured domain for public-domain', () => {
    expect(resolvePublicAccess(config({ accessStrategy: 'public-domain', publicBaseUrl: 'https://cdn.example.com' }), 'private')).toBe(true);
    expect(resolvePublicAccess(config({ accessStrategy: 'public-domain' }), 'private')).toBe(false);
  });
});
