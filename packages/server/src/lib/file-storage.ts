import OSS from 'ali-oss';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import COS from 'cos-nodejs-sdk-v5';
import * as qiniu from 'qiniu';
import BosClient from '@baiducloud/sdk';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import SftpClient from 'ssh2-sftp-client';
import { randomUUID } from 'node:crypto';
import { promises as fs, createWriteStream, createReadStream } from 'node:fs';
import { Readable, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { FileStorageConfigRow, ManagedFileRow } from '../db/schema';
import { FILE_OBJECT_ACL_SUPPORT } from '@zenith/shared';
import { formatDate } from './datetime';

// esdk-obs-nodejs 是 CJS 模块，无官方类型声明，运行时通过 require 加载
type ObsClientConstructor = new (opts: Record<string, string>) => ObsClientType;

// esdk-obs-nodejs 缺少官方类型声明，定义最小接口
interface ObsClientType {
  putObject(params: Record<string, unknown>, cb: (err: unknown, result: unknown) => void): void;
  getObject(params: Record<string, unknown>, cb: (err: unknown, result: { InterfaceResult?: { Content?: NodeJS.ReadableStream } }) => void): void;
  deleteObject(params: Record<string, unknown>, cb: (err: unknown) => void): void;
}

export const DEFAULT_LOCAL_STORAGE_ROOT = 'storage/local';

/** @baiducloud/sdk 的类型声明缺少 putObject / generatePresignedUrl，按运行时实际签名补充 */
interface BosStreamClient {
  putObject(bucket: string, key: string, data: NodeJS.ReadableStream, options: Record<string, unknown>): Promise<unknown>;
  generatePresignedUrl(bucket: string, key: string, timestamp: number, expirationInSeconds: number): string;
}

interface OssMultipartClient {
  initMultipartUpload(name: string, options?: { mime?: string; headers?: Record<string, string> }): Promise<{ uploadId?: string }>;
  _uploadPart(name: string, uploadId: string, partNo: number, data: { size: number; stream: Readable }): Promise<{ etag?: string }>;
  completeMultipartUpload(name: string, uploadId: string, parts: Array<{ number: number; etag: string }>): Promise<unknown>;
  abortMultipartUpload(name: string, uploadId: string): Promise<unknown>;
}

interface ObsMultipartResult<T> {
  CommonMsg?: { Status?: number; Code?: string; Message?: string };
  InterfaceResult?: T;
}

interface ObsMultipartClient extends ObsClientType {
  initiateMultipartUpload(params: Record<string, unknown>): Promise<ObsMultipartResult<{ UploadId?: string }>>;
  uploadPart(params: Record<string, unknown>): Promise<ObsMultipartResult<{ ETag?: string }>>;
  completeMultipartUpload(params: Record<string, unknown>): Promise<ObsMultipartResult<unknown>>;
  abortMultipartUpload(params: Record<string, unknown>): Promise<ObsMultipartResult<unknown>>;
}

interface BosMultipartClient extends BosStreamClient {
  initiateMultipartUpload(bucket: string, key: string, options?: Record<string, unknown>): Promise<{ body?: { uploadId?: string } }>;
  uploadPartFromDataUrl(bucket: string, key: string, uploadId: string, partNumber: number, partSize: number, dataUrl: string): Promise<{ http_headers?: { etag?: string } }>;
  completeMultipartUpload(bucket: string, key: string, uploadId: string, parts: Array<{ PartNumber: number; ETag: string }>): Promise<unknown>;
  abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<unknown>;
}

function trimSlash(value?: string | null) {
  return value?.replaceAll(/^\/+|\/+$/g, '') ?? '';
}

function buildObjectKey(originalName: string, basePath?: string | null) {
  const ext = path.extname(originalName).toLowerCase();
  const datePart = formatDate(new Date()).replaceAll('-', '/');
  const uniqueName = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
  return [trimSlash(basePath), datePart, uniqueName].filter(Boolean).join('/');
}

function resolveLocalRoot(config: FileStorageConfigRow) {
  const configuredRoot = config.localRootPath?.trim() || DEFAULT_LOCAL_STORAGE_ROOT;
  return path.isAbsolute(configuredRoot)
    ? configuredRoot
    : path.resolve(process.cwd(), configuredRoot);
}

/** 解析上传对象 ACL；default（继承 Bucket）或该 provider 不支持的取值返回 null，表示不发送 ACL 参数 */
function resolveObjectAcl(config: FileStorageConfigRow): 'private' | 'public-read' | 'public-read-write' | null {
  const acl = config.objectAcl;
  if (!acl || acl === 'default') return null;
  const supported = FILE_OBJECT_ACL_SUPPORT[config.provider];
  return supported?.includes(acl) ? acl : null;
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

function createObsClient(config: FileStorageConfigRow): ObsClientType {
  if (!config.obsEndpoint || !config.obsBucket || !config.obsAccessKeyId || !config.obsSecretAccessKey) {
    throw new Error('华为云 OBS 配置不完整');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ObsClientCtor = require('esdk-obs-nodejs') as ObsClientConstructor;
  return new ObsClientCtor({
    access_key_id: config.obsAccessKeyId,
    secret_access_key: config.obsSecretAccessKey,
    server: config.obsEndpoint,
  });
}

function createKodoUploader(config: FileStorageConfigRow) {
  if (!config.kodoAccessKey || !config.kodoSecretKey || !config.kodoBucket) {
    throw new Error('七牛云 Kodo 配置不完整');
  }
  const mac = new qiniu.auth.digest.Mac(config.kodoAccessKey, config.kodoSecretKey);
  const putPolicy = new qiniu.rs.PutPolicy({ scope: config.kodoBucket });
  const uploadToken = putPolicy.uploadToken(mac);
  const zone = config.kodoRegion
    ? (qiniu.zone as Record<string, unknown>)[config.kodoRegion] as qiniu.conf.Zone | undefined
    : undefined;
  const conf = new qiniu.conf.Config({ zone });
  return { uploadToken, formUploader: new qiniu.form_up.FormUploader(conf), mac, conf };
}

function createBosClient(config: FileStorageConfigRow) {
  if (!config.bosEndpoint || !config.bosBucket || !config.bosAccessKeyId || !config.bosSecretAccessKey) {
    throw new Error('百度云 BOS 配置不完整');
  }
  return new BosClient({
    endpoint: config.bosEndpoint,
    credentials: { ak: config.bosAccessKeyId, sk: config.bosSecretAccessKey },
  });
}

function createAzureBlobClient(config: FileStorageConfigRow) {
  if (!config.azureAccountName || !config.azureAccountKey || !config.azureContainerName) {
    throw new Error('Azure Blob 配置不完整');
  }
  const credential = new StorageSharedKeyCredential(config.azureAccountName, config.azureAccountKey);
  const url = config.azureEndpoint || `https://${config.azureAccountName}.blob.core.windows.net`;
  const service = new BlobServiceClient(url, credential);
  return service.getContainerClient(config.azureContainerName);
}

async function connectSftp(config: FileStorageConfigRow): Promise<SftpClient> {
  if (!config.sftpHost || !config.sftpUsername) {
    throw new Error('SFTP 配置不完整');
  }
  const client = new SftpClient();
  await client.connect({
    host: config.sftpHost,
    port: config.sftpPort ?? 22,
    username: config.sftpUsername,
    ...(config.sftpPrivateKey ? { privateKey: config.sftpPrivateKey } : { password: config.sftpPassword ?? '' }),
  });
  return client;
}

async function sftpOperation<T>(config: FileStorageConfigRow, fn: (client: SftpClient) => Promise<T>): Promise<T> {
  const client = await connectSftp(config);
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export function buildManagedFileUrl(fileId: string) {
  return `/api/files/${fileId}/content`;
}

/**
 * 从存储配置中提取 bucket/容器 标识，上传时快照到 managed_files，
 * 防止后续修改配置中的 bucket 导致旧文件无法访问。
 * local / sftp 不使用 bucket 概念，返回 null。
 */
function extractBucketName(config: FileStorageConfigRow): string | null {
  switch (config.provider) {
    case 'oss': return config.ossBucket ?? null;
    case 's3': return config.s3Bucket ?? null;
    case 'cos': return config.cosBucket ?? null;
    case 'obs': return config.obsBucket ?? null;
    case 'kodo': return config.kodoBucket ?? null;
    case 'bos': return config.bosBucket ?? null;
    case 'azure': return config.azureContainerName ?? null;
    default: return null;
  }
}

/**
 * 用文件记录中快照的 bucketName 覆盖 config 里对应 provider 的 bucket 字段，
 * 返回一个不影响原 config 的浅拷贝。对 local / sftp 或无快照的旧记录直接返回原 config。
 */
function withFileBucket(file: { bucketName?: string | null; provider: string }, config: FileStorageConfigRow): FileStorageConfigRow {
  if (!file.bucketName) return config;
  switch (config.provider) {
    case 'oss': return { ...config, ossBucket: file.bucketName };
    case 's3': return { ...config, s3Bucket: file.bucketName };
    case 'cos': return { ...config, cosBucket: file.bucketName };
    case 'obs': return { ...config, obsBucket: file.bucketName };
    case 'kodo': return { ...config, kodoBucket: file.bucketName };
    case 'bos': return { ...config, bosBucket: file.bucketName };
    case 'azure': return { ...config, azureContainerName: file.bucketName };
    default: return config;
  }
}

/** 将 Web API ReadableStream 转换为 Node.js Readable，绕过 DOM/Node 类型不兼容问题 */
function toNodeReadable(stream: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(stream as unknown as Parameters<typeof Readable.fromWeb>[0]);
}

interface UploadObjectInput {
  objectKey: string;
  stream: Readable;
  size: number;
  mimeType?: string;
}

/** 按存储配置上传一个对象（参数化 objectKey + Node 流），供简单上传与分片合并复用 */
export async function uploadObjectByConfig(config: FileStorageConfigRow, input: UploadObjectInput): Promise<void> {
  const { objectKey, stream, size, mimeType } = input;
  const objectAcl = resolveObjectAcl(config);

  if (config.provider === 'local') {
    const rootPath = resolveLocalRoot(config);
    const targetPath = path.join(rootPath, ...objectKey.split('/'));
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await pipeline(stream, createWriteStream(targetPath));
  } else if (config.provider === 'oss') {
    const client = createOssClient(config);
    await client.putStream(objectKey, stream, {
      contentLength: size,
      ...(mimeType ? { mime: mimeType } : {}),
      ...(objectAcl ? { headers: { 'x-oss-object-acl': objectAcl } } : {}),
    } as unknown as OSS.PutStreamOptions);
  } else if (config.provider === 's3') {
    const client = createS3Client(config);
    await client.send(new PutObjectCommand({
      Bucket: config.s3Bucket!,
      Key: objectKey,
      Body: stream,
      ContentLength: size,
      ...(mimeType ? { ContentType: mimeType } : {}),
      ...(objectAcl ? { ACL: objectAcl } : {}),
    }));
  } else if (config.provider === 'cos') {
    const cos = createCosClient(config);
    // COS 对象级 ACL 不支持 public-read-write（service 层已钳制，此处类型收窄兜底）
    const cosAcl = objectAcl === 'public-read-write' ? null : objectAcl;
    await new Promise<void>((resolve, reject) => {
      cos.putObject({
        Bucket: config.cosBucket!,
        Region: config.cosRegion!,
        Key: objectKey,
        Body: stream,
        ContentLength: size,
        ...(mimeType ? { ContentType: mimeType } : {}),
        ...(cosAcl ? { ACL: cosAcl } : {}),
      }, (err) => {
        if (err) reject(new Error(String(err.message ?? err)));
        else resolve();
      });
    });
  } else if (config.provider === 'obs') {
    const obs = createObsClient(config);
    await new Promise<void>((resolve, reject) => {
      obs.putObject({
        Bucket: config.obsBucket!,
        Key: objectKey,
        Body: stream,
        ContentLength: size,
        ...(mimeType ? { ContentType: mimeType } : {}),
        ...(objectAcl ? { ACL: objectAcl } : {}),
      }, (err) => {
        if (err) reject(new Error(String((err as { message?: string }).message ?? JSON.stringify(err))));
        else resolve();
      });
    });
  } else if (config.provider === 'kodo') {
    const { uploadToken, formUploader } = createKodoUploader(config);
    await new Promise<void>((resolve, reject) => {
      formUploader.putStream(uploadToken, objectKey, stream, new qiniu.form_up.PutExtra(), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } else if (config.provider === 'bos') {
    const bosClient = createBosClient(config);
    await (bosClient as unknown as BosStreamClient).putObject(config.bosBucket!, objectKey, stream, {
      'Content-Type': mimeType || 'application/octet-stream',
      'Content-Length': size,
      ...(objectAcl ? { 'x-bce-acl': objectAcl } : {}),
    });
  } else if (config.provider === 'azure') {
    const containerClient = createAzureBlobClient(config);
    const blockBlobClient = containerClient.getBlockBlobClient(objectKey);
    await blockBlobClient.uploadStream(
      stream,
      4 * 1024 * 1024,
      4,
      { blobHTTPHeaders: { blobContentType: mimeType } },
    );
  } else if (config.provider === 'sftp') {
    const remotePath = [config.sftpRootPath?.replace(/\/+$/, ''), ...objectKey.split('/')].filter(Boolean).join('/');
    await sftpOperation(config, async (client) => {
      const remoteDir = remotePath.substring(0, remotePath.lastIndexOf('/'));
      if (remoteDir) await client.mkdir(remoteDir, true);
      await client.put(stream, remotePath);
    });
  } else {
    throw new Error(`不支持的存储类型: ${config.provider}`);
  }
}

export async function uploadFileByConfig(config: FileStorageConfigRow, file: File) {
  const objectKey = buildObjectKey(file.name, config.basePath);
  const extension = path.extname(file.name).replace('.', '').toLowerCase() || undefined;
  const mimeType = file.type || undefined;
  const size = file.size;
  await uploadObjectByConfig(config, { objectKey, stream: toNodeReadable(file.stream()), size, mimeType });
  const bucketName = extractBucketName(config);
  return { objectKey, size, mimeType, extension, bucketName };
}

/** 供分片上传复用：根据原始文件名构造 objectKey + 提取扩展名 */
export function buildUploadObjectKey(fileName: string, basePath?: string | null) {
  return {
    objectKey: buildObjectKey(fileName, basePath),
    extension: path.extname(fileName).replace('.', '').toLowerCase() || undefined,
  };
}

export { extractBucketName };

// ─── 云原生分片上传（multipart）驱动 ────────────────────────────────────────────

export interface MultipartUploadPart {
  /** 分片号，从 1 计 */
  partNumber: number;
  etag: string;
}

/** 各对象存储原生 multipart 的统一抽象；返回 null 的 provider 走本地暂存合并路径 */
export interface MultipartDriver {
  init(config: FileStorageConfigRow, objectKey: string, mimeType?: string): Promise<string>;
  uploadPart(config: FileStorageConfigRow, objectKey: string, uploadId: string, partNumber: number, body: Buffer): Promise<string>;
  complete(config: FileStorageConfigRow, objectKey: string, uploadId: string, parts: MultipartUploadPart[], mimeType?: string): Promise<void>;
  abort(config: FileStorageConfigRow, objectKey: string, uploadId: string): Promise<void>;
}

function sortMultipartParts(parts: MultipartUploadPart[]) {
  return [...parts].sort((a, b) => a.partNumber - b.partNumber);
}

const s3MultipartDriver: MultipartDriver = {
  async init(config, objectKey, mimeType) {
    const client = createS3Client(config);
    const objectAcl = resolveObjectAcl(config);
    const res = await client.send(new CreateMultipartUploadCommand({
      Bucket: config.s3Bucket!,
      Key: objectKey,
      ...(mimeType ? { ContentType: mimeType } : {}),
      ...(objectAcl ? { ACL: objectAcl } : {}),
    }));
    if (!res.UploadId) throw new Error('S3 初始化分片上传失败：未返回 UploadId');
    return res.UploadId;
  },
  async uploadPart(config, objectKey, uploadId, partNumber, body) {
    const client = createS3Client(config);
    const res = await client.send(new UploadPartCommand({
      Bucket: config.s3Bucket!,
      Key: objectKey,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body,
      ContentLength: body.length,
    }));
    if (!res.ETag) throw new Error('S3 分片上传失败：未返回 ETag');
    return res.ETag;
  },
  async complete(config, objectKey, uploadId, parts) {
    const client = createS3Client(config);
    await client.send(new CompleteMultipartUploadCommand({
      Bucket: config.s3Bucket!,
      Key: objectKey,
      UploadId: uploadId,
      MultipartUpload: { Parts: sortMultipartParts(parts).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }));
  },
  async abort(config, objectKey, uploadId) {
    const client = createS3Client(config);
    await client.send(new AbortMultipartUploadCommand({
      Bucket: config.s3Bucket!,
      Key: objectKey,
      UploadId: uploadId,
    }));
  },
};

const ossMultipartDriver: MultipartDriver = {
  async init(config, objectKey, mimeType) {
    const client = createOssClient(config) as unknown as OssMultipartClient;
    const objectAcl = resolveObjectAcl(config);
    const options = {
      ...(mimeType ? { mime: mimeType } : {}),
      ...(objectAcl ? { headers: { 'x-oss-object-acl': objectAcl } } : {}),
    };
    const res = await client.initMultipartUpload(objectKey, Object.keys(options).length > 0 ? options : undefined);
    if (!res.uploadId) throw new Error('OSS 初始化分片上传失败：未返回 uploadId');
    return res.uploadId;
  },
  async uploadPart(config, objectKey, uploadId, partNumber, body) {
    const client = createOssClient(config) as unknown as OssMultipartClient;
    const res = await client._uploadPart(objectKey, uploadId, partNumber, {
      size: body.length,
      stream: Readable.from(body),
    });
    if (!res.etag) throw new Error('OSS 分片上传失败：未返回 ETag');
    return res.etag;
  },
  async complete(config, objectKey, uploadId, parts) {
    const client = createOssClient(config) as unknown as OssMultipartClient;
    await client.completeMultipartUpload(
      objectKey,
      uploadId,
      sortMultipartParts(parts).map((p) => ({ number: p.partNumber, etag: p.etag })),
    );
  },
  async abort(config, objectKey, uploadId) {
    const client = createOssClient(config) as unknown as OssMultipartClient;
    await client.abortMultipartUpload(objectKey, uploadId);
  },
};

const cosMultipartDriver: MultipartDriver = {
  async init(config, objectKey, mimeType) {
    const cos = createCosClient(config);
    const objectAcl = resolveObjectAcl(config);
    // COS 对象级 ACL 不支持 public-read-write（service 层已钳制，此处类型收窄兜底）
    const cosAcl = objectAcl === 'public-read-write' ? null : objectAcl;
    const res = await cos.multipartInit({
      Bucket: config.cosBucket!,
      Region: config.cosRegion!,
      Key: objectKey,
      ...(mimeType ? { ContentType: mimeType } : {}),
      ...(cosAcl ? { ACL: cosAcl } : {}),
    });
    if (!res.UploadId) throw new Error('COS 初始化分片上传失败：未返回 UploadId');
    return res.UploadId;
  },
  async uploadPart(config, objectKey, uploadId, partNumber, body) {
    const cos = createCosClient(config);
    const res = await cos.multipartUpload({
      Bucket: config.cosBucket!,
      Region: config.cosRegion!,
      Key: objectKey,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body,
      ContentLength: body.length,
    });
    if (!res.ETag) throw new Error('COS 分片上传失败：未返回 ETag');
    return res.ETag;
  },
  async complete(config, objectKey, uploadId, parts) {
    const cos = createCosClient(config);
    await cos.multipartComplete({
      Bucket: config.cosBucket!,
      Region: config.cosRegion!,
      Key: objectKey,
      UploadId: uploadId,
      Parts: sortMultipartParts(parts).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
    });
  },
  async abort(config, objectKey, uploadId) {
    const cos = createCosClient(config);
    await cos.multipartAbort({
      Bucket: config.cosBucket!,
      Region: config.cosRegion!,
      Key: objectKey,
      UploadId: uploadId,
    });
  },
};

function assertObsOk<T>(result: ObsMultipartResult<T>, action: string): T {
  const status = result.CommonMsg?.Status ?? 0;
  if (status >= 300) {
    throw new Error(`OBS ${action} 失败: ${result.CommonMsg?.Code ?? status} ${result.CommonMsg?.Message ?? ''}`.trim());
  }
  if (!result.InterfaceResult) throw new Error(`OBS ${action} 失败：未返回结果`);
  return result.InterfaceResult;
}

const obsMultipartDriver: MultipartDriver = {
  async init(config, objectKey, mimeType) {
    const obs = createObsClient(config) as ObsMultipartClient;
    const objectAcl = resolveObjectAcl(config);
    const result = assertObsOk(await obs.initiateMultipartUpload({
      Bucket: config.obsBucket!,
      Key: objectKey,
      ...(mimeType ? { ContentType: mimeType } : {}),
      ...(objectAcl ? { ACL: objectAcl } : {}),
    }), '初始化分片上传');
    if (!result.UploadId) throw new Error('OBS 初始化分片上传失败：未返回 UploadId');
    return result.UploadId;
  },
  async uploadPart(config, objectKey, uploadId, partNumber, body) {
    const obs = createObsClient(config) as ObsMultipartClient;
    const result = assertObsOk(await obs.uploadPart({
      Bucket: config.obsBucket!,
      Key: objectKey,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body,
    }), '上传分片');
    if (!result.ETag) throw new Error('OBS 分片上传失败：未返回 ETag');
    return result.ETag;
  },
  async complete(config, objectKey, uploadId, parts) {
    const obs = createObsClient(config) as ObsMultipartClient;
    assertObsOk(await obs.completeMultipartUpload({
      Bucket: config.obsBucket!,
      Key: objectKey,
      UploadId: uploadId,
      Parts: sortMultipartParts(parts).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
    }), '完成分片上传');
  },
  async abort(config, objectKey, uploadId) {
    const obs = createObsClient(config) as ObsMultipartClient;
    assertObsOk(await obs.abortMultipartUpload({
      Bucket: config.obsBucket!,
      Key: objectKey,
      UploadId: uploadId,
    }), '中止分片上传');
  },
};

function makeAzureBlockId(partNumber: number): string {
  return Buffer.from(String(partNumber).padStart(6, '0')).toString('base64');
}

const azureMultipartDriver: MultipartDriver = {
  async init(_config, objectKey) {
    return objectKey;
  },
  async uploadPart(config, objectKey, _uploadId, partNumber, body) {
    const containerClient = createAzureBlobClient(config);
    const blockId = makeAzureBlockId(partNumber);
    await containerClient.getBlockBlobClient(objectKey).stageBlock(blockId, body, body.length);
    return blockId;
  },
  async complete(config, objectKey, _uploadId, parts, mimeType) {
    const containerClient = createAzureBlobClient(config);
    await containerClient.getBlockBlobClient(objectKey).commitBlockList(
      sortMultipartParts(parts).map((p) => p.etag),
      { blobHTTPHeaders: { blobContentType: mimeType ?? 'application/octet-stream' } },
    );
  },
  async abort() {
    // Azure staged blocks have no explicit abort API; uncommitted blocks expire automatically.
  },
};

const bosMultipartDriver: MultipartDriver = {
  async init(config, objectKey, mimeType) {
    const client = createBosClient(config) as unknown as BosMultipartClient;
    const objectAcl = resolveObjectAcl(config);
    const res = await client.initiateMultipartUpload(config.bosBucket!, objectKey, {
      headers: {
        'Content-Type': mimeType ?? 'application/octet-stream',
        ...(objectAcl ? { 'x-bce-acl': objectAcl } : {}),
      },
    });
    if (!res.body?.uploadId) throw new Error('BOS 初始化分片上传失败：未返回 uploadId');
    return res.body.uploadId;
  },
  async uploadPart(config, objectKey, uploadId, partNumber, body) {
    const client = createBosClient(config) as unknown as BosMultipartClient;
    const res = await client.uploadPartFromDataUrl(
      config.bosBucket!,
      objectKey,
      uploadId,
      partNumber,
      body.length,
      body.toString('base64'),
    );
    if (!res.http_headers?.etag) throw new Error('BOS 分片上传失败：未返回 ETag');
    return res.http_headers.etag;
  },
  async complete(config, objectKey, uploadId, parts) {
    const client = createBosClient(config) as unknown as BosMultipartClient;
    await client.completeMultipartUpload(
      config.bosBucket!,
      objectKey,
      uploadId,
      sortMultipartParts(parts).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
    );
  },
  async abort(config, objectKey, uploadId) {
    const client = createBosClient(config) as unknown as BosMultipartClient;
    await client.abortMultipartUpload(config.bosBucket!, objectKey, uploadId);
  },
};

/**
 * 返回指定 provider 的原生 multipart 驱动；返回 null 表示该 provider 走本地暂存 + 流式合并路径。
 * 当前已接入：oss / s3 / cos / obs / azure / bos。
 * kodo 的 Node SDK 不暴露可外部控制的 uploadId/part/etag，仍走本地暂存 + 流式合并路径。
 */
export function getMultipartDriver(provider: FileStorageConfigRow['provider']): MultipartDriver | null {
  switch (provider) {
    case 'oss':
      return ossMultipartDriver;
    case 's3':
      return s3MultipartDriver;
    case 'cos':
      return cosMultipartDriver;
    case 'obs':
      return obsMultipartDriver;
    case 'azure':
      return azureMultipartDriver;
    case 'bos':
      return bosMultipartDriver;
    default:
      return null;
  }
}

export interface StoredFileRange {
  start: number;
  end: number;
}

export async function readStoredFile(file: ManagedFileRow, config: FileStorageConfigRow, range?: StoredFileRange) {
  const effectiveConfig = withFileBucket(file, config);
  const contentType = file.mimeType ?? 'application/octet-stream';
  const fileName = file.originalName;

  if (effectiveConfig.provider === 'local') {
    const filePath = path.join(resolveLocalRoot(effectiveConfig), ...file.objectKey.split('/'));
    const stream = Readable.toWeb(createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined)) as ReadableStream<Uint8Array>;
    return { stream, contentType, fileName };
  }

  if (effectiveConfig.provider === 'oss') {
    const client = createOssClient(effectiveConfig);
    // ali-oss getStream 返回 Node.js Readable，直接转为 Web ReadableStream
    const { stream: nodeStream } = await client.getStream(file.objectKey);
    const stream = Readable.toWeb(nodeStream as import('node:stream').Readable) as ReadableStream<Uint8Array>;
    return { stream, contentType, fileName };
  }

  if (effectiveConfig.provider === 's3') {
    const client = createS3Client(effectiveConfig);
    const response = await client.send(new GetObjectCommand({
      Bucket: effectiveConfig.s3Bucket!,
      Key: file.objectKey,
      ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
    }));
    // AWS SDK v3 Body.transformToWebStream() 直接返回 Web ReadableStream
    const stream = response.Body!.transformToWebStream() as ReadableStream<Uint8Array>;
    return { stream, contentType, fileName };
  }

  if (effectiveConfig.provider === 'cos') {
    const cos = createCosClient(effectiveConfig);
    // getObjectStream 同步返回 http.IncomingMessage（Readable），真正流式下载
    const nodeStream = cos.getObjectStream({
      Bucket: effectiveConfig.cosBucket!,
      Region: effectiveConfig.cosRegion!,
      Key: file.objectKey,
    }) as unknown as import('node:stream').Readable;
    const stream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    return { stream, contentType, fileName };
  }

  if (effectiveConfig.provider === 'obs') {
    const obs = createObsClient(effectiveConfig);
    // SaveAsStream:true 时回调在收到响应头后立即触发，Content 为 IncomingMessage（Readable）
    const nodeStream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
      obs.getObject({ Bucket: effectiveConfig.obsBucket!, Key: file.objectKey, SaveAsStream: true }, (err, result) => {
        if (err) reject(new Error(String((err as { message?: string }).message ?? JSON.stringify(err))));
        else if (!result?.InterfaceResult?.Content) reject(new Error('OBS getObject 未返回数据流'));
        else resolve(result.InterfaceResult.Content);
      });
    });
    const stream = Readable.toWeb(nodeStream as Readable) as ReadableStream<Uint8Array>;
    return { stream, contentType, fileName };
  }

  if (effectiveConfig.provider === 'kodo') {
    const { mac, conf } = createKodoUploader(effectiveConfig);
    const domain = effectiveConfig.kodoEndpoint ?? '';
    const bucketManager = new qiniu.rs.BucketManager(mac, conf);
    const privateUrl = bucketManager.privateDownloadUrl(domain, file.objectKey, Math.floor(Date.now() / 1000) + 3600);
    const response = await fetch(privateUrl);
    const stream = response.body!;
    return { stream, contentType, fileName };
  }

  if (effectiveConfig.provider === 'bos') {
    const bosClient = createBosClient(effectiveConfig);
    // BOS getObject 始终缓冲到内存，改用预签名 URL + fetch 流式下载
    const presignedUrl = (bosClient as unknown as BosStreamClient).generatePresignedUrl(
      effectiveConfig.bosBucket!,
      file.objectKey,
      Math.floor(Date.now() / 1000),
      3600,
    );
    const response = await fetch(presignedUrl);
    if (!response.ok) throw new Error(`BOS 下载失败: ${response.status}`);
    const stream = response.body as ReadableStream<Uint8Array>;
    return { stream, contentType, fileName };
  }

  if (effectiveConfig.provider === 'azure') {
    const containerClient = createAzureBlobClient(effectiveConfig);
    const blockBlobClient = containerClient.getBlockBlobClient(file.objectKey);
    const response = await blockBlobClient.download();
    const nodeStream = response.readableStreamBody as import('node:stream').Readable;
    const stream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    return { stream, contentType, fileName };
  }

  if (effectiveConfig.provider === 'sftp') {
    const remotePath = [effectiveConfig.sftpRootPath?.replace(/\/+$/, ''), ...file.objectKey.split('/')].filter(Boolean).join('/');
    const client = await connectSftp(effectiveConfig);
    const passThrough = new PassThrough();
    // 不 await get：远端流持续 pipe 到 passThrough，消费端并发读取，读完/出错后再关闭连接
    void client.get(remotePath, passThrough)
      .then(() => client.end())
      .catch((err: unknown) => {
        passThrough.destroy(err instanceof Error ? err : new Error(String(err)));
        void client.end();
      });
    const stream = Readable.toWeb(passThrough) as ReadableStream<Uint8Array>;
    return { stream, contentType, fileName };
  }

  throw new Error(`不支持的存储类型: ${effectiveConfig.provider}`);
}

export async function deleteObjectByConfig(config: FileStorageConfigRow, objectKey: string, bucketName?: string | null) {
  const effectiveConfig = withFileBucket({ bucketName, provider: config.provider }, config);
  if (effectiveConfig.provider === 'local') {
    const filePath = path.join(resolveLocalRoot(effectiveConfig), ...objectKey.split('/'));
    try {
      await fs.unlink(filePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return;
  }

  if (effectiveConfig.provider === 'oss') {
    const client = createOssClient(effectiveConfig);
    await client.delete(objectKey);
    return;
  }

  if (effectiveConfig.provider === 's3') {
    const client = createS3Client(effectiveConfig);
    await client.send(new DeleteObjectCommand({
      Bucket: effectiveConfig.s3Bucket!,
      Key: objectKey,
    }));
    return;
  }

  if (effectiveConfig.provider === 'cos') {
    const cos = createCosClient(effectiveConfig);
    await new Promise<void>((resolve, reject) => {
      cos.deleteObject({
        Bucket: effectiveConfig.cosBucket!,
        Region: effectiveConfig.cosRegion!,
        Key: objectKey,
      }, (err) => {
        if (err) reject(new Error(String(err.message ?? err)));
        else resolve();
      });
    });
    return;
  }

  if (effectiveConfig.provider === 'obs') {
    const obs = createObsClient(effectiveConfig);
    await new Promise<void>((resolve, reject) => {
      obs.deleteObject({ Bucket: effectiveConfig.obsBucket!, Key: objectKey }, (err) => {
        if (err) reject(new Error(String((err as { message?: string }).message ?? JSON.stringify(err))));
        else resolve();
      });
    });
    return;
  }

  if (effectiveConfig.provider === 'kodo') {
    const { mac, conf } = createKodoUploader(effectiveConfig);
    const bucketManager = new qiniu.rs.BucketManager(mac, conf);
    await new Promise<void>((resolve, reject) => {
      bucketManager.delete(effectiveConfig.kodoBucket!, objectKey, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return;
  }

  if (effectiveConfig.provider === 'bos') {
    const bosClient = createBosClient(effectiveConfig);
    await bosClient.deleteObject(effectiveConfig.bosBucket!, objectKey);
    return;
  }

  if (effectiveConfig.provider === 'azure') {
    const containerClient = createAzureBlobClient(effectiveConfig);
    await containerClient.deleteBlob(objectKey);
    return;
  }

  if (effectiveConfig.provider === 'sftp') {
    await sftpOperation(effectiveConfig, async (client) => {
      const remotePath = [effectiveConfig.sftpRootPath?.replace(/\/+$/, ''), ...objectKey.split('/')].filter(Boolean).join('/');
      await client.delete(remotePath, true);
    });
    return;
  }

  throw new Error(`不支持的存储类型: ${effectiveConfig.provider}`);
}

export async function deleteStoredFile(file: ManagedFileRow, config: FileStorageConfigRow) {
  await deleteObjectByConfig(config, file.objectKey, file.bucketName);
}
