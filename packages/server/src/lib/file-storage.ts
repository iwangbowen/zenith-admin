import OSS from 'ali-oss';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type { FileStorageConfigRow, ManagedFileRow } from '../db/schema';

export const DEFAULT_LOCAL_STORAGE_ROOT = 'storage/local';

function trimSlash(value?: string | null) {
  return value?.replace(/^\/+|\/+$/g, '') ?? '';
}

function buildObjectKey(originalName: string, basePath?: string | null) {
  const ext = path.extname(originalName).toLowerCase();
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
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
  } else {
    const client = createOssClient(config);
    await client.put(objectKey, buffer, mimeType ? { headers: { 'Content-Type': mimeType } } : undefined);
  }

  return {
    objectKey,
    size: buffer.byteLength,
    mimeType,
    extension,
  };
}

export async function readStoredFile(file: ManagedFileRow, config: FileStorageConfigRow) {
  if (config.provider === 'local') {
    const filePath = path.join(resolveLocalRoot(config), ...file.objectKey.split('/'));
    const buffer = await fs.readFile(filePath);
    return {
      buffer,
      contentType: file.mimeType ?? 'application/octet-stream',
      fileName: file.originalName,
    };
  }

  const client = createOssClient(config);
  const result = await client.get(file.objectKey);
  const buffer = await normalizeOssContent(result.content);
  return {
    buffer,
    contentType: file.mimeType ?? 'application/octet-stream',
    fileName: file.originalName,
  };
}

export async function deleteStoredFile(file: ManagedFileRow, config: FileStorageConfigRow) {
  if (config.provider === 'local') {
    const filePath = path.join(resolveLocalRoot(config), ...file.objectKey.split('/'));
    try {
      await fs.unlink(filePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    return;
  }

  const client = createOssClient(config);
  await client.delete(file.objectKey);
}
