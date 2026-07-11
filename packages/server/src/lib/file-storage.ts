import OSS from 'ali-oss';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import COS from 'cos-nodejs-sdk-v5';
import * as qiniu from 'qiniu';
import BosClient from '@baiducloud/sdk';
import { BlobServiceClient, BlobSASPermissions, StorageSharedKeyCredential } from '@azure/storage-blob';
import SftpClient from 'ssh2-sftp-client';
import { randomUUID } from 'node:crypto';
import { promises as fs, createWriteStream, createReadStream } from 'node:fs';
import { Readable, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { FileStorageConfigRow, ManagedFileRow } from '../db/schema';
import { FILE_OBJECT_ACL_SUPPORT } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { formatDate } from './datetime';
import logger from './logger';

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
export function resolveObjectAcl(config: FileStorageConfigRow): 'private' | 'public-read' | 'public-read-write' | null {
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
    // ali-oss 默认 secure:false，无协议 endpoint 会拼出 http:// 签名 URL（浏览器混合内容拦截）；
    // 与 splitEndpoint 语义一致：仅显式 http:// 时才走 http
    secure: !config.ossEndpoint.startsWith('http://'),
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
  // @baiducloud/sdk 默认 protocol:'http'，无协议 endpoint 会签出 http:// URL；仅显式 http:// 时才走 http。
  // 类型声明缺少 protocol 配置项（运行时支持，见 sdk src/config.js），故做断言
  const options = {
    endpoint: config.bosEndpoint,
    credentials: { ak: config.bosAccessKeyId, sk: config.bosSecretAccessKey },
    protocol: config.bosEndpoint.startsWith('http://') ? 'http' : 'https',
  };
  return new BosClient(options as unknown as ConstructorParameters<typeof BosClient>[0]);
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

export function buildManagedFileProxyUrl(fileId: string) {
  return `/api/files/${fileId}/content`;
}

// ─── 直链解析（public / presigned / proxy 三级策略）──────────────────────────

export interface FileAccessUrlResult {
  url: string;
  strategy: 'proxy' | 'public' | 'presigned';
  expiresAt: Date | null;
}

/** 文件记录中直链解析所需的最小字段集 */
interface FileUrlSource {
  id: string;
  provider: FileStorageConfigRow['provider'];
  objectKey: string;
  bucketName?: string | null;
  objectAcl?: 'default' | 'private' | 'public-read' | 'public-read-write' | null;
}

function encodeObjectKey(objectKey: string) {
  return objectKey.split('/').map(encodeURIComponent).join('/');
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

/** 拆出 endpoint 的协议与主机；无协议时默认 https */
function splitEndpoint(endpoint: string): { scheme: string; host: string } {
  const matched = /^(https?):\/\//.exec(endpoint);
  if (matched) return { scheme: matched[1], host: trimTrailingSlash(endpoint.slice(matched[0].length)) };
  return { scheme: 'https', host: trimTrailingSlash(endpoint) };
}

/**
 * 公开性判定：有对象级 ACL 的云要求上传时快照为 public-read*；
 * 快照为 null（继承 Bucket / 旧数据）保守视为未知，不走公开直链。
 * 无对象级 ACL 概念的 provider（local/sftp/kodo/azure）信任管理员的策略配置。
 */
function publicAclAllowed(file: FileUrlSource): boolean {
  if (!FILE_OBJECT_ACL_SUPPORT[file.provider]) return true;
  return file.objectAcl === 'public-read' || file.objectAcl === 'public-read-write';
}

/** 按 provider 拼接永久公开直链；无法构造时返回 null。config 需已被 withFileBucket 处理。 */
function buildPublicObjectUrl(config: FileStorageConfigRow, objectKey: string): string | null {
  const key = encodeObjectKey(objectKey);
  if (config.publicBaseUrl) return `${trimTrailingSlash(config.publicBaseUrl)}/${key}`;
  switch (config.provider) {
    case 'oss': {
      if (!config.ossBucket || !config.ossEndpoint) return null;
      const { scheme, host } = splitEndpoint(config.ossEndpoint);
      return `${scheme}://${config.ossBucket}.${host}/${key}`;
    }
    case 's3': {
      if (!config.s3Bucket) return null;
      if (config.s3Endpoint) {
        const { scheme, host } = splitEndpoint(config.s3Endpoint);
        return config.s3ForcePathStyle
          ? `${scheme}://${host}/${config.s3Bucket}/${key}`
          : `${scheme}://${config.s3Bucket}.${host}/${key}`;
      }
      return config.s3Region ? `https://${config.s3Bucket}.s3.${config.s3Region}.amazonaws.com/${key}` : null;
    }
    case 'cos':
      return config.cosBucket && config.cosRegion
        ? `https://${config.cosBucket}.cos.${config.cosRegion}.myqcloud.com/${key}`
        : null;
    case 'obs': {
      if (!config.obsBucket || !config.obsEndpoint) return null;
      const { scheme, host } = splitEndpoint(config.obsEndpoint);
      return `${scheme}://${config.obsBucket}.${host}/${key}`;
    }
    case 'kodo': {
      // kodoEndpoint 即下载域名（与 readStoredFile 的私有下载一致）
      if (!config.kodoEndpoint) return null;
      const { scheme, host } = splitEndpoint(config.kodoEndpoint);
      return `${scheme}://${host}/${key}`;
    }
    case 'bos': {
      if (!config.bosBucket || !config.bosEndpoint) return null;
      const { scheme, host } = splitEndpoint(config.bosEndpoint);
      return `${scheme}://${config.bosBucket}.${host}/${key}`;
    }
    case 'azure': {
      if (!config.azureAccountName || !config.azureContainerName) return null;
      const base = config.azureEndpoint || `https://${config.azureAccountName}.blob.core.windows.net`;
      return `${trimTrailingSlash(base)}/${config.azureContainerName}/${key}`;
    }
    case 'sftp':
      return config.sftpBaseUrl ? `${trimTrailingSlash(config.sftpBaseUrl)}/${key}` : null;
    default:
      return null;
  }
}

/**
 * 用官方 SDK 本地签发临时下载直链（不发网络请求）；local/sftp 等不支持的返回 null。
 * config 需已被 withFileBucket 处理。
 */
async function presignObjectUrl(
  config: FileStorageConfigRow,
  objectKey: string,
  expirySeconds: number,
  contentDisposition?: string,
): Promise<string | null> {
  switch (config.provider) {
    case 'oss': {
      const client = createOssClient(config);
      return client.signatureUrl(objectKey, {
        expires: expirySeconds,
        ...(contentDisposition ? { response: { 'content-disposition': contentDisposition } } : {}),
      });
    }
    case 's3': {
      const client = createS3Client(config);
      return getSignedUrl(client, new GetObjectCommand({
        Bucket: config.s3Bucket!,
        Key: objectKey,
        ...(contentDisposition ? { ResponseContentDisposition: contentDisposition } : {}),
      }), { expiresIn: expirySeconds });
    }
    case 'cos': {
      const cos = createCosClient(config);
      return new Promise<string>((resolve, reject) => {
        cos.getObjectUrl(
          { Bucket: config.cosBucket!, Region: config.cosRegion!, Key: objectKey, Sign: true, Expires: expirySeconds },
          (err, data) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(data.Url)),
        );
      });
    }
    case 'obs': {
      const obs = createObsClient(config) as ObsClientType & {
        createSignedUrlSync(params: Record<string, unknown>): { SignedUrl: string };
      };
      return obs.createSignedUrlSync({ Method: 'GET', Bucket: config.obsBucket!, Key: objectKey, Expires: expirySeconds }).SignedUrl;
    }
    case 'kodo': {
      const domain = config.publicBaseUrl || config.kodoEndpoint;
      if (!domain) return null;
      const { mac, conf } = createKodoUploader(config);
      const bucketManager = new qiniu.rs.BucketManager(mac, conf);
      const { scheme, host } = splitEndpoint(domain);
      return bucketManager.privateDownloadUrl(`${scheme}://${host}`, objectKey, Math.floor(Date.now() / 1000) + expirySeconds);
    }
    case 'bos': {
      const bosClient = createBosClient(config) as unknown as BosStreamClient;
      return bosClient.generatePresignedUrl(config.bosBucket!, objectKey, Math.floor(Date.now() / 1000), expirySeconds);
    }
    case 'azure': {
      const containerClient = createAzureBlobClient(config);
      const blockBlobClient = containerClient.getBlockBlobClient(objectKey);
      return blockBlobClient.generateSasUrl({
        permissions: BlobSASPermissions.parse('r'),
        expiresOn: new Date(Date.now() + expirySeconds * 1000),
        ...(contentDisposition ? { contentDisposition } : {}),
      });
    }
    default:
      return null;
  }
}

/**
 * public 策略下的永久公开直链；策略不符 / ACL 不允许 / 无法拼接时返回 null。
 * 结果永久有效，可进入列表 DTO 的 directUrl 字段（仅渲染用，禁止持久化）。
 */
export function buildPublicFileUrl(file: FileUrlSource, config?: FileStorageConfigRow): string | null {
  if (config?.urlStrategy !== 'public' || !publicAclAllowed(file)) return null;
  return buildPublicObjectUrl(withFileBucket(file, config), file.objectKey);
}

/**
 * 按存储配置的 urlStrategy 解析文件访问地址，降级链：public → presigned → proxy。
 * presigned 结果含过期时间，禁止长期缓存；签名失败（配置不完整/SDK 异常）自动降级 proxy。
 */
export async function resolveFileAccessUrl(
  file: FileUrlSource,
  config: FileStorageConfigRow,
  options?: { contentDisposition?: string },
): Promise<FileAccessUrlResult> {
  const effective = withFileBucket(file, config);
  const strategy = config.urlStrategy;
  if (strategy === 'public' && publicAclAllowed(file)) {
    const url = buildPublicObjectUrl(effective, file.objectKey);
    if (url) return { url, strategy: 'public', expiresAt: null };
  }
  if (strategy === 'public' || strategy === 'presigned') {
    const expirySeconds = config.presignedExpirySeconds || 1800;
    try {
      const url = await presignObjectUrl(effective, file.objectKey, expirySeconds, options?.contentDisposition);
      if (url) return { url, strategy: 'presigned', expiresAt: new Date(Date.now() + expirySeconds * 1000) };
    } catch (err) {
      logger.warn(`文件直链签名失败，降级为服务端代理（file=${file.id} provider=${file.provider}）: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { url: buildManagedFileProxyUrl(file.id), strategy: 'proxy', expiresAt: null };
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

/**
 * 将云厂商「拒绝设置对象 ACL」的已知错误映射为友好业务错误，其余原样返回。
 * 覆盖：阿里云 OSS 阻止公共访问（ecCode 0016-00000901）、AWS S3 桶禁用 ACL（Bucket owner enforced）。
 */
export function mapObjectAclError(err: unknown): unknown {
  const message = String((err as { message?: unknown })?.message ?? '');
  const name = String((err as { name?: unknown })?.name ?? '');
  const code = String((err as { code?: unknown })?.code ?? '');
  if (message.includes('Put public object acl is not allowed')) {
    return new HTTPException(400, { message: 'Bucket 已开启「阻止公共访问」防护，禁止上传公共读/公共读写文件；请在云控制台关闭该防护，或将文件配置的读写权限改为「私有 / 继承 Bucket」' });
  }
  if (name === 'AccessControlListNotSupported' || code === 'AccessControlListNotSupported') {
    return new HTTPException(400, { message: '目标桶已禁用 ACL（Object Ownership 为 Bucket owner enforced），无法按对象设置读写权限；请在桶设置中启用 ACL，或将文件配置的读写权限改为「继承 Bucket」' });
  }
  return err;
}

/** 按存储配置上传一个对象（参数化 objectKey + Node 流），供简单上传与分片合并复用 */
export async function uploadObjectByConfig(config: FileStorageConfigRow, input: UploadObjectInput): Promise<void> {
  try {
    await doUploadObjectByConfig(config, input);
  } catch (err) {
    throw mapObjectAclError(err);
  }
}

async function doUploadObjectByConfig(config: FileStorageConfigRow, input: UploadObjectInput): Promise<void> {
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
