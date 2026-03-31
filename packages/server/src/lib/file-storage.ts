import OSS from 'ali-oss';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import COS from 'cos-nodejs-sdk-v5';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FileStorageConfigRow, ManagedFileRow } from '../db/schema';

export const DEFAULT_LOCAL_STORAGE_ROOT = 'storage/local';

function trimSlash(value?: string | null) {
  return value?.replaceAll(/^\/+|\/+$/g, '') ?? '';
}

function buildObjectKey(originalName: string, basePath?: string | null) {
  const ext = path.extname(originalName).toLowerCase();
  const datePart = new Date().toISOString().slice(0, 10).replaceAll('-', '/');
  const uniqueName = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
  return [trimSlash(basePath), datePart, uniqueName].filter(Boolean).join('/');
}

function resolveLocalRoot(config: FileStorageConfigRow) {
  const configuredRoot = config.localRootPath?.trim() || DEFAULT_LOCAL_STORAGE_ROOT;
  return path.isAbsolute(configuredRoot)
    ? configuredRoot
    : path.resolve(process.cwd(), configuredRoot);
}

function createOssClient(config: FileStorageConfigRow) {
  if (!config.ossRegion || !config.ossEndpoint || !config.ossBucket || !config.ossAccessKeyId || !config.ossAccessKeySecret) {
    throw new Error('OSS 配置不完整');
  }
  return new OSS({
    region: config.ossRegion,
    endpoint: config.ossEndpoint,
    bucket: config.ossBucket,
    accessKeyId: config.ossAccessKeyId,
    accessKeySecret: config.ossAccessKeySecret,
  });
}

function createS3Client(config: FileStorageConfigRow) {
  if (!config.s3Region || !config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey) {
    throw new Error('S3 配置不完整');
  }
  return new S3Client({
    region: config.s3Region,
    ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : {}),
    credentials: {
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    },
    forcePathStyle: config.s3ForcePathStyle ?? false,
  });
}

function createCosClient(config: FileStorageConfigRow) {
  if (!config.cosRegion || !config.cosBucket || !config.cosSecretId || !config.cosSecretKey) {
    throw new Error('腾讯云 COS 配置不完整');
  }
  return new COS({
    SecretId: config.cosSecretId,
    SecretKey: config.cosSecretKey,
  });
}

async function normalizeOssContent(content: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) return Buffer.from(content);
  if (content instanceof ArrayBuffer) return Buffer.from(content);
  if (typeof content === 'string') return Buffer.from(content);
  if (content && typeof (content as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of content as AsyncIterable<unknown>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }
  throw new Error('无法读取 OSS 文件内容');
}

export function buildManagedFileUrl(fileId: number) {
  return `/api/files/${fileId}/content`;
}

export async function uploadFileByConfig(config: FileStorageConfigRow, file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const objectKey = buildObjectKey(file.name, config.basePath);
  const extension = path.extname(file.name).replace('.', '').toLowerCase() || undefined;
  const mimeType = file.type || undefined;

  if (config.provider === 'local') {
    const rootPath = resolveLocalRoot(config);
    const targetPath = path.join(rootPath, ...objectKey.split('/'));
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, buffer);
  } else if (config.provider === 'oss') {
    const client = createOssClient(config);
    await client.put(objectKey, buffer, mimeType ? { headers: { 'Content-Type': mimeType } } : undefined);
  } else if (config.provider === 's3') {
    const client = createS3Client(config);
    await client.send(new PutObjectCommand({
      Bucket: config.s3Bucket!,
      Key: objectKey,
      Body: buffer,
      ...(mimeType ? { ContentType: mimeType } : {}),
    }));
  } else if (config.provider === 'cos') {
    const cos = createCosClient(config);
    await new Promise<void>((resolve, reject) => {
      cos.putObject({
        Bucket: config.cosBucket!,
        Region: config.cosRegion!,
        Key: objectKey,
        Body: buffer,
        ...(mimeType ? { ContentType: mimeType } : {}),
      }, (err) => {
        if (err) reject(new Error(String(err.message ?? err)));
        else resolve();
      });
    });
  } else {
    throw new Error(`不支持的存储类型: ${config.provider}`);
  }

  return { objectKey, size: buffer.byteLength, mimeType, extension };
}

export async function readStoredFile(file: ManagedFileRow, config: FileStorageConfigRow) {
  if (config.provider === 'local') {
    const filePath = path.join(resolveLocalRoot(config), ...file.objectKey.split('/'));
    const buffer = await fs.readFile(filePath);
    return { buffer, contentType: file.mimeType ?? 'application/octet-stream', fileName: file.originalName };
  }

  if (config.provider === 'oss') {
    const client = createOssClient(config);
    const result = await client.get(file.objectKey);
    const buffer = await normalizeOssContent(result.content);
    return { buffer, contentType: file.mimeType ?? 'application/octet-stream', fileName: file.originalName };
  }

  if (config.provider === 's3') {
    const client = createS3Client(config);
    const response = await client.send(new GetObjectCommand({
      Bucket: config.s3Bucket!,
      Key: file.objectKey,
    }));
    const bytes = await response.Body!.transformToByteArray();
    return {
      buffer: Buffer.from(bytes),
      contentType: file.mimeType ?? 'application/octet-stream',
      fileName: file.originalName,
    };
  }

  if (config.provider === 'cos') {
    const cos = createCosClient(config);
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      cos.getObject({
        Bucket: config.cosBucket!,
        Region: config.cosRegion!,
        Key: file.objectKey,
      }, (err, data) => {
        if (err) reject(new Error(String(err.message ?? err)));
        else resolve(Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body as Uint8Array));
      });
    });
    return { buffer, contentType: file.mimeType ?? 'application/octet-stream', fileName: file.originalName };
  }

  throw new Error(`不支持的存储类型: ${config.provider}`);
}

export async function deleteStoredFile(file: ManagedFileRow, config: FileStorageConfigRow) {
  if (config.provider === 'local') {
    const filePath = path.join(resolveLocalRoot(config), ...file.objectKey.split('/'));
    try {
      await fs.unlink(filePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return;
  }

  if (config.provider === 'oss') {
    const client = createOssClient(config);
    await client.delete(file.objectKey);
    return;
  }

  if (config.provider === 's3') {
    const client = createS3Client(config);
    await client.send(new DeleteObjectCommand({
      Bucket: config.s3Bucket!,
      Key: file.objectKey,
    }));
    return;
  }

  if (config.provider === 'cos') {
    const cos = createCosClient(config);
    await new Promise<void>((resolve, reject) => {
      cos.deleteObject({
        Bucket: config.cosBucket!,
        Region: config.cosRegion!,
        Key: file.objectKey,
      }, (err) => {
        if (err) reject(new Error(String(err.message ?? err)));
        else resolve();
      });
    });
    return;
  }

  throw new Error(`不支持的存储类型: ${config.provider}`);
}
