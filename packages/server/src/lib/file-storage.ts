import type OSS from 'ali-oss';
import type * as QiniuTypes from 'qiniu';
import SftpClient from 'ssh2-sftp-client';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, createWriteStream } from 'node:fs';
import { Readable, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { FileStorageConfigRow, ManagedFileRow } from '../db/schema';
import { FILE_OBJECT_ACL_SUPPORT, type FileBucketAcl } from '@zenith/shared/platform';
import { trimTrailingSlash } from '@zenith/shared/core';
import { HTTPException } from 'hono/http-exception';
import { formatDate } from './datetime';
import { httpDelete, httpGet, httpPost, httpPut } from './http-client';
import logger from './logger';

// 惰性加载：各云存储 SDK 模块图大（Azure/ali-oss 实测 1.5-2.3s），仅在首次使用对应存储类型时加载。
// require() 返回 CJS module.exports 原对象，dev(tsx) 与 prod(node dist) 语义一致。
const require = createRequire(import.meta.url);
const loadOss = () => require('ali-oss') as typeof import('ali-oss');
const loadS3 = () => require('@aws-sdk/client-s3') as typeof import('@aws-sdk/client-s3');
const loadS3Control = () => require('@aws-sdk/client-s3-control') as typeof import('@aws-sdk/client-s3-control');
const loadS3Presigner = () => require('@aws-sdk/s3-request-presigner') as typeof import('@aws-sdk/s3-request-presigner');
const loadCos = () => require('cos-nodejs-sdk-v5') as typeof import('cos-nodejs-sdk-v5');
const loadQiniu = () => require('qiniu') as typeof import('qiniu');
const loadBaiduBce = () => require('@baiducloud/sdk') as typeof import('@baiducloud/sdk');
const loadAzureBlob = () => require('@azure/storage-blob') as typeof import('@azure/storage-blob');
const loadAzureIdentity = () => require('@azure/identity') as typeof import('@azure/identity');
const loadAzureArmStorage = () => require('@azure/arm-storage') as typeof import('@azure/arm-storage');

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
  return new (loadOss())({
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

// ─── Bucket / Container 级权限探测与设置 ─────────────────────────────────────

export interface FileBucketAccessInfo {
  bucketAcl: FileBucketAcl | null;
  blockPublicAccess: boolean | null;
  /** Bucket Policy 是否允许匿名公共访问；null = 未探测或 provider 未提供该状态 */
  policyPublic: boolean | null;
  /** provider 返回的综合公共访问状态；null = 未探测或 provider 未提供该接口 */
  publicStatus: boolean | null;
  /** 账号级阻止公共访问；null = 未探测或 provider 未提供该接口 */
  accountBlockPublicAccess: boolean | null;
  effectivePublic: boolean;
  checkedAt: Date;
}

function nestedBoolean(source: unknown, keys: string[]): boolean | null {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = toBooleanOrNull(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function jsonPolicyAllowsPublic(policy: unknown): boolean | null {
  if (!policy || typeof policy !== 'object') return null;
  const raw = (policy as { Statement?: unknown }).Statement ?? policy;
  const statements = Array.isArray(raw) ? raw : [raw];
  for (const statement of statements) {
    if (!statement || typeof statement !== 'object') continue;
    const value = statement as Record<string, unknown>;
    if (String(value.Effect ?? '').toLowerCase() !== 'allow') continue;
    const principal = value.Principal;
    const principalPublic = principal === '*'
      || (Array.isArray(principal) && principal.includes('*'))
      || (principal && typeof principal === 'object'
        && Object.values(principal as Record<string, unknown>).some((entry) => Array.isArray(entry) && entry.includes('*')));
    if (!principalPublic) continue;
    const actions = Array.isArray(value.Action) ? value.Action : [value.Action];
    const canRead = actions.some((action) => {
      const text = String(action ?? '').toLowerCase();
      return text === '*' || text === 'cos:*' || text === 'getobject' || text.endsWith(':getobject');
    });
    if (!canRead) continue;
    // 任何 Condition 都可能限制匿名访问范围；无法仅凭策略断言完全公开。
    if (value.Condition && typeof value.Condition === 'object' && Object.keys(value.Condition).length > 0) return null;
    return true;
  }
  return false;
}

function publicAccessBlockEnabled(source: unknown): boolean | null {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;
  const configuration = (record.PublicAccessBlockConfiguration ?? record) as Record<string, unknown>;
  const keys = ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'];
  if (!keys.some((key) => key in configuration)) return null;
  return Boolean(configuration.BlockPublicAcls
    || configuration.IgnorePublicAcls
    || configuration.BlockPublicPolicy
    || configuration.RestrictPublicBuckets);
}

function normalizeBucketAcl(value: unknown): FileBucketAcl | null {
  return value === 'private' || value === 'public-read' || value === 'public-read-write' ? value : null;
}

const kodoZones = new Map<string, Promise<QiniuTypes.conf.Zone>>();

function toBooleanOrNull(value: unknown): boolean | null {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

/** 读取 Bucket / Container 的公共访问状态；不支持的 provider 抛业务错误。 */
export async function getBucketAccessInfo(config: FileStorageConfigRow): Promise<FileBucketAccessInfo> {
  if (config.provider === 'oss') {
    const client = createOssClient(config);
    const info = await client.getBucketInfo(config.ossBucket!);
    const bucket = (info as { bucket?: Record<string, unknown> }).bucket ?? info as Record<string, unknown>;
    const acl = normalizeBucketAcl((bucket.AccessControlList as { Grant?: unknown } | undefined)?.Grant);
    const oss = client as unknown as {
      request(params: Record<string, unknown>): Promise<{ data?: Buffer | string }>;
      parseXML(value: Buffer | string): Promise<Record<string, unknown>>;
    };
    let accountBlockPublicAccess: boolean | null;
    try {
      const accountResult = await oss.request({
        method: 'GET',
        subres: 'publicAccessBlock',
        successStatuses: [200],
      });
      const accountParsed = accountResult.data ? await oss.parseXML(accountResult.data) : {};
      const accountPolicy = (accountParsed.PublicAccessBlockConfiguration ?? accountParsed) as Record<string, unknown>;
      accountBlockPublicAccess = toBooleanOrNull(accountPolicy?.BlockPublicAccess);
    } catch {
      accountBlockPublicAccess = null;
    }
    let blockPublicAccess: boolean | null;
    let policyPublic: boolean | null;
    try {
      const result = await oss.request({
        method: 'GET',
        bucket: config.ossBucket!,
        subres: 'publicAccessBlock',
        successStatuses: [200],
      });
      const parsed = result.data ? await oss.parseXML(result.data) : {};
      const policy = (parsed.PublicAccessBlockConfiguration ?? parsed) as Record<string, unknown>;
      blockPublicAccess = toBooleanOrNull(policy?.BlockPublicAccess);
    } catch (error) {
      if ((error as { code?: string }).code === 'NoSuchPublicAccessBlockConfiguration') blockPublicAccess = false;
      else throw error;
    }
    try {
      const policyResult = await oss.request({
        method: 'GET',
        bucket: config.ossBucket!,
        subres: 'policyStatus',
        successStatuses: [200],
      });
      const policyParsed = policyResult.data ? await oss.parseXML(policyResult.data) : {};
      const status = (policyParsed.PolicyStatus ?? policyParsed) as Record<string, unknown>;
      policyPublic = nestedBoolean(status, ['IsPublic']);
    } catch {
      policyPublic = null;
    }
    const aclPublic = acl === 'public-read' || acl === 'public-read-write';
    return {
      bucketAcl: acl,
      blockPublicAccess,
      policyPublic,
      publicStatus: null,
      accountBlockPublicAccess,
      effectivePublic: accountBlockPublicAccess !== true
        && (aclPublic || policyPublic === true)
        && blockPublicAccess === false,
      checkedAt: new Date(),
    };
  }
  if (config.provider === 's3') {
    const client = createS3Client(config);
    const s3 = loadS3();
    const aclResult = await client.send(new s3.GetBucketAclCommand({ Bucket: config.s3Bucket! }));
    const grants = aclResult.Grants ?? [];
    const publicGrants = grants.filter((grant) => String(grant.Grantee?.URI ?? '').includes('AllUsers'));
    const publicRead = publicGrants.some((grant) => grant.Permission === 'READ' || grant.Permission === 'FULL_CONTROL');
    const publicWrite = publicGrants.some((grant) => grant.Permission === 'WRITE' || grant.Permission === 'FULL_CONTROL');
    const acl: FileBucketAcl | null = publicRead && publicWrite ? 'public-read-write' : publicRead ? 'public-read' : publicGrants.length > 0 ? null : 'private';
    let blockPublicAccess: boolean | null;
    try {
      const pab = await client.send(new s3.GetPublicAccessBlockCommand({ Bucket: config.s3Bucket! }));
      const value = pab.PublicAccessBlockConfiguration;
      blockPublicAccess = Boolean(value?.BlockPublicAcls || value?.IgnorePublicAcls || value?.BlockPublicPolicy || value?.RestrictPublicBuckets);
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchPublicAccessBlockConfiguration') blockPublicAccess = false;
      else blockPublicAccess = null;
    }
    let policyPublic: boolean | null = null;
    try {
      const policy = await client.send(new s3.GetBucketPolicyStatusCommand({ Bucket: config.s3Bucket! }));
      policyPublic = policy.PolicyStatus?.IsPublic ?? null;
    } catch (err) {
      if ((err as { name?: string }).name !== 'NoSuchBucketPolicy') policyPublic = null;
    }
    let accountBlockPublicAccess: boolean | null = null;
    if (config.s3AccountId && !config.s3Endpoint) {
      try {
        const control = createS3ControlClient(config);
        const controlSdk = loadS3Control();
        const pab = await control.send(new controlSdk.GetPublicAccessBlockCommand({ AccountId: config.s3AccountId }));
        const value = pab.PublicAccessBlockConfiguration;
        accountBlockPublicAccess = Boolean(value?.BlockPublicAcls
          || value?.IgnorePublicAcls
          || value?.BlockPublicPolicy
          || value?.RestrictPublicBuckets);
      } catch {
        accountBlockPublicAccess = null;
      }
    }
    return {
      bucketAcl: acl,
      blockPublicAccess,
      policyPublic,
      publicStatus: null,
      accountBlockPublicAccess,
      effectivePublic: accountBlockPublicAccess !== true
        && (publicRead || policyPublic === true)
        && blockPublicAccess === false,
      checkedAt: new Date(),
    };
  }
  if (config.provider === 'cos') {
    const cos = createCosClient(config);
    const result = await new Promise<{ ACL?: string }>((resolve, reject) => {
      cos.getBucketAcl({ Bucket: config.cosBucket!, Region: config.cosRegion! }, (err, data) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve(data as { ACL?: string });
      });
    });
    const acl = normalizeBucketAcl(result.ACL);
    let policyPublic: boolean | null;
    try {
      const policy = await new Promise<{ Policy?: unknown }>((resolve, reject) => {
        cos.getBucketPolicy({ Bucket: config.cosBucket!, Region: config.cosRegion! }, (err, data) => {
          if (err) reject(err instanceof Error ? err : new Error(String(err)));
          else resolve(data as { Policy?: unknown });
        });
      });
      policyPublic = jsonPolicyAllowsPublic(policy.Policy);
    } catch (error) {
      const code = String((error as { code?: unknown }).code ?? '');
      policyPublic = code.includes('NoSuch') ? false : null;
    }
    const aclPublic = acl === 'public-read' || acl === 'public-read-write';
    return {
      bucketAcl: acl,
      blockPublicAccess: null,
      policyPublic,
      publicStatus: null,
      accountBlockPublicAccess: null,
      effectivePublic: aclPublic || policyPublic === true,
      checkedAt: new Date(),
    };
  }
  if (config.provider === 'bos') {
    const bos = createBosClient(config) as unknown as {
      getBucketAcl(bucket: string): Promise<{ body?: { accessControlList?: Array<{ grantee?: Array<{ id?: string }>; permission?: string[] }> } }>;
    };
    const result = await bos.getBucketAcl(config.bosBucket!);
    const entries = result.body?.accessControlList ?? [];
    const publicGrants = entries.filter((entry) => entry.grantee?.some((g) => g.id === 'AllUsers'));
    const publicRead = publicGrants.some((entry) => entry.permission?.some((permission) => permission === 'READ' || permission === 'FULL_CONTROL'));
    const publicWrite = publicGrants.some((entry) => entry.permission?.some((permission) => permission === 'WRITE' || permission === 'FULL_CONTROL'));
    const acl: FileBucketAcl | null = publicRead && publicWrite ? 'public-read-write' : publicRead ? 'public-read' : publicGrants.length > 0 ? null : 'private';
    let policyPublic: boolean | null;
    try {
      const client = createBosClient(config) as unknown as {
        sendRequest(method: string, params: { bucketName: string; params: Record<string, string> }): Promise<{ body?: unknown }>;
      };
      const result = await client.sendRequest('GET', { bucketName: config.bosBucket!, params: { policy: '' } });
      const raw = result.body;
      const policy = typeof raw === 'string' ? JSON.parse(raw) : (raw as { policy?: unknown } | undefined)?.policy ?? raw;
      policyPublic = jsonPolicyAllowsPublic(policy);
    } catch (error) {
      const code = String((error as { code?: unknown }).code ?? '');
      policyPublic = code.includes('NoSuch') ? false : null;
    }
    return {
      bucketAcl: acl,
      blockPublicAccess: null,
      policyPublic,
      publicStatus: null,
      accountBlockPublicAccess: null,
      effectivePublic: publicRead || policyPublic === true,
      checkedAt: new Date(),
    };
  }
  if (config.provider === 'kodo') {
    const { mac, conf } = createKodoUploader(config);
    const bucketManager = new (loadQiniu().rs.BucketManager)(mac, conf);
    const result = await bucketManager.getBucketInfo(config.kodoBucket!);
    const data = (result as unknown as {
      data?: { private?: number | string; anti_leech_mode?: number | string; token_anti_leech?: number | string };
    }).data;
    const accessMode = Number(data?.private);
    const antiLeech = Number(data?.anti_leech_mode) > 0 || Number(data?.token_anti_leech) > 0;
    const acl: FileBucketAcl | null = accessMode === 1 ? 'private' : accessMode === 0 ? 'public-read' : null;
    const publicStatus = accessMode === 0 && !antiLeech;
    return {
      bucketAcl: acl,
      blockPublicAccess: null,
      policyPublic: null,
      publicStatus,
      accountBlockPublicAccess: null,
      effectivePublic: publicStatus,
      checkedAt: new Date(),
    };
  }
  if (config.provider === 'azure') {
    const properties = await createAzureBlobClient(config).getProperties();
    const access = (properties as unknown as { blobPublicAccess?: string }).blobPublicAccess;
    const publicAccess = access === 'container' || access === 'blob';
    const acl: FileBucketAcl = publicAccess ? 'public-read' : 'private';
    let accountBlockPublicAccess: boolean | null = null;
    if (config.azureTenantId && config.azureClientId && config.azureClientSecret
      && config.azureSubscriptionId && config.azureResourceGroup && config.azureAccountName) {
      try {
        const { ClientSecretCredential } = loadAzureIdentity();
        const { StorageManagementClient } = loadAzureArmStorage();
        const cloudSetting = config.azureCloud === 'china'
          ? 'AZURE_CHINA_CLOUD'
          : config.azureCloud === 'us-government'
            ? 'AZURE_US_GOVERNMENT'
            : 'AZURE_PUBLIC_CLOUD';
        const authorityHost = config.azureCloud === 'china'
          ? 'https://login.chinacloudapi.cn'
          : config.azureCloud === 'us-government'
            ? 'https://login.microsoftonline.us'
            : 'https://login.microsoftonline.com';
        const credential = new ClientSecretCredential(
          config.azureTenantId,
          config.azureClientId,
          config.azureClientSecret,
          { authorityHost },
        );
        const management = new StorageManagementClient(credential, config.azureSubscriptionId, {
          cloudSetting: cloudSetting as never,
        });
        const account = await management.storageAccounts.getProperties(
          config.azureResourceGroup,
          config.azureAccountName,
        );
        accountBlockPublicAccess = account.allowBlobPublicAccess === false
          ? true
          : account.allowBlobPublicAccess === true ? false : null;
      } catch {
        accountBlockPublicAccess = null;
      }
    }
    return {
      bucketAcl: acl,
      blockPublicAccess: null,
      policyPublic: null,
      publicStatus: null,
      accountBlockPublicAccess,
      effectivePublic: accountBlockPublicAccess !== true && publicAccess,
      checkedAt: new Date(),
    };
  }
  if (config.provider === 'obs') {
    const obs = createObsClient(config) as unknown as Record<string, unknown> & {
      getBucketAcl(params: Record<string, unknown>, cb: (err: unknown, result: { InterfaceResult?: { AccessControlList?: { Grants?: Array<{ Grantee?: { Type?: string; URI?: string }; Permission?: string }> } } }) => void): void;
    };
    const result = await new Promise<{ AccessControlList?: { Grants?: Array<{ Grantee?: { Type?: string; URI?: string }; Permission?: string }> } }>((resolve, reject) => {
      obs.getBucketAcl({ Bucket: config.obsBucket! }, (err, data) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve(data.InterfaceResult ?? {});
      });
    });
    const grants = result.AccessControlList?.Grants ?? [];
    const publicGrants = grants.filter((grant) => grant.Grantee?.URI?.includes('AllUsers'));
    const publicRead = publicGrants.some((grant) => grant.Permission === 'READ' || grant.Permission === 'FULL_CONTROL');
    const publicWrite = publicGrants.some((grant) => grant.Permission === 'WRITE' || grant.Permission === 'FULL_CONTROL');
    const acl: FileBucketAcl | null = publicRead && publicWrite ? 'public-read-write' : publicRead ? 'public-read' : publicGrants.length > 0 ? null : 'private';

    const optional = async (method: string): Promise<Record<string, unknown> | null> => {
      const fn = obs[method];
      if (typeof fn !== 'function') return null;
      return new Promise((resolve) => {
        (fn as (params: Record<string, unknown>, cb: (err: unknown, data?: { InterfaceResult?: Record<string, unknown> }) => void) => void)
          .call(obs, { Bucket: config.obsBucket! }, (err, data) => {
            if (err) resolve(null);
            else resolve(data?.InterfaceResult ?? null);
          });
      });
    };
    const bpa = await optional('getBucketPublicAccessBlock');
    const policy = await optional('getBucketPolicyPublicStatus');
    const status = await optional('getBucketPublicStatus');
    const blockPublicAccess = publicAccessBlockEnabled(bpa);
    const policyPublic = nestedBoolean(policy, ['IsPublic'])
      ?? nestedBoolean((policy?.PolicyStatus as Record<string, unknown> | undefined), ['IsPublic']);
    const publicStatus = nestedBoolean(status, ['IsPublic'])
      ?? nestedBoolean((status?.BucketStatus as Record<string, unknown> | undefined), ['IsPublic']);
    return {
      bucketAcl: acl,
      blockPublicAccess,
      policyPublic,
      publicStatus,
      accountBlockPublicAccess: null,
      effectivePublic: publicStatus ?? ((publicRead || policyPublic === true) && blockPublicAccess === false),
      checkedAt: new Date(),
    };
  }
  throw new HTTPException(400, { message: `当前存储类型不支持 Bucket 权限探测：${config.provider}` });
}

/** 修改 Bucket / Container 的 ACL 或阻止公共访问开关；调用方负责权限与审计。 */
export async function setBucketAccessInfo(
  config: FileStorageConfigRow,
  input: { acl?: FileBucketAcl; blockPublicAccess?: boolean },
): Promise<FileBucketAccessInfo> {
  if (config.provider === 'oss') {
    const client = createOssClient(config);
    const setBlockPublicAccess = async (enabled: boolean) => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?><PublicAccessBlockConfiguration><BlockPublicAccess>${enabled}</BlockPublicAccess></PublicAccessBlockConfiguration>`;
      await (client as unknown as { request(params: Record<string, unknown>): Promise<unknown> }).request({
        method: 'PUT',
        bucket: config.ossBucket!,
        subres: 'publicAccessBlock',
        headers: { 'Content-Type': 'application/xml' },
        content: xml,
        successStatuses: [200],
      });
    };
    if (input.blockPublicAccess === false) await setBlockPublicAccess(false);
    if (input.acl) await client.putBucketACL(config.ossBucket!, input.acl);
    if (input.blockPublicAccess === true) await setBlockPublicAccess(true);
    return getBucketAccessInfo(config);
  }
  if (config.provider === 's3') {
    const client = createS3Client(config);
    const s3 = loadS3();
    const setPublicAccessBlock = (enabled: boolean) => client.send(new s3.PutPublicAccessBlockCommand({
      Bucket: config.s3Bucket!,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: enabled,
        IgnorePublicAcls: enabled,
        BlockPublicPolicy: enabled,
        RestrictPublicBuckets: enabled,
      },
    }));
    if (input.blockPublicAccess === false) await setPublicAccessBlock(false);
    if (input.acl) {
      if (input.blockPublicAccess !== false) {
        const publicAcl = input.acl === 'public-read' || input.acl === 'public-read-write';
        if (publicAcl) {
          const current = await getBucketAccessInfo(config);
          if (current.blockPublicAccess === true) {
            throw new HTTPException(400, { message: '请先关闭 S3 Bucket 的阻止公共访问，再设置公共 ACL' });
          }
        }
      }
      await client.send(new s3.PutBucketAclCommand({ Bucket: config.s3Bucket!, ACL: input.acl }));
    }
    if (input.blockPublicAccess === true) await setPublicAccessBlock(true);
    return getBucketAccessInfo(config);
  }
  if (config.provider === 'cos') {
    if (!input.acl) throw new HTTPException(400, { message: 'COS 仅支持修改 Bucket ACL' });
    const cos = createCosClient(config);
    await new Promise<void>((resolve, reject) => {
      cos.putBucketAcl({ Bucket: config.cosBucket!, Region: config.cosRegion!, ACL: input.acl as never }, (err) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve();
      });
    });
    return getBucketAccessInfo(config);
  }
  if (config.provider === 'bos') {
    if (!input.acl) throw new HTTPException(400, { message: 'BOS 仅支持修改 Bucket ACL' });
    const bos = createBosClient(config) as unknown as { putBucketAcl(bucket: string, acl: string): Promise<unknown> };
    await bos.putBucketAcl(config.bosBucket!, input.acl);
    return getBucketAccessInfo(config);
  }
  if (config.provider === 'kodo') {
    if (!input.acl) throw new HTTPException(400, { message: '七牛云仅支持修改 Bucket 访问模式' });
    if (input.acl === 'public-read-write') throw new HTTPException(400, { message: '七牛云不支持 Bucket 公共写' });
    const { mac, conf } = createKodoUploader(config);
    const bucketManager = new (loadQiniu().rs.BucketManager)(mac, conf);
    await bucketManager.putBucketAccessMode(config.kodoBucket!, { private: input.acl === 'private' ? 1 : 0 });
    return getBucketAccessInfo(config);
  }
  if (config.provider === 'azure') {
    if (!input.acl) throw new HTTPException(400, { message: 'Azure 仅支持修改 Container 访问级别' });
    if (input.acl === 'public-read-write') throw new HTTPException(400, { message: 'Azure Blob 不支持 Container 公共写' });
    await createAzureBlobClient(config).setAccessPolicy(input.acl === 'private' ? undefined : 'blob');
    return getBucketAccessInfo(config);
  }
  if (config.provider === 'obs') {
    if (!input.acl && input.blockPublicAccess === undefined) {
      throw new HTTPException(400, { message: 'OBS 需要提供 Bucket ACL 或阻止公共访问设置' });
    }
    const obs = createObsClient(config) as unknown as Record<string, unknown> & {
      setBucketAcl(params: Record<string, unknown>, cb: (err: unknown) => void): void;
    };
    const setBlockPublicAccess = async (enabled: boolean) => {
      // 关闭 BPA 使用 DeleteBucketPublicAccessBlock；Put 全 false 在 OBS 上可能被视为空配置。
      const method = enabled ? 'putBucketPublicAccessBlock' : 'deleteBucketPublicAccessBlock';
      const fn = obs[method];
      if (typeof fn !== 'function') throw new HTTPException(400, { message: '当前 OBS SDK 不支持阻止公共访问设置' });
      await new Promise<void>((resolve, reject) => {
        (fn as (params: Record<string, unknown>, cb: (err: unknown) => void) => void)
          .call(obs, {
            Bucket: config.obsBucket!,
            ...(enabled ? {
              BlockPublicAcls: true,
              IgnorePublicAcls: true,
              BlockPublicPolicy: true,
              RestrictPublicBuckets: true,
            } : {}),
          }, (err) => {
            if (err) reject(err instanceof Error ? err : new Error(String(err)));
            else resolve();
          });
      });
    };
    if (input.blockPublicAccess === false) await setBlockPublicAccess(false);
    if (input.acl) {
      if (input.blockPublicAccess !== false && (input.acl === 'public-read' || input.acl === 'public-read-write')) {
        const current = await getBucketAccessInfo(config);
        if (current.blockPublicAccess === true) {
          throw new HTTPException(400, { message: '请先关闭 OBS Bucket 的阻止公共访问，再设置公共 ACL' });
        }
      }
      await new Promise<void>((resolve, reject) => {
        obs.setBucketAcl({ Bucket: config.obsBucket!, ACL: input.acl }, (err) => {
          if (err) reject(err instanceof Error ? err : new Error(String(err)));
          else resolve();
        });
      });
    }
    if (input.blockPublicAccess === true) await setBlockPublicAccess(true);
    return getBucketAccessInfo(config);
  }
  throw new HTTPException(400, { message: `当前存储类型不支持 Bucket 权限设置：${config.provider}` });
}

function createS3Client(config: FileStorageConfigRow) {
  if (!config.s3Region || !config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey) {
    throw new Error('S3 配置不完整');
  }
  return new (loadS3().S3Client)({
    region: config.s3Region,
    ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : {}),
    credentials: {
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    },
    forcePathStyle: config.s3ForcePathStyle ?? false,
  });
}

function createS3ControlClient(config: FileStorageConfigRow) {
  if (!config.s3Region || !config.s3AccountId || !config.s3AccessKeyId || !config.s3SecretAccessKey) {
    throw new Error('S3 Control 配置不完整');
  }
  return new (loadS3Control().S3ControlClient)({
    region: config.s3Region,
    credentials: {
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    },
  });
}

function createCosClient(config: FileStorageConfigRow) {
  if (!config.cosRegion || !config.cosBucket || !config.cosSecretId || !config.cosSecretKey) {
    throw new Error('腾讯云 COS 配置不完整');
  }
  return new (loadCos())({
    SecretId: config.cosSecretId,
    SecretKey: config.cosSecretKey,
  });
}

function createObsClient(config: FileStorageConfigRow): ObsClientType {
  if (!config.obsEndpoint || !config.obsBucket || !config.obsAccessKeyId || !config.obsSecretAccessKey) {
    throw new Error('华为云 OBS 配置不完整');
  }
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
  const qiniu = loadQiniu();
  const mac = new qiniu.auth.digest.Mac(config.kodoAccessKey, config.kodoSecretKey);
  const putPolicy = new qiniu.rs.PutPolicy({ scope: config.kodoBucket });
  const uploadToken = putPolicy.uploadToken(mac);
  const zone = config.kodoRegion
    ? (qiniu.zone as Record<string, unknown>)[config.kodoRegion] as QiniuTypes.conf.Zone | undefined
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
  const { BosClient } = loadBaiduBce();
  return new BosClient(options as unknown as ConstructorParameters<typeof BosClient>[0]);
}

function createAzureBlobClient(config: FileStorageConfigRow) {
  if (!config.azureAccountName || !config.azureAccountKey || !config.azureContainerName) {
    throw new Error('Azure Blob 配置不完整');
  }
  const { BlobServiceClient, StorageSharedKeyCredential } = loadAzureBlob();
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
  /** 上传时快照：该对象当时是否可公共读取 */
  publicAccess?: boolean | null;
  /** 受控文件不允许生成公开直链；调用方必须走归属模块鉴权接口 */
  visibility?: 'public' | 'restricted' | null;
}

function encodeObjectKey(objectKey: string) {
  return objectKey.split('/').map(encodeURIComponent).join('/');
}

/** 拆出 endpoint 的协议与主机；无协议时默认 https */
function splitEndpoint(endpoint: string): { scheme: string; host: string } {
  const matched = /^(https?):\/\//.exec(endpoint);
  if (matched) return { scheme: matched[1], host: trimTrailingSlash(endpoint.slice(matched[0].length)) };
  return { scheme: 'https', host: trimTrailingSlash(endpoint) };
}

/**
 * 公开直链可用性：按配置声明的公共性来源判断，而不是只看对象 ACL。
 * - public-object：对象 ACL 为公共读；
 * - public-bucket：上传时快照确认 Bucket 公共读；
 * - public-domain：自定义域名 / CDN（或 Kodo/SFTP 自带的访问域名）。
 */
function bucketPublicBlockAllows(config: FileStorageConfigRow): boolean {
  if (config.bucketAccountBlockPublicAccess === true) return false;
  if (config.bucketPublicStatus === true) return true;
  if (config.provider === 'oss' || config.provider === 's3' || config.provider === 'obs') {
    return config.bucketBlockPublicAccess === false;
  }
  return config.bucketBlockPublicAccess !== true;
}

export function isPublicAccessAllowed(file: FileUrlSource, config: FileStorageConfigRow): boolean {
  if (file.visibility === 'restricted') return false;
  switch (config.accessStrategy) {
    case 'public-object':
      return (file.objectAcl === 'public-read' || file.objectAcl === 'public-read-write')
        && file.publicAccess === true
        && bucketPublicBlockAllows(config);
    case 'public-bucket':
      return file.publicAccess === true
        && (config.bucketAcl === 'public-read' || config.bucketAcl === 'public-read-write')
        && bucketPublicBlockAllows(config);
    case 'public-domain':
      return Boolean(config.publicBaseUrl?.trim())
        || (config.provider === 'kodo' && Boolean(config.kodoEndpoint))
        || (config.provider === 'sftp' && Boolean(config.sftpBaseUrl));
    default:
      return false;
  }
}

/**
 * 上传 / 初始化会话时计算公共可读快照。
 * public-bucket 依赖最近一次 Bucket 探测结果；未探测或探测结果不是公共读时返回 false。
 */
export function resolvePublicAccess(
  config: FileStorageConfigRow,
  objectAcl: 'default' | 'private' | 'public-read' | 'public-read-write' | null,
): boolean {
  switch (config.accessStrategy) {
    case 'public-object':
      return (objectAcl === 'public-read' || objectAcl === 'public-read-write')
        && bucketPublicBlockAllows(config);
    case 'public-bucket':
      return (config.bucketAcl === 'public-read' || config.bucketAcl === 'public-read-write')
        && bucketPublicBlockAllows(config);
    case 'public-domain':
      return Boolean(config.publicBaseUrl?.trim())
        || (config.provider === 'kodo' && Boolean(config.kodoEndpoint))
        || (config.provider === 'sftp' && Boolean(config.sftpBaseUrl));
    default:
      return false;
  }
}

/**
 * 浏览器直传目标：预签名 PUT URL + 必要请求头。
 * 公共对象 ACL 不放进签名头，完成上传后由服务端单独设置，避免不同 provider 的签名差异。
 */
export interface DirectUploadTarget {
  url: string;
  method: 'PUT';
  headers?: Record<string, string>;
  partTag?: string;
  expiresAt: Date;
}

/** 为指定云端 multipart 分片签发短期地址。 */
export async function createDirectPartTarget(
  config: FileStorageConfigRow,
  objectKey: string,
  uploadId: string,
  partNumber: number,
  expirySeconds: number,
): Promise<DirectUploadTarget> {
  const expiresAt = new Date(Date.now() + expirySeconds * 1000);
  const query = { uploadId, partNumber: String(partNumber) };
  switch (config.provider) {
    case 'kodo':
      return createKodoDirectPartTarget(config, objectKey, uploadId, partNumber, expirySeconds);
    case 'oss': {
      const url = createOssClient(config).signatureUrl(objectKey, {
        method: 'PUT', expires: expirySeconds, subResource: query,
      });
      return { url, method: 'PUT', expiresAt };
    }
    case 's3': {
      const { UploadPartCommand } = loadS3();
      const url = await loadS3Presigner().getSignedUrl(createS3Client(config), new UploadPartCommand({
        Bucket: config.s3Bucket!, Key: objectKey, UploadId: uploadId, PartNumber: partNumber,
      }), { expiresIn: expirySeconds });
      return { url, method: 'PUT', expiresAt };
    }
    case 'cos': {
      const cos = createCosClient(config);
      const url = await new Promise<string>((resolve, reject) => {
        cos.getObjectUrl({ Bucket: config.cosBucket!, Region: config.cosRegion!, Key: objectKey,
          Sign: false, Method: 'PUT', Query: query,
        }, (err, data) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(data.Url)));
      });
      const auth = cos.getAuth({
        Bucket: config.cosBucket!, Region: config.cosRegion!, Key: objectKey,
        Method: 'PUT', Expires: expirySeconds, Query: query,
      });
      const signedUrl = new URL(url);
      for (const [key, value] of new URLSearchParams(auth)) signedUrl.searchParams.set(key, value);
      return { url: signedUrl.toString(), method: 'PUT', expiresAt };
    }
    case 'obs': {
      const obs = createObsClient(config) as ObsClientType & { createSignedUrlSync(params: Record<string, unknown>): { SignedUrl: string } };
      const url = obs.createSignedUrlSync({ Method: 'PUT', Bucket: config.obsBucket!, Key: objectKey,
        Expires: expirySeconds, QueryParams: query }).SignedUrl;
      return { url, method: 'PUT', expiresAt };
    }
    case 'azure': {
      const blob = createAzureBlobClient(config).getBlockBlobClient(objectKey);
      const url = new URL(await blob.generateSasUrl({ permissions: loadAzureBlob().BlobSASPermissions.parse('cw'), expiresOn: expiresAt }));
      url.searchParams.set('comp', 'block');
      url.searchParams.set('blockid', makeAzureBlockId(partNumber));
      return { url: url.toString(), method: 'PUT', headers: { 'x-ms-version': '2021-12-02' }, partTag: makeAzureBlockId(partNumber), expiresAt };
    }
    case 'bos': {
      const timestamp = Math.floor(Date.now() / 1000);
      const client = createBosClient(config) as unknown as {
        generatePresignedUrl(bucket: string, key: string, timestamp: number, expiry: number, headers: Record<string, string>, params: Record<string, string>, headersToSign: string[]): string;
      };
      const url = new URL(client.generatePresignedUrl(config.bosBucket!, objectKey, timestamp, expirySeconds, {}, query, ['host']));
      url.searchParams.delete('authorization');
      const signedParams = Object.fromEntries(url.searchParams.entries());
      const Auth = require('@baiducloud/sdk/src/auth') as new (ak: string, sk: string) => {
        generateAuthorization(method: string, resource: string, params: Record<string, string>, headers: Record<string, string>, timestamp: number, expiry: number): string;
      };
      const auth = new Auth(config.bosAccessKeyId!, config.bosSecretAccessKey!);
      const signature = auth.generateAuthorization('PUT', url.pathname, signedParams, { Host: url.host }, timestamp, expirySeconds);
      url.searchParams.set('authorization', signature);
      return { url: url.toString(), method: 'PUT', expiresAt };
    }
    default:
      throw new HTTPException(400, { message: `当前存储类型不支持分片直传：${config.provider}` });
  }
}

export interface StoredObjectHead {
  size: number;
  mimeType: string | null;
  etag: string | null;
}

/** HEAD 直传完成后的对象，用于服务端校验大小/类型/ETag。 */
export async function headStoredObject(config: FileStorageConfigRow, objectKey: string): Promise<StoredObjectHead> {
  switch (config.provider) {
    case 'oss': {
      const client = createOssClient(config);
      const result = await client.head(objectKey);
      const headers = result.res.headers as Record<string, string | undefined>;
      return {
        size: Number(headers['content-length'] ?? 0),
        mimeType: headers['content-type'] ?? null,
        etag: headers.etag ?? null,
      };
    }
    case 's3': {
      const client = createS3Client(config);
      const { HeadObjectCommand } = loadS3();
      const result = await client.send(new HeadObjectCommand({ Bucket: config.s3Bucket!, Key: objectKey }));
      return {
        size: Number(result.ContentLength ?? 0),
        mimeType: result.ContentType ?? null,
        etag: result.ETag ?? null,
      };
    }
    case 'cos': {
      const cos = createCosClient(config);
      const result = await new Promise<{ headers?: Record<string, string> }>((resolve, reject) => {
        cos.headObject({ Bucket: config.cosBucket!, Region: config.cosRegion!, Key: objectKey }, (err, data) => {
          if (err) reject(err instanceof Error ? err : new Error(String(err)));
          else resolve(data as { headers?: Record<string, string> });
        });
      });
      const headers = result.headers ?? {};
      return {
        size: Number(headers['content-length'] ?? 0),
        mimeType: headers['content-type'] ?? null,
        etag: headers.etag ?? null,
      };
    }
    case 'obs': {
      const obs = createObsClient(config) as ObsClientType & {
        getObjectMetadata(params: Record<string, unknown>, cb: (err: unknown, result: { InterfaceResult?: { ContentLength?: number; ContentType?: string; ETag?: string } }) => void): void;
      };
      const result = await new Promise<{ ContentLength?: number; ContentType?: string; ETag?: string }>((resolve, reject) => {
        obs.getObjectMetadata({ Bucket: config.obsBucket!, Key: objectKey }, (err, data) => {
          if (err) reject(err instanceof Error ? err : new Error(String(err)));
          else resolve(data.InterfaceResult ?? {});
        });
      });
      return {
        size: Number(result.ContentLength ?? 0),
        mimeType: result.ContentType ?? null,
        etag: result.ETag ?? null,
      };
    }
    case 'azure': {
      const containerClient = createAzureBlobClient(config);
      const properties = await containerClient.getBlockBlobClient(objectKey).getProperties();
      return {
        size: Number(properties.contentLength ?? 0),
        mimeType: properties.contentType ?? null,
        etag: properties.etag ?? null,
      };
    }
    case 'kodo': {
      const { mac, conf } = createKodoUploader(config);
      const manager = new (loadQiniu().rs.BucketManager)(mac, conf);
      const result = await manager.stat(config.kodoBucket!, objectKey);
      return {
        size: Number(result.data.fsize ?? 0),
        mimeType: result.data.mimeType ?? null,
        etag: result.data.hash ?? null,
      };
    }
    case 'bos': {
      const client = createBosClient(config) as unknown as {
        getObjectMetadata(bucket: string, key: string): Promise<{ http_headers?: Record<string, string> }>;
      };
      const result = await client.getObjectMetadata(config.bosBucket!, objectKey);
      const headers = result.http_headers ?? {};
      return {
        size: Number(headers['content-length'] ?? 0),
        mimeType: headers['content-type'] ?? null,
        etag: headers.etag ?? null,
      };
    }
    case 'local': {
      const filePath = path.join(resolveLocalRoot(config), ...objectKey.split('/'));
      const stat = await fs.stat(filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') throw new HTTPException(404, { message: '对象不存在' });
        throw error;
      });
      return { size: stat.size, mimeType: null, etag: null };
    }
    case 'sftp': {
      const remotePath = [config.sftpRootPath?.replace(/\/+$/, ''), ...objectKey.split('/')].filter(Boolean).join('/');
      const stat = await sftpOperation(config, (client) => client.stat(remotePath)) as { size?: number };
      return { size: Number(stat.size ?? 0), mimeType: null, etag: null };
    }
    default:
      throw new HTTPException(400, { message: `当前存储类型不支持对象读取：${config.provider}` });
  }
}

/** 完成直传后按配置设置对象 ACL（仅对象 ACL 策略需要）。 */
export async function applyObjectAcl(
  config: FileStorageConfigRow,
  objectKey: string,
  acl: 'private' | 'public-read' | 'public-read-write',
): Promise<void> {
  switch (config.provider) {
    case 'oss': {
      const client = createOssClient(config);
      await client.putACL(objectKey, acl as unknown as Parameters<typeof client.putACL>[1]);
      return;
    }
    case 's3': {
      const client = createS3Client(config);
      const { PutObjectAclCommand } = loadS3();
      await client.send(new PutObjectAclCommand({ Bucket: config.s3Bucket!, Key: objectKey, ACL: acl }));
      return;
    }
    case 'cos': {
      const cos = createCosClient(config);
      await new Promise<void>((resolve, reject) => {
        cos.putObjectAcl({ Bucket: config.cosBucket!, Region: config.cosRegion!, Key: objectKey, ACL: acl as never }, (err) => {
          if (err) reject(err instanceof Error ? err : new Error(String(err)));
          else resolve();
        });
      });
      return;
    }
    case 'obs': {
      const obs = createObsClient(config) as ObsClientType & {
        setObjectAcl(params: Record<string, unknown>, cb: (err: unknown) => void): void;
      };
      await new Promise<void>((resolve, reject) => {
        obs.setObjectAcl({ Bucket: config.obsBucket!, Key: objectKey, ACL: acl }, (err) => {
          if (err) reject(err instanceof Error ? err : new Error(String(err)));
          else resolve();
        });
      });
      return;
    }
    case 'bos': {
      const client = createBosClient(config) as unknown as {
        putObjectCannedAcl(bucket: string, key: string, acl: 'private' | 'public-read'): Promise<unknown>;
      };
      if (acl === 'public-read-write') throw new HTTPException(400, { message: 'BOS 不支持对象公共写 ACL' });
      await client.putObjectCannedAcl(config.bosBucket!, objectKey, acl);
      return;
    }
    default:
      throw new HTTPException(400, { message: `当前存储类型不支持对象 ACL：${config.provider}` });
  }
}
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
      const { GetObjectCommand } = loadS3();
      const { getSignedUrl } = loadS3Presigner();
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
      const bucketManager = new (loadQiniu().rs.BucketManager)(mac, conf);
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
        permissions: loadAzureBlob().BlobSASPermissions.parse('r'),
        expiresOn: new Date(Date.now() + expirySeconds * 1000),
        ...(contentDisposition ? { contentDisposition } : {}),
      });
    }
    default:
      return null;
  }
}

/**
 * 公开直链；下载方式不是 public-* / 公共性来源不满足 / 无法拼接时返回 null。
 * 结果永久有效，可进入列表实体的 directUrl 字段（仅渲染用，禁止持久化）。
 */
export function buildPublicFileUrl(file: FileUrlSource, config?: FileStorageConfigRow): string | null {
  if (!config || !isPublicAccessAllowed(file, config)) return null;
  return buildPublicObjectUrl(withFileBucket(file, config), file.objectKey);
}

/**
 * 按存储配置的 accessStrategy 解析文件访问地址，降级链：public → presigned → proxy。
 * presigned 结果含过期时间，禁止长期缓存；签名失败（配置不完整/SDK 异常）自动降级 proxy。
 */
export async function resolveFileAccessUrl(
  file: FileUrlSource,
  config: FileStorageConfigRow,
  options?: { contentDisposition?: string },
): Promise<FileAccessUrlResult> {
  const effective = withFileBucket(file, config);
  if (file.visibility === 'restricted') {
    return { url: buildManagedFileProxyUrl(file.id), strategy: 'proxy', expiresAt: null };
  }
  const strategy = config.accessStrategy;
  if (strategy.startsWith('public-') && isPublicAccessAllowed(file, config)) {
    const url = buildPublicObjectUrl(effective, file.objectKey);
    if (url) return { url, strategy: 'public', expiresAt: null };
  }
  if (strategy === 'presigned' || strategy.startsWith('public-')) {
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
export function withFileBucket(file: { bucketName?: string | null; provider: string }, config: FileStorageConfigRow): FileStorageConfigRow {
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
  if (message.includes('Put public object acl is not allowed') || message.includes('BlockPublicAcls')) {
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
    const { PutObjectCommand } = loadS3();
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
      formUploader.putStream(uploadToken, objectKey, stream, new (loadQiniu().form_up.PutExtra)(), (err) => {
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
    const { CreateMultipartUploadCommand } = loadS3();
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
    const { UploadPartCommand } = loadS3();
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
    const { CompleteMultipartUploadCommand } = loadS3();
    await client.send(new CompleteMultipartUploadCommand({
      Bucket: config.s3Bucket!,
      Key: objectKey,
      UploadId: uploadId,
      MultipartUpload: { Parts: sortMultipartParts(parts).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }));
  },
  async abort(config, objectKey, uploadId) {
    const client = createS3Client(config);
    const { AbortMultipartUploadCommand } = loadS3();
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

async function kodoMultipartContext(config: FileStorageConfigRow, objectKey: string) {
  const { mac, conf } = createKodoUploader(config);
  const qiniu = loadQiniu();
  const token = new qiniu.rs.PutPolicy({ scope: `${config.kodoBucket!}:${objectKey}`, expires: 3600 }).uploadToken(mac);
  const getZoneInfo = (qiniu.zone as unknown as { getZoneInfo: (
    accessKey: string,
    bucket: string,
    callback: (err: Error | null, result: QiniuTypes.conf.Zone) => void,
  ) => void }).getZoneInfo;
  const zoneKey = `${config.kodoAccessKey}:${config.kodoBucket}`;
  let zonePromise = kodoZones.get(zoneKey);
  if (!zonePromise && !conf.zone) {
    zonePromise = new Promise<QiniuTypes.conf.Zone>((resolve, reject) => {
      getZoneInfo(config.kodoAccessKey!, config.kodoBucket!, (err, result) => err ? reject(err) : resolve(result));
    });
    kodoZones.set(zoneKey, zonePromise);
    void zonePromise.catch(() => kodoZones.delete(zoneKey));
  }
  const zone = conf.zone ?? await zonePromise!;
  const host = zone.srcUpHosts[0];
  if (!host) throw new Error('七牛云未返回上传域名');
  const base = `https://${host}/buckets/${encodeURIComponent(config.kodoBucket!)}/objects/${Buffer.from(objectKey).toString('base64url')}/uploads`;
  return { token, base };
}

async function kodoMultipartRequest<T>(url: string, token: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  const options = { headers: { Authorization: `UpToken ${token}`, 'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json',
    ...(Buffer.isBuffer(body) ? { 'Content-MD5': createHash('md5').update(body).digest('base64') } : {}) },
    httpLog: { logRequestBody: false, logResponseBody: false } };
  const postBody = typeof body === 'string' || Buffer.isBuffer(body)
    ? body as unknown as BodyInit
    : body as Record<string, unknown> | undefined;
  const response = method === 'POST' ? await httpPost(url, postBody, options)
    : method === 'PUT' ? await httpPut(url, body as unknown as BodyInit, options)
      : await httpDelete(url, options);
  if (!response.ok) throw new Error(`七牛云分片请求失败：HTTP ${response.status}`);
  if (response.status === 204) return undefined as T;
  return response.json<T>();
}

const kodoMultipartDriver: MultipartDriver = {
  async init(config, objectKey) {
    const { base, token } = await kodoMultipartContext(config, objectKey);
    const result = await kodoMultipartRequest<{ uploadId: string }>(base, token, 'POST', '');
    if (!result.uploadId) throw new Error('七牛云初始化分片上传未返回 uploadId');
    return result.uploadId;
  },
  async uploadPart(config, objectKey, uploadId, partNumber, body) {
    const { base, token } = await kodoMultipartContext(config, objectKey);
    const result = await kodoMultipartRequest<{ etag?: string }>(`${base}/${encodeURIComponent(uploadId)}/${partNumber}`, token, 'PUT', body);
    if (!result.etag) throw new Error('七牛云分片上传未返回 ETag');
    return result.etag;
  },
  async complete(config, objectKey, uploadId, parts, mimeType) {
    const { base, token } = await kodoMultipartContext(config, objectKey);
    await kodoMultipartRequest(`${base}/${encodeURIComponent(uploadId)}`, token, 'POST', {
      mimeType: mimeType ?? 'application/octet-stream',
      parts: sortMultipartParts(parts).map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
    });
  },
  async abort(config, objectKey, uploadId) {
    const { base, token } = await kodoMultipartContext(config, objectKey);
    await kodoMultipartRequest(`${base}/${encodeURIComponent(uploadId)}`, token, 'DELETE');
  },
};

/** 七牛云按对象签发上传凭证，分片 API 返回的 ETag 在响应 JSON 中。 */
async function createKodoDirectPartTarget(config: FileStorageConfigRow, objectKey: string, uploadId: string, partNumber: number, expirySeconds: number): Promise<DirectUploadTarget> {
  const { base, token } = await kodoMultipartContext(config, objectKey);
  return { url: `${base}/${encodeURIComponent(uploadId)}/${partNumber}`, method: 'PUT',
    headers: { Authorization: `UpToken ${token}`, 'Content-Type': 'application/octet-stream' },
    expiresAt: new Date(Date.now() + Math.min(expirySeconds, 3600) * 1000) };
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
 * 当前已接入：oss / s3 / cos / obs / azure / bos；Kodo 的服务端中转仍使用本地暂存。
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

export function getDirectMultipartDriver(provider: FileStorageConfigRow['provider']): MultipartDriver | null {
  return provider === 'kodo' ? kodoMultipartDriver : getMultipartDriver(provider);
}

export interface StoredFileRange {
  start: number;
  end: number;
}

/** 读取对象所需的最小文件快照：managed_files 行满足，分片会话行（尚未落库为托管文件）也能构造 */
export type StoredObjectSource = Pick<ManagedFileRow, 'objectKey' | 'bucketName' | 'provider' | 'mimeType' | 'originalName'>;

export async function readStoredFile(file: StoredObjectSource, config: FileStorageConfigRow, range?: StoredFileRange) {
  const effectiveConfig = withFileBucket(file, config);
  const contentType = file.mimeType ?? 'application/octet-stream';
  const fileName = file.originalName;

  if (effectiveConfig.provider === 'local') {
    const filePath = path.join(resolveLocalRoot(effectiveConfig), ...file.objectKey.split('/'));
    let handle;
    try { handle = await fs.open(filePath, 'r'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HTTPException(410, { message: '文件内容已不存在，请重新生成或上传' });
      throw error;
    }
    const stream = Readable.toWeb(handle.createReadStream(range ? { start: range.start, end: range.end } : undefined)) as ReadableStream<Uint8Array>;
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
    const { GetObjectCommand } = loadS3();
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
    const bucketManager = new (loadQiniu().rs.BucketManager)(mac, conf);
    const privateUrl = bucketManager.privateDownloadUrl(domain, file.objectKey, Math.floor(Date.now() / 1000) + 3600);
    const response = await httpGet(privateUrl, { httpLog: { logResponseBody: false } });
    if (!response.ok) throw new Error(`Kodo 下载失败: ${response.status}`);
    const stream = response.raw.body as ReadableStream<Uint8Array>;
    return { stream, contentType, fileName };
  }

  if (effectiveConfig.provider === 'bos') {
    const bosClient = createBosClient(effectiveConfig);
    // BOS getObject 始终缓冲到内存，改用预签名 URL 流式下载
    const presignedUrl = (bosClient as unknown as BosStreamClient).generatePresignedUrl(
      effectiveConfig.bosBucket!,
      file.objectKey,
      Math.floor(Date.now() / 1000),
      3600,
    );
    const response = await httpGet(presignedUrl, { httpLog: { logResponseBody: false } });
    if (!response.ok) throw new Error(`BOS 下载失败: ${response.status}`);
    const stream = response.raw.body as ReadableStream<Uint8Array>;
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
    const { DeleteObjectCommand } = loadS3();
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
    const bucketManager = new (loadQiniu().rs.BucketManager)(mac, conf);
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

// ─── 存储对象浏览（真实对象列表，非 managed_files 视图）────────────────────────

/** 不透明游标：对象存储使用 marker / continuation token，本地与 SFTP 使用 offset */
export interface StorageListCursor {
  marker?: string;
  token?: string;
  offset?: number;
}

export interface StorageListObject {
  key: string;
  size: number | null;
  lastModified: Date | null;
  etag: string | null;
}

export interface StorageListPage {
  prefixes: string[];
  objects: StorageListObject[];
  nextCursor: StorageListCursor | null;
}

export interface StorageListInput {
  /** 完整对象 key 前缀，目录场景以 / 结尾 */
  prefix: string;
  cursor?: StorageListCursor;
  limit: number;
}

function dateOrNull(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function listLocalObjects(config: FileStorageConfigRow, input: StorageListInput): Promise<StorageListPage> {
  const root = resolveLocalRoot(config);
  const directory = path.join(root, ...input.prefix.split('/').filter(Boolean));
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new HTTPException(404, { message: '目录不存在' });
    throw error;
  });
  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
  const offset = input.cursor?.offset ?? 0;
  const prefixes: string[] = [];
  const objects: StorageListObject[] = [];
  let consumed = 0;
  for (const entry of sorted.slice(offset)) {
    if (prefixes.length + objects.length >= input.limit) break;
    const key = `${input.prefix}${entry.name}`;
    if (entry.isDirectory()) {
      prefixes.push(`${key}/`);
    } else {
      const stat = await fs.stat(path.join(directory, entry.name));
      objects.push({ key, size: stat.size, lastModified: stat.mtime, etag: null });
    }
    consumed++;
  }
  const nextOffset = offset + consumed;
  return { prefixes, objects, nextCursor: nextOffset < sorted.length ? { offset: nextOffset } : null };
}

async function listSftpObjects(config: FileStorageConfigRow, input: StorageListInput): Promise<StorageListPage> {
  const root = config.sftpRootPath?.replace(/\/+$/, '') ?? '';
  const remoteDirectory = [root, ...input.prefix.split('/').filter(Boolean)].filter(Boolean).join('/') || '.';
  const entries = await sftpOperation(config, (client) => client.list(remoteDirectory)) as unknown as Array<{
    name: string;
    type?: string;
    size?: number;
    modifyTime?: number;
  }>;
  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
  const offset = input.cursor?.offset ?? 0;
  const prefixes: string[] = [];
  const objects: StorageListObject[] = [];
  let consumed = 0;
  for (const entry of sorted.slice(offset)) {
    if (prefixes.length + objects.length >= input.limit) break;
    const key = `${input.prefix}${entry.name}`;
    if (entry.type === 'd' || entry.type === 'directory') {
      prefixes.push(`${key}/`);
    } else {
      objects.push({
        key,
        size: entry.size ?? null,
        lastModified: entry.modifyTime ? new Date(entry.modifyTime) : null,
        etag: null,
      });
    }
    consumed++;
  }
  const nextOffset = offset + consumed;
  return { prefixes, objects, nextCursor: nextOffset < sorted.length ? { offset: nextOffset } : null };
}

/** 列出当前目录层级的真实对象；目录分隔符统一为 / */
export async function listStorageObjects(config: FileStorageConfigRow, input: StorageListInput): Promise<StorageListPage> {
  switch (config.provider) {
    case 'local':
      return listLocalObjects(config, input);
    case 'sftp':
      return listSftpObjects(config, input);
    case 's3': {
      const client = createS3Client(config);
      const { ListObjectsV2Command } = loadS3();
      const result = await client.send(new ListObjectsV2Command({
        Bucket: config.s3Bucket!,
        Prefix: input.prefix,
        Delimiter: '/',
        MaxKeys: input.limit,
        ...(input.cursor?.token ? { ContinuationToken: input.cursor.token } : {}),
      }));
      return {
        prefixes: (result.CommonPrefixes ?? []).map((item) => item.Prefix).filter(Boolean) as string[],
        objects: (result.Contents ?? []).map((item) => ({
          key: item.Key!,
          size: item.Size ?? null,
          lastModified: item.LastModified ?? null,
          etag: item.ETag ?? null,
        })),
        nextCursor: result.IsTruncated && result.NextContinuationToken ? { token: result.NextContinuationToken } : null,
      };
    }
    case 'oss': {
      const client = createOssClient(config) as unknown as {
        list(query: Record<string, unknown>): Promise<{
          objects?: Array<{ name: string; size: number; lastModified: string | Date; etag?: string }>;
          prefixes?: string[];
          nextMarker?: string;
        }>;
      };
      const result = await client.list({
        prefix: input.prefix,
        delimiter: '/',
        'max-keys': input.limit,
        ...(input.cursor?.marker ? { marker: input.cursor.marker } : {}),
      }) as unknown as {
        objects?: Array<{ name: string; size: number; lastModified: string | Date; etag?: string }>;
        prefixes?: string[];
        nextMarker?: string;
      };
      return {
        prefixes: result.prefixes ?? [],
        objects: (result.objects ?? []).map((item) => ({
          key: item.name,
          size: item.size ?? null,
          lastModified: dateOrNull(item.lastModified),
          etag: item.etag ?? null,
        })),
        nextCursor: result.nextMarker ? { marker: result.nextMarker } : null,
      };
    }
    case 'cos': {
      const cos = createCosClient(config);
      const result = await cos.getBucket({
        Bucket: config.cosBucket!,
        Region: config.cosRegion!,
        Prefix: input.prefix,
        Delimiter: '/',
        MaxKeys: input.limit,
        ...(input.cursor?.marker ? { Marker: input.cursor.marker } : {}),
      }) as unknown as {
        Contents?: Array<{ Key: string; Size: string | number; LastModified: string; ETag?: string }>;
        CommonPrefixes?: Array<{ Prefix: string }>;
        IsTruncated?: boolean | string;
        NextMarker?: string;
      };
      return {
        prefixes: (result.CommonPrefixes ?? []).map((item) => item.Prefix),
        objects: (result.Contents ?? []).map((item) => ({
          key: item.Key,
          size: Number(item.Size) || null,
          lastModified: dateOrNull(item.LastModified),
          etag: item.ETag ?? null,
        })),
        nextCursor: (result.IsTruncated === true || result.IsTruncated === 'true') && result.NextMarker
          ? { marker: result.NextMarker }
          : null,
      };
    }
    case 'obs': {
      const obs = createObsClient(config) as ObsClientType & {
        listObjects(params: Record<string, unknown>, cb: (err: unknown, result: {
          InterfaceResult?: {
            Contents?: Array<{ Key: string; Size: number; LastModified: string; ETag?: string }>;
            CommonPrefixes?: Array<{ Prefix: string }>;
            IsTruncated?: boolean;
            NextMarker?: string;
          };
        }) => void): void;
      };
      const result = await new Promise<{
        Contents?: Array<{ Key: string; Size: number; LastModified: string; ETag?: string }>;
        CommonPrefixes?: Array<{ Prefix: string }>;
        IsTruncated?: boolean;
        NextMarker?: string;
      }>((resolve, reject) => {
        obs.listObjects({
          Bucket: config.obsBucket!,
          Prefix: input.prefix,
          Delimiter: '/',
          MaxKeys: input.limit,
          ...(input.cursor?.marker ? { Marker: input.cursor.marker } : {}),
        }, (err, data) => {
          if (err) reject(err instanceof Error ? err : new Error(String(err)));
          else resolve(data.InterfaceResult ?? {});
        });
      });
      return {
        prefixes: (result.CommonPrefixes ?? []).map((item) => item.Prefix),
        objects: (result.Contents ?? []).map((item) => ({
          key: item.Key,
          size: item.Size ?? null,
          lastModified: dateOrNull(item.LastModified),
          etag: item.ETag ?? null,
        })),
        nextCursor: result.IsTruncated && result.NextMarker ? { marker: result.NextMarker } : null,
      };
    }
    case 'kodo': {
      const { mac, conf } = createKodoUploader(config);
      const manager = new (loadQiniu().rs.BucketManager)(mac, conf);
      const response = await manager.listPrefix(config.kodoBucket!, {
        prefix: input.prefix,
        delimiter: '/',
        limit: input.limit,
        ...(input.cursor?.marker ? { marker: input.cursor.marker } : {}),
      });
      const result = response.data;
      return {
        prefixes: result.commonPrefixes ?? [],
        objects: (result.items ?? []).map((item) => ({
          key: item.key,
          size: item.fsize ?? null,
          lastModified: item.putTime ? new Date(item.putTime / 10_000) : null,
          etag: item.hash ?? null,
        })),
        nextCursor: result.marker ? { marker: result.marker } : null,
      };
    }
    case 'bos': {
      const client = createBosClient(config) as unknown as {
        listObjects(bucket: string, options: Record<string, unknown>): Promise<{
          body?: {
            contents?: Array<{ key: string; size: number; lastModified: string; eTag?: string }>;
            commonPrefixes?: Array<{ prefix: string }>;
            isTruncated?: boolean;
            nextMarker?: string;
          };
        }>;
      };
      const response = await client.listObjects(config.bosBucket!, {
        prefix: input.prefix,
        delimiter: '/',
        maxKeys: input.limit,
        ...(input.cursor?.marker ? { marker: input.cursor.marker } : {}),
      });
      const result = response.body ?? {};
      return {
        prefixes: (result.commonPrefixes ?? []).map((item) => item.prefix),
        objects: (result.contents ?? []).map((item) => ({
          key: item.key,
          size: item.size ?? null,
          lastModified: dateOrNull(item.lastModified),
          etag: item.eTag ?? null,
        })),
        nextCursor: result.isTruncated && result.nextMarker ? { marker: result.nextMarker } : null,
      };
    }
    case 'azure': {
      const container = createAzureBlobClient(config);
      const page = await container
        .listBlobsByHierarchy('/', {
          prefix: input.prefix,
          ...(input.cursor?.token ? { continuationToken: input.cursor.token } : {}),
        })
        .byPage({ maxPageSize: input.limit, ...(input.cursor?.token ? { continuationToken: input.cursor.token } : {}) })
        .next();
      const value = page.value as unknown as {
        segment?: {
          blobPrefixes?: Array<{ name: string }>;
          blobItems?: Array<{
            name: string;
            properties?: { contentLength?: number; lastModified?: Date; etag?: string };
          }>;
        };
        continuationToken?: string;
      };
      return {
        prefixes: (value?.segment?.blobPrefixes ?? []).map((item) => item.name),
        objects: (value?.segment?.blobItems ?? []).map((item) => ({
          key: item.name,
          size: item.properties?.contentLength ?? null,
          lastModified: item.properties?.lastModified ?? null,
          etag: item.properties?.etag ?? null,
        })),
        nextCursor: value?.continuationToken ? { token: value.continuationToken } : null,
      };
    }
    default:
      throw new HTTPException(400, { message: `当前存储类型不支持对象浏览：${config.provider}` });
  }
}

/**
 * 未登记对象的直链：公开策略 / 临时签名；proxy 由调用方签发短时令牌地址。
 * 不依赖 managed_files 快照，按当前配置状态判断。
 */
export async function resolveStorageObjectDirectUrl(
  config: FileStorageConfigRow,
  objectKey: string,
  contentDisposition?: string,
): Promise<FileAccessUrlResult | null> {
  const objectAcl = resolveObjectAcl(config);
  const publicAccess = resolvePublicAccess(config, objectAcl);
  if (config.accessStrategy.startsWith('public-') && publicAccess) {
    const url = buildPublicObjectUrl(config, objectKey);
    if (url) return { url, strategy: 'public', expiresAt: null };
  }
  if (config.accessStrategy === 'presigned' || config.accessStrategy.startsWith('public-')) {
    const expirySeconds = config.presignedExpirySeconds || 1800;
    try {
      const url = await presignObjectUrl(config, objectKey, expirySeconds, contentDisposition);
      if (url) return { url, strategy: 'presigned', expiresAt: new Date(Date.now() + expirySeconds * 1000) };
    } catch (error) {
      logger.warn(`[storage-browse] 对象签名失败 config=${config.id} key=${objectKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return null;
}

/** 流式计算存储对象 SHA-256；登记时的可选步骤 */
export async function sha256OfStorageObject(config: FileStorageConfigRow, objectKey: string): Promise<string> {
  const { stream } = await readStoredFile({
    objectKey,
    bucketName: extractBucketName(config),
    provider: config.provider,
    mimeType: null,
    originalName: path.basename(objectKey),
  }, config);
  const hash = createHash('sha256');
  for await (const part of Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0])) hash.update(part as Buffer);
  return hash.digest('hex');
}
