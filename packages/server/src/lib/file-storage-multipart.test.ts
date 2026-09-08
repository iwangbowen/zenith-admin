/**
 * S3 原生 multipart 驱动单测：对真实 `S3Client.prototype.send` 打桩（file-storage 经 createRequire 加载同一 CJS 实例），
 * 钉死与云端协议相关的映射细节——分片号从 1 计、complete 前按分片号排序、ETag 原样回传、ACL 只在配置允许时下发。
 */
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileStorageConfigRow } from '../db/schema';
import { getMultipartDriver } from './file-storage';

const require = createRequire(import.meta.url);
const s3 = require('@aws-sdk/client-s3') as typeof import('@aws-sdk/client-s3');

const config = {
  provider: 's3',
  s3Region: 'us-east-1',
  s3Bucket: 'bkt',
  s3AccessKeyId: 'ak',
  s3SecretAccessKey: 'sk',
  s3Endpoint: 'http://localhost:9000',
  s3ForcePathStyle: true,
  objectAcl: 'public-read',
} as unknown as FileStorageConfigRow;

type SentCommand = { constructor: { name: string }; input: Record<string, unknown> };

function stubSend(respond: (cmd: SentCommand) => unknown) {
  const sent: SentCommand[] = [];
  const spy = vi.spyOn(s3.S3Client.prototype, 'send').mockImplementation(async (cmd: unknown) => {
    const c = cmd as SentCommand;
    sent.push(c);
    return respond(c);
  });
  return { sent, spy };
}

afterEach(() => vi.restoreAllMocks());

describe('s3MultipartDriver', () => {
  const driver = getMultipartDriver('s3')!;

  it('init 下发 ContentType 与对象 ACL 并返回 UploadId；云端未返回 UploadId 时报错', async () => {
    const { sent } = stubSend(() => ({ UploadId: 'mp-1' }));
    await expect(driver.init(config, 'k/demo.bin', 'video/mp4')).resolves.toBe('mp-1');
    expect(sent[0].constructor.name).toBe('CreateMultipartUploadCommand');
    expect(sent[0].input).toMatchObject({ Bucket: 'bkt', Key: 'k/demo.bin', ContentType: 'video/mp4', ACL: 'public-read' });

    vi.restoreAllMocks();
    stubSend(() => ({}));
    await expect(driver.init(config, 'k/demo.bin')).rejects.toThrow('未返回 UploadId');
  });

  it('uploadPart 按给定分片号上传并回传 ETag，ContentLength 等于分片长度', async () => {
    const { sent } = stubSend(() => ({ ETag: '"etag-3"' }));
    const body = Buffer.alloc(1234, 7);
    await expect(driver.uploadPart(config, 'k/demo.bin', 'mp-1', 3, body)).resolves.toBe('"etag-3"');
    expect(sent[0].constructor.name).toBe('UploadPartCommand');
    expect(sent[0].input).toMatchObject({ UploadId: 'mp-1', PartNumber: 3, ContentLength: 1234 });
  });

  it('complete 把乱序分片按 PartNumber 升序提交', async () => {
    const { sent } = stubSend(() => ({}));
    await driver.complete(config, 'k/demo.bin', 'mp-1', [
      { partNumber: 3, etag: '"c"' }, { partNumber: 1, etag: '"a"' }, { partNumber: 2, etag: '"b"' },
    ]);
    expect(sent[0].constructor.name).toBe('CompleteMultipartUploadCommand');
    expect((sent[0].input.MultipartUpload as { Parts: unknown[] }).Parts).toEqual([
      { PartNumber: 1, ETag: '"a"' }, { PartNumber: 2, ETag: '"b"' }, { PartNumber: 3, ETag: '"c"' },
    ]);
  });

  it('abort 以同一 Bucket / Key / UploadId 中止', async () => {
    const { sent } = stubSend(() => ({}));
    await driver.abort(config, 'k/demo.bin', 'mp-1');
    expect(sent[0].constructor.name).toBe('AbortMultipartUploadCommand');
    expect(sent[0].input).toMatchObject({ Bucket: 'bkt', Key: 'k/demo.bin', UploadId: 'mp-1' });
  });
});

describe('getMultipartDriver', () => {
  it('只有具备可控 multipart 的 provider 返回驱动，其余走本地暂存', () => {
    for (const p of ['oss', 's3', 'cos', 'obs', 'azure', 'bos'] as const) expect(getMultipartDriver(p)).not.toBeNull();
    for (const p of ['local', 'kodo', 'sftp'] as const) expect(getMultipartDriver(p)).toBeNull();
  });
});
