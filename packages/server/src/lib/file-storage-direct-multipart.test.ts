import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { FileStorageConfigRow } from '../db/schema';
import { createDirectPartTarget, getBucketAccessInfo } from './file-storage';

const accountKey = Buffer.alloc(32, 7).toString('base64');
const require = createRequire(import.meta.url);
const OssConstructor = require('ali-oss') as typeof import('ali-oss').default;
const CosConstructor = require('cos-nodejs-sdk-v5') as typeof import('cos-nodejs-sdk-v5');

function config(provider: string, values: Record<string, unknown>): FileStorageConfigRow {
  return {
    provider,
    ossRegion: 'oss-cn-hangzhou', ossEndpoint: 'https://oss-cn-hangzhou.aliyuncs.com', ossBucket: 'test-bucket',
    ossAccessKeyId: 'test-ak', ossAccessKeySecret: 'test-secret',
    s3Region: 'us-east-1', s3Bucket: 'test-bucket', s3AccessKeyId: 'test-ak', s3SecretAccessKey: 'test-secret',
    cosRegion: 'ap-shanghai', cosBucket: 'test-1250000000', cosSecretId: 'test-ak', cosSecretKey: 'test-secret',
    obsEndpoint: 'https://obs.cn-east-3.myhuaweicloud.com', obsBucket: 'test-bucket', obsAccessKeyId: 'test-ak', obsSecretAccessKey: 'test-secret',
    kodoAccessKey: 'test-ak', kodoSecretKey: 'test-secret', kodoBucket: 'test-bucket', kodoRegion: 'Zone_z0',
    bosEndpoint: 'https://bj.bcebos.com', bosBucket: 'test-bucket', bosAccessKeyId: 'test-ak', bosSecretAccessKey: 'test-secret',
    azureAccountName: 'testaccount', azureAccountKey: accountKey, azureContainerName: 'test-container',
    ...values,
  } as unknown as FileStorageConfigRow;
}

describe('createDirectPartTarget', () => {
  it.each([
    ['oss', { uploadId: 'oss-upload', partNumber: '3' }],
    ['s3', { uploadId: 's3-upload', partNumber: '3' }],
    ['cos', { uploadId: 'cos-upload', partNumber: '3' }],
    ['obs', { uploadId: 'obs-upload', partNumber: '3' }],
    ['bos', { uploadId: 'bos-upload', partNumber: '3' }],
  ] as const)('%s signs the upload id and part number into its PUT target', async (provider, params) => {
    const target = await createDirectPartTarget(config(provider, {}), 'uploads/file.bin', params.uploadId, 3, 600);
    const url = new URL(target.url);
    expect(target.method).toBe('PUT');
    expect(url.searchParams.get('uploadId')).toBe(params.uploadId);
    expect(url.searchParams.get('partNumber')).toBe('3');
    if (provider === 'cos') {
      expect(url.searchParams.get('q-url-param-list')).toContain('uploadid');
      expect(url.searchParams.get('q-url-param-list')).toContain('partnumber');
      expect(url.searchParams.get('q-signature')).toBeTruthy();
      expect(url.searchParams.get('sign')).toBeNull();
    }
    expect(target.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('uses a fixed Azure block id and a scoped Kodo upload token', async () => {
    const azure = await createDirectPartTarget(config('azure', {}), 'uploads/file.bin', 'azure-upload', 3, 600);
    const azureUrl = new URL(azure.url);
    expect(azureUrl.searchParams.get('comp')).toBe('block');
    expect(azureUrl.searchParams.get('blockid')).toBe(azure.partTag);
    expect(azure.headers?.['x-ms-version']).toBeTruthy();

    const kodo = await createDirectPartTarget(config('kodo', {}), 'uploads/file.bin', 'kodo-upload', 3, 600);
    expect(kodo.url).toContain('/uploads/kodo-upload/3');
    expect(kodo.headers?.Authorization).toMatch(/^UpToken /);
    expect(kodo.headers?.Authorization).not.toContain('test-secret');
  });
});

describe('OSS bucket public access probing', () => {
  it('reads BlockPublicAccess from the dedicated publicAccessBlock subresource', async () => {
    const getBucketInfo = vi.spyOn(OssConstructor.prototype, 'getBucketInfo').mockResolvedValue({
      bucket: { AccessControlList: { Grant: 'public-read' } },
    } as never);
    const requestPrototype = OssConstructor.prototype as unknown as {
      request: (params: Record<string, unknown>) => Promise<{ data?: Buffer }>;
    };
    const request = vi.spyOn(requestPrototype, 'request').mockImplementation(async (params) => {
      expect(params).toMatchObject({ method: 'GET', bucket: 'demo-bucket', subres: 'publicAccessBlock' });
      return {
        data: Buffer.from('<PublicAccessBlockConfiguration><BlockPublicAccess>true</BlockPublicAccess></PublicAccessBlockConfiguration>'),
      };
    });

    const result = await getBucketAccessInfo(config('oss', {
      ossBucket: 'demo-bucket',
    }));

    expect(getBucketInfo).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ bucketAcl: 'public-read', blockPublicAccess: true, effectivePublic: false });
  });
});

describe('COS multipart authorization', () => {
  it('signs multipart uploadId and partNumber as query parameters', async () => {
    const getObjectUrl = vi.spyOn(CosConstructor.prototype, 'getObjectUrl').mockImplementation((params, callback) => {
      const url = 'https://test-1250000000.cos.ap-shanghai.myqcloud.com/uploads/file.bin?' +
        new URLSearchParams(params.Query as Record<string, string>).toString();
      callback?.(null as never, { Url: url } as never);
      return url as never;
    });
    const getAuth = vi.spyOn(CosConstructor.prototype, 'getAuth').mockReturnValue(
      'q-sign-algorithm=sha1&q-url-param-list=partnumber%3Buploadid&q-signature=signature',
    );

    const target = await createDirectPartTarget(config('cos', {}), 'uploads/file.bin', 'cos-upload', 3, 600);
    const url = new URL(target.url);

    expect(url.searchParams.get('uploadId')).toBe('cos-upload');
    expect(url.searchParams.get('partNumber')).toBe('3');
    expect(url.searchParams.get('q-signature')).toBe('signature');
    expect(getObjectUrl).toHaveBeenCalledWith(expect.objectContaining({ Sign: false, Query: { uploadId: 'cos-upload', partNumber: '3' } }), expect.any(Function));
    expect(getAuth).toHaveBeenCalledWith(expect.objectContaining({ Method: 'PUT', Query: { uploadId: 'cos-upload', partNumber: '3' } }));
  });
});
