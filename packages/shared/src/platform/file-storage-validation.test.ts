import { describe, expect, it } from 'vitest';
import { FILE_DIRECT_UPLOAD_SUPPORT } from './constants';
import { createFileStorageConfigSchema } from './validation';

const ossBase = {
  name: 'oss',
  provider: 'oss',
  status: 'enabled',
  isDefault: false,
  objectAcl: 'default',
  accessStrategy: 'proxy',
  presignedExpirySeconds: 1800,
  ossRegion: 'oss-cn-hangzhou',
  ossEndpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
  ossBucket: 'demo',
  ossAccessKeyId: 'ak',
  ossAccessKeySecret: 'sk',
} as const;

describe('file storage access strategy validation', () => {
  it('enables browser-direct for every cloud object storage provider only', () => {
    expect(Object.keys(FILE_DIRECT_UPLOAD_SUPPORT).sort()).toEqual(['azure', 'bos', 'cos', 'kodo', 'obs', 'oss', 's3']);
  });

  it('accepts inherited objects with a public-read bucket', () => {
    const result = createFileStorageConfigSchema.safeParse({
      ...ossBase,
      accessStrategy: 'public-bucket',
      objectAcl: 'default',
    });
    expect(result.success).toBe(true);
  });

  it('rejects public-bucket when objects override the bucket ACL', () => {
    const result = createFileStorageConfigSchema.safeParse({
      ...ossBase,
      accessStrategy: 'public-bucket',
      objectAcl: 'public-read',
    });
    expect(result.success).toBe(false);
  });

  it('requires a public object ACL for public-object', () => {
    expect(createFileStorageConfigSchema.safeParse({ ...ossBase, accessStrategy: 'public-object', objectAcl: 'default' }).success).toBe(false);
    expect(createFileStorageConfigSchema.safeParse({ ...ossBase, accessStrategy: 'public-object', objectAcl: 'public-read' }).success).toBe(true);
  });

  it('requires a domain for public-domain', () => {
    expect(createFileStorageConfigSchema.safeParse({ ...ossBase, accessStrategy: 'public-domain' }).success).toBe(false);
    expect(createFileStorageConfigSchema.safeParse({
      ...ossBase,
      accessStrategy: 'public-domain',
      publicBaseUrl: 'https://cdn.example.com',
    }).success).toBe(true);
  });

  it('rejects bucket public access for local storage', () => {
    const result = createFileStorageConfigSchema.safeParse({
      name: 'local',
      provider: 'local',
      status: 'enabled',
      isDefault: false,
      objectAcl: 'default',
      accessStrategy: 'public-bucket',
      presignedExpirySeconds: 1800,
      localRootPath: 'storage/local',
    });
    expect(result.success).toBe(false);
  });
});
