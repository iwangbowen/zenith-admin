import {
  fileContract,
  UPLOAD_MAX_CHUNKS,
  type DirectUploadPartUrl,
  type ManagedFile,
  type UploadSessionInit,
  type UploadSessionStatus,
} from '@zenith/shared/platform';
import { api } from '@/lib/contract-query';
import { ApiError } from '@/lib/query';
import { scopedStorageKey, storageNamespace } from '@/utils/storage';
import { CHUNKED_UPLOAD_CANCELLED } from './chunked-upload';
import { hashFileSha256 } from './file-hash';

const PART_CONCURRENCY = 3;
const PART_RETRIES = 3;
const RESUME_KEY_PREFIX = 'direct-multipart-upload:';

/** 直传通道的六个操作；业务域用自己契约派生，文件中心用默认实现 */
export interface DirectUploadEndpoints<TFile> {
  init: (body: Record<string, unknown>) => Promise<UploadSessionInit>;
  partUrl: (uploadId: string, partNumber: number) => Promise<DirectUploadPartUrl>;
  partAck: (uploadId: string, partNumber: number, body: { etag: string; size: number }) => Promise<unknown>;
  status: (uploadId: string) => Promise<UploadSessionStatus>;
  complete: (uploadId: string, body: { contentHash: string }) => Promise<TFile>;
  abort: (uploadId: string) => Promise<unknown>;
}

/** 已创建会话后的直传通道；init 由业务统一上传负责 */
export type DirectUploadChannel<TFile> = Omit<DirectUploadEndpoints<TFile>, 'init'>;

const FILE_DIRECT_ENDPOINTS: DirectUploadEndpoints<ManagedFile> = {  init: (body) => api(fileContract.directUploadInit, {
    body: body as { fileName: string; fileSize: number; mimeType?: string; storageConfigId?: number },
  }),
  partUrl: (uploadId, partNumber) => api(fileContract.directUploadPartUrl, { params: { uploadId, partNumber } }),
  partAck: (uploadId, partNumber, body) => api(fileContract.directUploadPartAck, { params: { uploadId, partNumber }, body }),
  status: (uploadId) => api(fileContract.directUploadStatus, { params: { uploadId } }),
  complete: (uploadId, body) => api(fileContract.directUploadComplete, { params: { uploadId }, body }),
  abort: (uploadId) => api(fileContract.directUploadAbort, { params: { uploadId } }),
};

export interface DirectMultipartOptions<TFile> {
  file: File;
  storageConfigId?: number;
  contentHash?: string;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
  /** 失败后不再保留续传会话（调用方准备回退服务端中转时使用） */
  abortOnFailure?: boolean;
  /** 通道地址；业务域传入自己的契约实现，缺省为文件中心直传 */
  endpoints?: DirectUploadEndpoints<TFile>;
  /** 续传键的额外维度：同一文件上传到不同目标时不应复用会话 */
  resumeScope?: string;
  /** 调用方管理的续传键；业务统一上传使用 */
  resumeKey?: string;
  /** 已创建的直传会话（业务 init 后传入），跳过续传探测与 init */
  session?: { uploadId: string; chunkSize: number; totalChunks: number; received: number[] };
}

interface DirectUploadCheckpoint {
  uploadId: string;
  fileHash: string;
}

export interface DirectUploadResumeCandidate {
  fileName: string;
  fileSize: number;
  lastModified: number;
  receivedParts: number;
  totalParts: number;
}

function resumeKey(file: File, scope?: string | number) {
  const fingerprint = `${file.name}:${file.size}:${file.lastModified}:${scope ?? 'default'}`;
  return scopedStorageKey(`${RESUME_KEY_PREFIX}${fingerprint}`);
}

export async function listDirectUploadResumeCandidates(storageConfigId?: number): Promise<DirectUploadResumeCandidate[]> {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key) continue;
    const logicalKey = key.startsWith(`${storageNamespace}:`) ? key.slice(storageNamespace.length + 1) : key;
    if (logicalKey.startsWith(RESUME_KEY_PREFIX)) keys.push(key);
  }

  const candidates: DirectUploadResumeCandidate[] = [];
  for (const listedKey of keys) {
    const logicalKey = listedKey.startsWith(`${storageNamespace}:`)
      ? listedKey.slice(storageNamespace.length + 1)
      : listedKey;
    const fingerprint = logicalKey.slice(RESUME_KEY_PREFIX.length);
    const storageSeparator = fingerprint.lastIndexOf(':');
    const lastModifiedSeparator = fingerprint.lastIndexOf(':', storageSeparator - 1);
    const sizeSeparator = fingerprint.lastIndexOf(':', lastModifiedSeparator - 1);
    if (storageSeparator < 0 || lastModifiedSeparator < 0 || sizeSeparator < 0) continue;

    const fileName = fingerprint.slice(0, sizeSeparator);
    const fileSize = Number(fingerprint.slice(sizeSeparator + 1, lastModifiedSeparator));
    const lastModified = Number(fingerprint.slice(lastModifiedSeparator + 1, storageSeparator));
    const savedStorageId = fingerprint.slice(storageSeparator + 1);
    if (!fileName || !Number.isFinite(fileSize) || !Number.isFinite(lastModified)) continue;
    if (storageConfigId !== undefined && savedStorageId !== String(storageConfigId)) continue;

    const fullKey = scopedStorageKey(logicalKey);
    try {
      const checkpoint = JSON.parse(localStorage.getItem(fullKey) ?? 'null') as DirectUploadCheckpoint | null;
      if (!checkpoint?.uploadId) continue;
      const status = await api(fileContract.directUploadStatus, {
        params: { uploadId: checkpoint.uploadId },
      }, { silent: true });
      if (status.status !== 'uploading') {
        localStorage.removeItem(fullKey);
        continue;
      }
      candidates.push({
        fileName,
        fileSize,
        lastModified,
        receivedParts: status.received.length,
        totalParts: status.totalChunks,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 404) localStorage.removeItem(fullKey);
    }
  }
  return candidates;
}

function expectedPartSize(fileSize: number, chunkSize: number, partNumber: number) {
  const offset = (partNumber - 1) * chunkSize;
  return Math.max(0, Math.min(chunkSize, fileSize - offset));
}

async function kodoPartMd5(blob: Blob): Promise<string> {
  const { createMD5 } = await import('hash-wasm');
  const hash = await createMD5();
  hash.init();
  const bytesPerChunk = 4 * 1024 * 1024;
  for (let offset = 0; offset < blob.size; offset += bytesPerChunk) {
    const end = Math.min(offset + bytesPerChunk, blob.size);
    hash.update(new Uint8Array(await blob.slice(offset, end).arrayBuffer()));
  }
  const hex = hash.digest('hex');
  const bytes = Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
  return btoa(String.fromCharCode(...bytes));
}

function putPart(
  url: string,
  headers: Record<string, string> | undefined,
  blob: Blob,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<{ etag?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => xhr.abort();
    xhr.open('PUT', url);
    for (const [key, value] of Object.entries(headers ?? {})) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      cleanup();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`分片直传失败（HTTP ${xhr.status}）`));
        return;
      }
      const response = xhr.responseText;
      let responseEtag: string | undefined;
      try { responseEtag = (JSON.parse(response) as { etag?: string }).etag; } catch { /* 非 JSON 响应使用 ETag 响应头 */ }
      const etag = xhr.getResponseHeader('ETag') ?? responseEtag;
      resolve({ etag });
    };
    xhr.onerror = () => { cleanup(); reject(new Error('分片网络错误')); };
    xhr.onabort = () => { cleanup(); reject(new DOMException('上传已取消', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else xhr.send(blob);
  });
}

async function findSession<TFile>(key: string, endpoints: DirectUploadEndpoints<TFile>) {
  const savedCheckpoint = localStorage.getItem(key);
  if (!savedCheckpoint) return null;
  let checkpoint: DirectUploadCheckpoint;
  try {
    checkpoint = JSON.parse(savedCheckpoint) as DirectUploadCheckpoint;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
  if (typeof checkpoint.uploadId !== 'string' || typeof checkpoint.fileHash !== 'string') {
    localStorage.removeItem(key);
    return null;
  }
  try {
    const status = await endpoints.status(checkpoint.uploadId);
    if (status.status === 'uploading') return { checkpoint, status };
    if (status.status === 'completing') throw new Error('上一次直传正在合并，请稍后重试');
    localStorage.removeItem(key);
    if (status.status === 'completed') throw new Error('上一次直传已完成，请刷新文件列表确认');
  } catch (error) {
    if (error instanceof ApiError && error.code === 404) localStorage.removeItem(key);
    else throw error;
  }
  return null;
}

export async function directMultipartUpload<TFile = ManagedFile>(options: DirectMultipartOptions<TFile>): Promise<TFile> {
  const { file, contentHash, signal, onProgress } = options;
  const endpoints = options.endpoints ?? (FILE_DIRECT_ENDPOINTS as unknown as DirectUploadEndpoints<TFile>);
  const key = options.resumeKey ?? resumeKey(file, options.resumeScope ?? options.storageConfigId);
  const fileHash = contentHash ?? await hashFileSha256(file, signal);
  // 业务统一上传自己维护 { uploadId, mode } 检查点；仅文件中心的独立直传写本地检查点
  const manageCheckpoint = !options.session;
  let uploadId: string;
  let status: UploadSessionStatus;
  let checkpoint: DirectUploadCheckpoint;

  if (options.session) {
    uploadId = options.session.uploadId;
    checkpoint = { uploadId, fileHash };
    status = {
      uploadId,
      status: 'uploading',
      chunkSize: options.session.chunkSize,
      totalChunks: options.session.totalChunks,
      received: options.session.received,
    };
  } else {
    let resumed: Awaited<ReturnType<typeof findSession<TFile>>>;
    try {
      resumed = await findSession(key, endpoints);
    } catch (error) {
      if (signal?.aborted && signal.reason === CHUNKED_UPLOAD_CANCELLED) {
        let savedId: string | undefined;
        try { savedId = (JSON.parse(localStorage.getItem(key) ?? 'null') as DirectUploadCheckpoint | null)?.uploadId; } catch { /* invalid checkpoint is discarded */ }
        if (savedId) {
          localStorage.removeItem(key);
          void endpoints.abort(savedId).catch(() => {});
        }
      }
      throw error;
    }
    if (resumed && resumed.checkpoint.fileHash === fileHash) {
      checkpoint = resumed.checkpoint;
      uploadId = checkpoint.uploadId;
      status = resumed.status;
    } else {
      if (resumed) {
        await endpoints.abort(resumed.checkpoint.uploadId).catch(() => {});
        localStorage.removeItem(key);
      }
      const session = await endpoints.init({
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || undefined,
        storageConfigId: options.storageConfigId,
      });
      if (session.mode !== 'browser-direct') throw new Error('当前存储不支持浏览器直传，请重试');
      uploadId = session.uploadId;
      checkpoint = { uploadId, fileHash };
      status = { uploadId, status: 'uploading', chunkSize: session.chunkSize, totalChunks: session.totalChunks, received: session.received };
      if (manageCheckpoint) localStorage.setItem(key, JSON.stringify(checkpoint));
    }
  }

  if (status.totalChunks > UPLOAD_MAX_CHUNKS) throw new Error('分片数量超过上限');
  const received = new Set(status.received);
  const receivedBytes = status.received.reduce((sum, index) => sum + expectedPartSize(file.size, status.chunkSize, index + 1), 0);
  const inFlight = new Map<number, number>();
  let completedBytes = receivedBytes;
  const reportProgress = () => {
    const uploadingBytes = [...inFlight.values()].reduce((sum, value) => sum + value, 0);
    onProgress?.(file.size === 0 ? 99 : Math.min(99, Math.round(((completedBytes + uploadingBytes) / file.size) * 100)));
  };

  try {
    const missing: number[] = [];
    for (let partNumber = 1; partNumber <= status.totalChunks; partNumber++) {
      if (!received.has(partNumber - 1)) missing.push(partNumber);
    }
    reportProgress();
    let cursor = 0;
    const worker = async () => {
      while (cursor < missing.length) {
        if (signal?.aborted) throw new DOMException('上传已取消', 'AbortError');
        const partNumber = missing[cursor++];
        const start = (partNumber - 1) * status.chunkSize;
        const end = Math.min(start + status.chunkSize, file.size);
        const blob = file.slice(start, end);
        let partMd5: string | undefined;
        for (let attempt = 0; ; attempt++) {
          try {
            const target = await endpoints.partUrl(uploadId, partNumber);
            if (target.headers?.Authorization?.startsWith('UpToken ') && partMd5 === undefined) {
              partMd5 = blob.size > 0 ? await kodoPartMd5(blob) : undefined;
            }
            const partHeaders = target.headers?.Authorization?.startsWith('UpToken ') && partMd5
              ? { ...target.headers, 'Content-MD5': partMd5 }
              : target.headers;
            const transfer = await putPart(target.url, partHeaders, blob, (loaded) => {
              inFlight.set(partNumber, loaded);
              reportProgress();
            }, signal);
            const etag = target.partTag ?? transfer.etag;
            if (!etag) throw new Error('分片响应未返回 ETag，请检查 Bucket CORS 暴露头配置');
            await endpoints.partAck(uploadId, partNumber, { etag: target.partTag ?? etag, size: blob.size });
            if (manageCheckpoint) localStorage.setItem(key, JSON.stringify(checkpoint));
            inFlight.delete(partNumber);
            completedBytes += blob.size;
            reportProgress();
            break;
          } catch (error) {
            inFlight.delete(partNumber);
            reportProgress();
            if (signal?.aborted || attempt >= PART_RETRIES) throw error;
            await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
          }
        }
      }
    };

    const workers = await Promise.allSettled(
      Array.from({ length: Math.min(PART_CONCURRENCY, Math.max(1, missing.length)) }, worker),
    );
    const failedWorker = workers.find((result) => result.status === 'rejected');
    if (failedWorker?.status === 'rejected') throw failedWorker.reason;
    const result = await endpoints.complete(uploadId, { contentHash: fileHash });
    localStorage.removeItem(key);
    onProgress?.(100);
    return result;
  } catch (error) {
    if ((signal?.aborted && signal.reason === CHUNKED_UPLOAD_CANCELLED)
      || options.abortOnFailure === true) {
      localStorage.removeItem(key);
      void endpoints.abort(uploadId).catch(() => {});
    }
    throw error;
  }
}
